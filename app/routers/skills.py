"""
routers/skills.py – 스킬 CRUD + 벡터 유사도 매칭

매칭 로직 (다이어그램):
  1. 질문 임베딩 → top2 kNN 조회
  2. top1 score < 0.85 → 스킬 없음
  3. top1 - top2 <= 0.02 → 둘 다 반환
  4. 그 외 → top1만 반환
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.db import get_es, KOREAN_ANALYSIS
from services.indexer import get_embedding
from logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/skills", tags=["skills"])

SKILLS_INDEX = "skills"

MATCH_THRESHOLD = 0.75   # top1 최소 cosine similarity
MATCH_GAP = 0.02         # top1-top2 차이가 이 이하면 둘 다 반환


# ── 인덱스 생성 ──────────────────────────────────────────────────
async def ensure_skills_index():
    es = get_es()
    try:
        if not await es.indices.exists(index=SKILLS_INDEX):
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
            logger.info("skills 인덱스 생성 완료")

        # 기본 스킬 등록 (최초 1회 — 인덱스에 문서가 없을 때만)
        count = (await es.count(index=SKILLS_INDEX)).get("count", 0)
        if count == 0:
            from config.default_skills import DEFAULT_SKILLS
            now = datetime.now(timezone.utc).isoformat()
            registered = 0
            for skill in DEFAULT_SKILLS:
                embedding = await get_embedding(skill["description"])
                doc = {
                    "name": skill["name"],
                    "description": skill["description"],
                    "instructions": skill["instructions"],
                    "enabled": True,
                    "created_at": now,
                    "updated_at": now,
                }
                if embedding:
                    doc["embedding"] = embedding
                else:
                    logger.warning("[skills] 기본 스킬 임베딩 실패: %s", skill["name"])
                await es.index(index=SKILLS_INDEX, document=doc, refresh=True)
                registered += 1
            logger.info("기본 스킬 %d개 등록 완료", registered)
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
            {"id": h["_id"], **{k: v for k, v in h["_source"].items() if k != "embedding"}}
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
            raise HTTPException(status_code=500, detail="임베딩 생성 실패 — Ollama bge-m3 모델 상태를 확인하세요.")
        doc = {
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
        update_doc: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if body.name is not None:
            update_doc["name"] = body.name.strip()
        if body.description is not None:
            update_doc["description"] = body.description.strip()
            embedding = await get_embedding(update_doc["description"])
            if not embedding:
                raise HTTPException(status_code=500, detail="임베딩 생성 실패 — Ollama bge-m3 모델 상태를 확인하세요.")
            update_doc["embedding"] = embedding
        if body.instructions is not None:
            update_doc["instructions"] = body.instructions.strip()
        if body.enabled is not None:
            update_doc["enabled"] = body.enabled
        await es.update(index=SKILLS_INDEX, id=skill_id, doc=update_doc, refresh=True)
        updated = await es.get(index=SKILLS_INDEX, id=skill_id)
        return {"id": skill_id, **{k: v for k, v in updated["_source"].items() if k != "embedding"}}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    finally:
        await es.close()


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str):
    es = get_es()
    try:
        await es.delete(index=SKILLS_INDEX, id=skill_id, refresh=True)
        return {"deleted": True}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    finally:
        await es.close()


# ── 벡터 유사도 매칭 ─────────────────────────────────────────────
async def match_skills(query: str) -> list[dict]:
    """사용자 질문 → 스킬 description 벡터 kNN 매칭.

    1. top1 < 0.85 → 빈 리스트
    2. top1 - top2 <= 0.02 → 둘 다
    3. 그 외 → top1만
    """
    query_vec = await get_embedding(query, is_query=True)
    if not query_vec:
        return []

    es = get_es()
    try:
        resp = await es.search(
            index=SKILLS_INDEX,
            knn={
                "field": "embedding",
                "query_vector": query_vec,
                "k": 2,
                "num_candidates": 20,
                "filter": {"term": {"enabled": True}},
            },
            size=2,
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

        result = [{"name": top1["_source"]["name"], "instructions": top1["_source"]["instructions"], "score": score1}]

        if len(hits) >= 2:
            top2 = hits[1]
            score2 = top2["_score"]
            if score1 - score2 <= MATCH_GAP:
                result.append({"name": top2["_source"]["name"], "instructions": top2["_source"]["instructions"], "score": score2})

        names = ", ".join(f"{r['name']}({r['score']:.4f})" for r in result)
        logger.info("[skills] 매칭 적용: %s", names)
        return result
    except Exception as e:
        logger.warning("[skills] 매칭 실패: %s", e)
        return []
    finally:
        await es.close()