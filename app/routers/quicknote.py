"""
quicknote.py – 빠른 메모(todo형) CRUD 라우터

GET    /api/quicknote          → 목록 (미완료 먼저, 그 안에서 최신순)
POST   /api/quicknote          → 생성
PUT    /api/quicknote/{id}     → 텍스트 수정
PATCH  /api/quicknote/{id}/done→ 완료 토글
DELETE /api/quicknote/{id}     → 삭제

빠른 메모는 메모 하나당 임베딩 하나를 저장하여 일반 메모 RAG 검색에 함께 사용한다.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from logger import get_logger
from services.db import QUICKNOTE_INDEX, get_es
from services.indexer import get_embedding

logger = get_logger(__name__)
router = APIRouter()


class QuickNoteBody(BaseModel):
    text: str


class QuickNoteDoneBody(BaseModel):
    done: bool


@router.get("/quicknote")
async def list_quicknotes(size: int = 200):
    """미완료(done=false) 먼저, 각 그룹 안에서 updated_at 내림차순."""
    es = get_es()
    try:
        res = await es.search(
            index=QUICKNOTE_INDEX,
            size=size,
            sort=[
                {"done": {"order": "asc"}},          # false(미완료)가 먼저
                {"created_at": {"order": "desc"}},   # 그 안에서 생성 최신순
            ],
            _source=["id", "text", "done", "created_at", "updated_at"],
        )
        notes = [{**h["_source"]} for h in res["hits"]["hits"]]
        return {"notes": notes, "total": res["hits"]["total"]["value"]}
    finally:
        await es.close()


@router.post("/quicknote")
async def create_quicknote(body: QuickNoteBody):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="내용을 입력하세요.")
    es = get_es()
    try:
        note_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": note_id,
            "text": text,
            "done": False,
            "created_at": now,
            "updated_at": now,
        }
        embedding = await get_embedding(text)
        if embedding:
            doc["embedding"] = embedding
        await es.index(index=QUICKNOTE_INDEX, id=note_id, document=doc, refresh=True)
        return doc
    finally:
        await es.close()


@router.put("/quicknote/{note_id}")
async def update_quicknote(note_id: str, body: QuickNoteBody):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="내용을 입력하세요.")
    es = get_es()
    try:
        now = datetime.now(timezone.utc).isoformat()
        embedding = await get_embedding(text)
        doc = {"text": text, "updated_at": now}
        if embedding:
            doc["embedding"] = embedding
        await es.update(
            index=QUICKNOTE_INDEX, id=note_id,
            doc=doc, refresh=True,
        )
        return {"id": note_id, "text": text, "updated_at": now}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    finally:
        await es.close()


@router.patch("/quicknote/{note_id}/done")
async def toggle_done(note_id: str, body: QuickNoteDoneBody):
    es = get_es()
    try:
        now = datetime.now(timezone.utc).isoformat()
        await es.update(
            index=QUICKNOTE_INDEX, id=note_id,
            doc={"done": body.done, "updated_at": now}, refresh=True,
        )
        return {"id": note_id, "done": body.done, "updated_at": now}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    finally:
        await es.close()


@router.delete("/quicknote/{note_id}")
async def delete_quicknote(note_id: str):
    es = get_es()
    try:
        await es.delete(index=QUICKNOTE_INDEX, id=note_id, refresh=True)
        return {"deleted": note_id}
    except Exception:
        raise HTTPException(status_code=404, detail="메모를 찾을 수 없습니다.")
    finally:
        await es.close()
