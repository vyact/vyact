"""
memo.py – 메모 CRUD 라우터
GET    /api/memo          → 메모 목록
POST   /api/memo          → 메모 생성
GET    /api/memo/{id}     → 메모 상세
PUT    /api/memo/{id}     → 메모 수정
DELETE /api/memo/{id}     → 메모 삭제
"""
import shutil
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

from config import INSTALL_DIR
from logger import get_logger
from services.db import MEMO_INDEX, get_es
from services.indexer import get_embedding
from bs4 import BeautifulSoup

logger = get_logger(__name__)
router = APIRouter()
MEMO_ATTACHMENTS_DIR = INSTALL_DIR / "uploads" / "memo_attachments"
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024


def _html_to_text(html: str) -> str:
    """Tiptap HTML → 순수 텍스트 (RAG 인덱싱용)"""
    try:
        soup = BeautifulSoup(html, "html.parser")
        return soup.get_text(separator="\n", strip=True)
    except Exception:
        return html


def _html_to_title(html: str) -> str:
    """첫 번째 텍스트 줄을 제목으로 추출 (p, h1~h3 순서 무관하게 DOM 순서 기준)"""
    try:
        soup = BeautifulSoup(html, "html.parser")
        # DOM 순서대로 첫 번째 텍스트 노드 찾기
        for el in soup.find_all(["p", "h1", "h2", "h3", "h4", "li"]):
            text = el.get_text(strip=True)
            if text:
                return text[:100]
        return "제목 없음"
    except Exception:
        return "제목 없음"


class MemoBody(BaseModel):
    content_html: str  # Tiptap HTML
    title: Optional[str] = None


def _attachment_dir(memo_id: str) -> Path:
    try:
        return MEMO_ATTACHMENTS_DIR / str(uuid.UUID(memo_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="유효하지 않은 메모 ID입니다.")


def _cleanup_unreferenced_attachments(memo_id: str, content_html: str) -> None:
    """현재 메모 HTML에서 참조하지 않는 첨부 원본을 제거한다."""
    attachment_dir = _attachment_dir(memo_id)
    if not attachment_dir.exists():
        return
    prefix = f"/api/memo/{memo_id}/attachments/"
    referenced_names: set[str] = set()
    try:
        soup = BeautifulSoup(content_html, "html.parser")
        for element in soup.find_all(["img", "a"]):
            url = element.get("src") or element.get("href") or ""
            if url.startswith(prefix):
                referenced_names.add(Path(url.removeprefix(prefix)).name)
    except Exception:
        logger.warning("메모 첨부 참조 분석 실패: %s", memo_id)
        return

    for path in attachment_dir.iterdir():
        if path.is_file() and path.name not in referenced_names:
            path.unlink(missing_ok=True)
    try:
        attachment_dir.rmdir()
    except OSError:
        pass


# ─────────────────────────────
# GET /api/memo
# ─────────────────────────────
@router.get("/memo")
async def list_memos(size: int = 50, from_: int = 0):
    es = get_es()
    try:
        res = await es.search(
            index=MEMO_INDEX,
            size=size,
            from_=from_,
            sort=[{"updated_at": {"order": "desc"}}],
            _source=["id", "title", "content", "created_at", "updated_at"],
        )
        memos = [
            {**h["_source"], "_id": h["_id"]}
            for h in res["hits"]["hits"]
        ]
        return {"memos": memos, "total": res["hits"]["total"]["value"]}
    finally:
        await es.close()


# ─────────────────────────────
# POST /api/memo
# ─────────────────────────────
@router.post("/memo")
async def create_memo(body: MemoBody):
    es = get_es()
    try:
        memo_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        text = _html_to_text(body.content_html)
        title = body.title or _html_to_title(body.content_html)
        embedding = await get_embedding(f"{title}\n{text}")

        doc = {
            "id": memo_id,
            "title": title,
            "content": text,
            "content_html": body.content_html,
            "source": "memo",
            "created_at": now,
            "updated_at": now,
        }
        if embedding:
            doc["embedding"] = embedding

        await es.index(index=MEMO_INDEX, id=memo_id, document=doc, refresh=True)
        return {"id": memo_id, "title": title, "created_at": now}
    finally:
        await es.close()


# ─────────────────────────────
# GET /api/memo/{id}
# ─────────────────────────────
@router.get("/memo/{memo_id}")
async def get_memo(memo_id: str):
    es = get_es()
    try:
        res = await es.get(index=MEMO_INDEX, id=memo_id)
        return {**res["_source"], "_id": res["_id"]}
    except Exception:
        raise HTTPException(status_code=404, detail="메모를 찾을 수 없습니다.")
    finally:
        await es.close()


@router.post("/memo/{memo_id}/attachments")
async def upload_memo_attachment(memo_id: str, file: UploadFile = File(...)):
    """메모 전용 첨부를 저장하고 본문 삽입에 사용할 URL을 반환한다."""
    attachment_dir = _attachment_dir(memo_id)
    es = get_es()
    try:
        if not await es.exists(index=MEMO_INDEX, id=memo_id):
            raise HTTPException(status_code=404, detail="메모를 찾을 수 없습니다.")
    finally:
        await es.close()

    # macOS 파일 선택기는 한글 파일명을 NFD(자소 분리)로 보낼 수 있어 채팅 첨부와 동일하게 NFC로 정규화한다.
    original_name = Path(unicodedata.normalize("NFC", file.filename or "attachment")).name
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="빈 파일은 첨부할 수 없습니다.")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="첨부 파일은 50MB 이하만 가능합니다.")

    attachment_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}_{original_name}"
    (attachment_dir / stored_name).write_bytes(content)
    return {
        "filename": original_name,
        "mime_type": file.content_type or "application/octet-stream",
        "url": f"/api/memo/{memo_id}/attachments/{stored_name}",
    }


@router.get("/memo/{memo_id}/attachments/{stored_name}")
async def get_memo_attachment(memo_id: str, stored_name: str):
    attachment_dir = _attachment_dir(memo_id)
    path = attachment_dir / Path(stored_name).name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="첨부 파일을 찾을 수 없습니다.")
    return FileResponse(path, filename=path.name.split("_", 1)[-1])


@router.post("/memo/{memo_id}/attachments/cleanup")
async def cleanup_memo_attachments(memo_id: str, body: MemoBody):
    """편집 취소 시 원래 본문에 없는, 이번 편집에서 업로드된 첨부를 정리한다."""
    _cleanup_unreferenced_attachments(memo_id, body.content_html)
    return {"ok": True}


# ─────────────────────────────
# PUT /api/memo/{id}
# ─────────────────────────────
@router.put("/memo/{memo_id}")
async def update_memo(memo_id: str, body: MemoBody):
    es = get_es()
    try:
        now = datetime.now(timezone.utc).isoformat()
        text = _html_to_text(body.content_html)
        title = body.title or _html_to_title(body.content_html)
        embedding = await get_embedding(f"{title}\n{text}")

        doc = {
            "title": title,
            "content": text,
            "content_html": body.content_html,
            "updated_at": now,
        }
        if embedding:
            doc["embedding"] = embedding

        await es.update(index=MEMO_INDEX, id=memo_id, doc=doc, refresh=True)
        _cleanup_unreferenced_attachments(memo_id, body.content_html)
        return {"id": memo_id, "title": title, "updated_at": now}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    finally:
        await es.close()


# ─────────────────────────────
# DELETE /api/memo/{id}
# ─────────────────────────────
@router.delete("/memo/{memo_id}")
async def delete_memo(memo_id: str):
    es = get_es()
    try:
        await es.delete(index=MEMO_INDEX, id=memo_id, refresh=True)
        shutil.rmtree(_attachment_dir(memo_id), ignore_errors=True)
        return {"deleted": memo_id}
    except Exception:
        raise HTTPException(status_code=404, detail="메모를 찾을 수 없습니다.")
    finally:
        await es.close()
