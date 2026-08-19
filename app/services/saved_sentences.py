"""학습 중 저장한 문장을 관리한다."""
import hashlib
from datetime import datetime, timezone

from logger import get_logger
from services.db import SAVED_SENTENCES_INDEX, get_es

logger = get_logger(__name__)


def _sentence_doc_id(original_text: str, translated_text: str) -> str:
    normalized = f"{original_text.strip()}\n{translated_text.strip()}".lower()
    return hashlib.md5(normalized.encode("utf-8")).hexdigest()


async def save_sentence(**sentence: str) -> dict:
    original_text = (sentence.get("original_text") or "").strip()
    if not original_text:
        raise ValueError("original_text는 필수입니다")
    translated_text = (sentence.get("translated_text") or "").strip()
    doc_id = _sentence_doc_id(original_text, translated_text)
    document = {
        "original_text": original_text,
        "translated_text": translated_text,
        "source_language": (sentence.get("source_language") or "").strip(),
        "target_language": (sentence.get("target_language") or "").strip(),
        "source_url": (sentence.get("source_url") or "").strip(),
        "source_title": (sentence.get("source_title") or "").strip(),
        "saved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    es = get_es()
    try:
        await es.index(index=SAVED_SENTENCES_INDEX, id=doc_id, document=document, refresh=True)
        return {"id": doc_id, **document}
    finally:
        await es.close()


async def list_saved_sentences(query: str = "", size: int = 100, from_: int = 0) -> dict:
    es = get_es()
    try:
        search_query = ({"multi_match": {"query": query, "fields": ["original_text", "translated_text", "source_title"]}}
                        if query else {"match_all": {}})
        response = await es.search(index=SAVED_SENTENCES_INDEX, query=search_query,
                                   sort=[{"saved_at": {"order": "desc"}}],
                                   size=min(max(size, 1), 500), from_=max(from_, 0))
        hits = response["hits"]["hits"]
        return {"items": [{"id": hit["_id"], **hit["_source"]} for hit in hits],
                "total": response["hits"]["total"]["value"]}
    except Exception as error:
        logger.warning("저장 문장 조회 실패: %s", error)
        return {"items": [], "total": 0}
    finally:
        await es.close()


async def delete_saved_sentence(doc_id: str) -> bool:
    es = get_es()
    try:
        await es.delete(index=SAVED_SENTENCES_INDEX, id=doc_id, refresh=True, ignore=[404])
        return True
    finally:
        await es.close()
