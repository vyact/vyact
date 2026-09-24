"""
routers/skills.py – 스킬 CRUD + 로컬 의도 분류, 실패 시 보수적 벡터 매칭.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.db import get_es, KOREAN_ANALYSIS
from services.indexer import get_embedding
from services.default_skills import SKILLS_INDEX, sync_default_skills, is_builtin_skill
from services.skill_routing import calculation_context
from logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/skills", tags=["skills"])

MATCH_THRESHOLD = 0.85   # Elasticsearch kNN _score 기준 (raw cosine similarity가 아님)
MAX_SELECTED_SKILLS = 1


# ── 인덱스 생성 ──────────────────────────────────────────────────
async def ensure_skills_index():
    es = get_es()
    try:
        initial_install = not await es.indices.exists(index=SKILLS_INDEX)
        if initial_install:
            await es.indices.create(
                index=SKILLS_INDEX,
                settings={
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                    "analysis": KOREAN_ANALYSIS,
                },
                mappings={"properties": {
                    "name": {"type": "keyword"},
                    "description": {"type": "text", "analyzer": "korean"},
                    "instructions": {"type": "text"},
                    "enabled": {"type": "boolean"},
                    "origin": {"type": "keyword"},
                    "version": {"type": "integer"},
                    "created_at": {"type": "date"},
                    "updated_at": {"type": "date"},
                    "embedding": {
                        "type": "dense_vector",
                        "dims": 1024,
                        "index": True,
                        "similarity": "cosine",
                        "index_options": {
                            "type": "bbq_hnsw",
                            "m": 16,
                            "ef_construction": 100,
                        },
                    },
                }},
            )
            logger.info("skills index created")

        await sync_default_skills(es, get_embedding, initial_install=initial_install)
    finally:
        await es.close()


# ── 모델 ──────────────────────────────────────────────────────────
class SkillCreate(BaseModel):
    name: str
    description: str
    instructions: str


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    instructions: str | None = None
    enabled: bool | None = None


# ── CRUD ──────────────────────────────────────────────────────────
@router.get("")
async def list_skills():
    es = get_es()
    try:
        resp = await es.search(
            index=SKILLS_INDEX,
            query={"match_all": {}},
            size=100,
            sort=[{"created_at": "asc"}],
            ignore_unavailable=True,
        )
        return [
            {"id": h["_id"], **{k: v for k, v in h["_source"].items() if k != "embedding"},
             "origin": "builtin" if is_builtin_skill(h["_source"], h["_id"]) else "user"}
            for h in resp.get("hits", {}).get("hits", [])
        ]
    except Exception:
        return []
    finally:
        await es.close()


@router.post("")
async def create_skill(body: SkillCreate):
    es = get_es()
    try:
        now = datetime.now(timezone.utc).isoformat()
        embedding = await get_embedding(body.description.strip())
        if not embedding:
            raise HTTPException(status_code=500, detail="임베딩 생성 실패 — BGE-M3 모델 상태를 확인하세요.")
        doc = {
            "origin": "user",
            "name": body.name.strip(),
            "description": body.description.strip(),
            "instructions": body.instructions.strip(),
            "enabled": True,
            "embedding": embedding,
            "created_at": now,
            "updated_at": now,
        }
        resp = await es.index(index=SKILLS_INDEX, document=doc, refresh=True)
        return {"id": resp["_id"], **{k: v for k, v in doc.items() if k != "embedding"}}
    finally:
        await es.close()


@router.post("/reembed")
async def reembed_all_skills():
    """임베딩이 누락된 스킬을 모두 재임베딩."""
    es = get_es()
    try:
        resp = await es.search(
            index=SKILLS_INDEX, query={"match_all": {}}, size=100,
            _source=["name", "description"], ignore_unavailable=True,
        )
        updated = 0
        failed = 0
        for h in resp.get("hits", {}).get("hits", []):
            desc = h["_source"].get("description", "")
            embedding = await get_embedding(desc)
            if embedding:
                await es.update(
                    index=SKILLS_INDEX, id=h["_id"],
                    doc={"embedding": embedding, "updated_at": datetime.now(timezone.utc).isoformat()},
                    refresh=True,
                )
                updated += 1
            else:
                failed += 1
                logger.warning("[skills] 재임베딩 실패: %s", h["_source"].get("name"))
        return {"updated": updated, "failed": failed}
    finally:
        await es.close()


@router.put("/{skill_id}")
async def update_skill(skill_id: str, body: SkillUpdate):
    es = get_es()
    try:
        current = await es.get(index=SKILLS_INDEX, id=skill_id)
        if is_builtin_skill(current["_source"], skill_id) and any(
            value is not None for value in (body.name, body.description, body.instructions)
        ):
            raise HTTPException(status_code=403, detail="builtin_skill_read_only")
        update_doc: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if body.name is not None:
            update_doc["name"] = body.name.strip()
        if body.description is not None:
            update_doc["description"] = body.description.strip()
            embedding = await get_embedding(update_doc["description"])
            if not embedding:
                raise HTTPException(status_code=500, detail="임베딩 생성 실패 — BGE-M3 모델 상태를 확인하세요.")
            update_doc["embedding"] = embedding
        if body.instructions is not None:
            update_doc["instructions"] = body.instructions.strip()
        if body.enabled is not None:
            update_doc["enabled"] = body.enabled
        await es.update(index=SKILLS_INDEX, id=skill_id, doc=update_doc, refresh=True)
        updated = await es.get(index=SKILLS_INDEX, id=skill_id)
        return {"id": skill_id, **{k: v for k, v in updated["_source"].items() if k != "embedding"}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    finally:
        await es.close()


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str):
    es = get_es()
    try:
        current = await es.get(index=SKILLS_INDEX, id=skill_id)
        if is_builtin_skill(current["_source"], skill_id):
            raise HTTPException(status_code=403, detail="builtin_skill_read_only")
        await es.delete(index=SKILLS_INDEX, id=skill_id, refresh=True)
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    finally:
        await es.close()


# ── 벡터 유사도 매칭 ─────────────────────────────────────────────
async def match_skills(query: str) -> list[dict]:
    """Return at most one relevant skill without a separate LLM request."""
    es = get_es()
    try:
        query_vec = await get_embedding(query, is_query=True)
        if not query_vec:
            return []
        resp = await es.search(
            index=SKILLS_INDEX,
            knn={
                "field": "embedding",
                "query_vector": query_vec,
                "k": MAX_SELECTED_SKILLS,
                "num_candidates": 20,
                "filter": {"term": {"enabled": True}},
            },
            size=MAX_SELECTED_SKILLS,
            _source=["name", "instructions"],
            ignore_unavailable=True,
        )
        hits = resp.get("hits", {}).get("hits", [])
        if not hits:
            logger.info("[skills] 매칭 결과 없음 (enabled 스킬 없거나 임베딩 미존재)")
            return []

        top1 = hits[0]
        score1 = top1["_score"]

        if score1 < MATCH_THRESHOLD:
            logger.info("[skills] 매칭 스킵: top1=%s (score=%.4f < %.2f)", top1["_source"]["name"], score1, MATCH_THRESHOLD)
            return []

        item = {"name": top1["_source"]["name"], "instructions": top1["_source"]["instructions"], "score": score1}
        if item["name"] == "data-validation":
            item["instructions"] += "\n\n" + calculation_context(query, None)
        logger.info("[skills] 매칭 적용: %s(%.4f)", item["name"], score1)
        return [item]
    except Exception as e:
        logger.warning("[skills] 매칭 실패: %s", e)
        return []
    finally:
        await es.close()
