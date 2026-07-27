"""
routers/scripts.py – 스크립트 연습 CRUD
ES 인덱스: voice_scripts
구조: { id, title, language, pairs: [{a, a_ko, b, b_ko}], created_at }
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.db import get_es

router = APIRouter()

SCRIPTS_INDEX = "voice_scripts"


async def _ensure_scripts_index():
    es = get_es()
    try:
        if not await es.indices.exists(index=SCRIPTS_INDEX):
            await es.indices.create(index=SCRIPTS_INDEX, body={
                "settings": {"number_of_shards": 1, "number_of_replicas": 0},
                "mappings": {"properties": {
                    "id":         {"type": "keyword"},
                    "title":      {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                    "language":   {"type": "keyword"},
                    "raw":        {"type": "text", "index": False},   # 원본 붙여넣기 텍스트
                    "created_at": {"type": "date"},
                }},
            })
    finally:
        await es.close()


# ── Pydantic ──────────────────────────────────────────────
class ScriptPair(BaseModel):
    a: str       # A 문장 (내가 말할 문장)
    a_ko: str    # A 해석
    b: str       # B 문장 (상대방 응답)
    b_ko: str    # B 해석


class ScriptCreateRequest(BaseModel):
    title: str
    language: str = "en-US"
    pairs: list[ScriptPair]
    raw: str = ""   # 원본 붙여넣기 텍스트 (보관용)


class ScriptUpdateRequest(BaseModel):
    title: str | None = None
    language: str | None = None
    pairs: list[ScriptPair] | None = None
    raw: str | None = None


# ── Routes ────────────────────────────────────────────────

@router.get("/scripts")
async def list_scripts():
    await _ensure_scripts_index()
    es = get_es()
    try:
        res = await es.search(
            index=SCRIPTS_INDEX,
            body={
                "size": 200,
                "sort": [{"created_at": {"order": "desc"}}],
                "_source": ["id", "title", "language", "created_at"],
            },
        )
        scripts = [
            {
                "id": h["_source"]["id"],
                "title": h["_source"]["title"],
                "language": h["_source"].get("language", "en-US"),
                "created_at": h["_source"].get("created_at", ""),
            }
            for h in res["hits"]["hits"]
        ]
        return {"scripts": scripts}
    finally:
        await es.close()


@router.get("/scripts/{script_id}")
async def get_script(script_id: str):
    await _ensure_scripts_index()
    es = get_es()
    try:
        res = await es.get(index=SCRIPTS_INDEX, id=script_id, ignore=[404])
        if not res.get("found"):
            raise HTTPException(404, "Script not found")
        return res["_source"]
    finally:
        await es.close()


@router.post("/scripts")
async def create_script(req: ScriptCreateRequest):
    await _ensure_scripts_index()
    es = get_es()
    try:
        script_id = str(uuid.uuid4())[:8]
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        doc = {
            "id": script_id,
            "title": req.title,
            "language": req.language,
            "pairs": [p.dict() for p in req.pairs],
            "raw": req.raw,
            "created_at": now,
        }
        await es.index(index=SCRIPTS_INDEX, id=script_id, document=doc, refresh=True)
        return {"ok": True, "id": script_id, "script": doc}
    finally:
        await es.close()


@router.put("/scripts/{script_id}")
async def update_script(script_id: str, req: ScriptUpdateRequest):
    await _ensure_scripts_index()
    es = get_es()
    try:
        existing = await es.get(index=SCRIPTS_INDEX, id=script_id, ignore=[404])
        if not existing.get("found"):
            raise HTTPException(404, "Script not found")

        doc = existing["_source"]
        if req.title is not None:
            doc["title"] = req.title
        if req.language is not None:
            doc["language"] = req.language
        if req.pairs is not None:
            doc["pairs"] = [p.dict() for p in req.pairs]
        if req.raw is not None:
            doc["raw"] = req.raw

        await es.index(index=SCRIPTS_INDEX, id=script_id, document=doc, refresh=True)
        return {"ok": True, "script": doc}
    finally:
        await es.close()


@router.delete("/scripts/{script_id}")
async def delete_script(script_id: str):
    await _ensure_scripts_index()
    es = get_es()
    try:
        await es.delete(index=SCRIPTS_INDEX, id=script_id, ignore=[404], refresh=True)
        return {"ok": True}
    finally:
        await es.close()