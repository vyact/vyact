"""
routers/chat_helpers.py – chat.py의 query/query_stream에서 공통으로 쓰이는 로직 모음.

query/query_stream 안에서 "어떤 흐름으로 동작하는지" 한눈에 보이도록
세부 구현을 여기로 분리한다.
"""
import asyncio
import re
from datetime import datetime, timezone
from pathlib import Path

from services.db import DOCUMENT_ORIGINALS_INDEX, DOC_CHUNKS_INDEX, FILES_INDEX, WEB_DOCUMENTS_INDEX, WEB_DOC_CHUNKS_INDEX
from services.document_parser import parse_file
from services.indexer import get_es as get_es_client
from routers.deps import load_config_async
from agent import get_prompt_by_id
from logger import get_logger

logger = get_logger(__name__)

# ── 붙여넣기 마커 ──────────────────────────────────────────────────────────

PASTE_PATTERN = re.compile(r'«PASTE:(.*?)»\n([\s\S]*?)«/PASTE»')


def extract_paste_context(question: str) -> tuple[str, list[dict]]:
    """질문에서 «PASTE:...» 마커를 추출하여 context_docs 리스트로 변환.

    Returns:
        (clean_question, paste_context_docs)
    """
    matches = PASTE_PATTERN.findall(question)
    paste_docs = [
        {
            "title": label or "붙여넣기",
            "content": content,
            "source": "붙여넣기",
            "url": "",
            "score": 1.0,
            "indexed_at": "",
        }
        for label, content in matches
    ]
    clean = PASTE_PATTERN.sub('', question).strip()
    return clean, paste_docs


# ── 시스템 프롬프트 로드 ──────────────────────────────────────────────────

async def load_system_prompt(explicit_prompt: str) -> tuple[dict, str, str]:
    """설정 로드 + 시스템 프롬프트 결정.

    Returns:
        (cfg, current_model, system_prompt)
    """
    cfg = await load_config_async()
    current_model = cfg.get("model", "")
    system_prompt = explicit_prompt
    if not system_prompt:
        prompt_id = cfg.get("selected_prompt_id")
        if prompt_id:
            prompt = get_prompt_by_id(prompt_id)
            if prompt:
                system_prompt = prompt["content"]
    return cfg, current_model, system_prompt


# ── 첨부파일 분류 ──────────────────────────────────────────────────────────

def separate_attachments(attachments: list, paste_context: list[dict],
                         file_attachments_to_context_fn) -> tuple[list[dict], list[dict]]:
    """첨부파일을 file_context_docs(분석용)와 image_attachments(비전용)로 분리.

    Returns:
        (file_context_docs, image_attachments)
    """
    file_context_docs = file_attachments_to_context_fn(attachments) + paste_context
    image_attachments = [a for a in attachments if a.get("type") == "image"]
    return file_context_docs, image_attachments



# ── 이전 assistant의 article_sources에서 file_id 승계 ────────────────────

def inherit_articles_from_history(articles: list, messages: list) -> list:
    """req.articles가 비었으면 직전 assistant 응답의 article_sources에서 file_id를 추출해 주입."""
    if articles:
        return articles
    result = list(articles)
    for msg in reversed(messages or []):
        if msg.get("role") == "assistant":
            seen_fids: set[str] = set()
            for src in msg.get("article_sources", []):
                fid = src.get("file_id")
                if not fid:
                    url = src.get("url", "")
                    if url.startswith("file://"):
                        fid = url.replace("file://", "").split("::")[0]
                if fid and fid not in seen_fids:
                    seen_fids.add(fid)
                    result.append({
                        "title": src.get("title", ""),
                        "url": f"file://{fid}",
                        "source": src.get("source", ""),
                        "indexed_at": src.get("indexed_at", ""),
                        "file_id": fid,
                        "source_type": src.get("source_type", "document"),
                        "content": f"[인덱싱된 문서, {fid}]",
                    })
            break
    return result


def resolve_selected_articles(
    articles: list,
    messages: list,
    *,
    selection_explicit: bool = False,
) -> list:
    """명시적으로 선택한 문서·미디어 첨부를 유지하고, 해제된 이전 문서의 자동 승계를 막는다."""
    return list(articles) if selection_explicit else inherit_articles_from_history(articles, messages)


# ── 저장 문서 원문 컨텍스트 ─────────────────────────────────────────────

SAVED_DOCUMENT_CONTEXT_MAX_CHARS = 30_000
DIRECT_DOCUMENT_TOTAL_MAX_CHARS = 30_000


def limit_direct_document_contexts(docs: list[dict]) -> list[dict]:
    """명시적으로 첨부한 문서 원문이 컨텍스트를 무한히 점유하지 않게 제한한다."""
    document_indexes = [index for index, doc in enumerate(docs) if doc.get("direct_document")]
    if not document_indexes:
        return docs
    per_document_limit = max(1, DIRECT_DOCUMENT_TOTAL_MAX_CHARS // len(document_indexes))
    limited = list(docs)
    for index in document_indexes:
        document = dict(limited[index])
        document["content"] = document.get("content", "")[:per_document_limit]
        limited[index] = document
    return limited


async def _load_legacy_document_original(es_client, document_id: str, article: dict) -> dict | None:
    """원문 레코드가 없던 기존 저장 파일을 원본 파일에서 한 번만 보완한다."""
    try:
        file_metadata = await es_client.get(index=FILES_INDEX, id=document_id)
        metadata = file_metadata["_source"]
        original_path = Path(metadata.get("original_path", ""))
        if not original_path.is_file():
            return None
        content = (await asyncio.to_thread(parse_file, original_path)).strip()
        if not content:
            return None
        now = datetime.now(timezone.utc).isoformat()
        original = {
            "document_id": document_id,
            "source_type": "document",
            "title": metadata.get("filename", article.get("title", "")),
            "content": content,
            "url": f"file://{document_id}",
            "file_ext": metadata.get("file_ext", ""),
            "content_length": len(content),
            "created_at": metadata.get("indexed_at", now),
            "updated_at": now,
        }
        await es_client.index(index=DOCUMENT_ORIGINALS_INDEX, id=document_id, document=original, refresh=True)
        return original
    except Exception as error:
        logger.warning("기존 저장 문서 원문 보완 실패 (%s): %s", document_id, error)
        return None

async def search_file_id_chunks(question: str, articles: list) -> tuple[list[dict], list[dict]]:
    """articles를 direct_articles / 저장 문서 참조로 분류한다.

    저장된 문서를 사용자가 명시적으로 채팅에 첨부한 경우에는, 새 파일 첨부와
    동일하게 원문(최대 30,000자)을 이번 질문의 직접 컨텍스트로 제공한다.
    영구 인덱스의 청크를 순서대로 합칠 뿐 대화 전용 청크를 다시 저장하지 않는다.

    Returns:
        (direct_article_docs, file_chunks)
    """
    direct_articles = []
    file_id_articles = []
    for a in articles:
        if a.get("file_id") and not a.get("content", "").strip().startswith("[인덱싱된 문서"):
            direct_articles.append(a)
        elif a.get("file_id"):
            file_id_articles.append(a)
        else:
            direct_articles.append(a)

    direct_docs = [
        {
            "title": a.get("title", ""), "content": a.get("content", ""),
            "source": a.get("source", ""), "url": a.get("url", ""),
            "score": 1.0, "indexed_at": a.get("indexed_at", ""),
        }
        for a in direct_articles
    ]

    saved_document_docs: list[dict] = []
    if file_id_articles:
        es_client = get_es_client()
        try:
            try:
                originals = await es_client.mget(
                    index=DOCUMENT_ORIGINALS_INDEX,
                    ids=[article["file_id"] for article in file_id_articles],
                )
            except Exception as error:
                logger.warning("저장 문서 원문 인덱스 조회 실패: %s", error)
                originals = {"docs": []}
            originals_by_id = {
                item["_id"]: item["_source"]
                for item in originals.get("docs", [])
                if item.get("found") and item.get("_source", {}).get("content", "").strip()
            }
            for article in file_id_articles:
                document_id = article["file_id"]
                source_type = article.get("source_type", "document")
                original = originals_by_id.get(document_id)
                if not original and source_type != "web":
                    original = await _load_legacy_document_original(es_client, document_id, article)
                if original:
                    saved_document_docs.append({
                        "title": original.get("title", article.get("title", "")),
                        "content": original["content"],
                        "url": original.get("url", article.get("url", "")),
                        "source": original.get("source_type", source_type), "score": 1.0,
                        "indexed_at": original.get("updated_at", article.get("indexed_at", "")),
                        "file_id": document_id, "source_type": source_type, "direct_document": True,
                    })
                    continue
                if source_type == "web":
                    web_document = await es_client.get(index=WEB_DOCUMENTS_INDEX, id=document_id)
                    source = web_document["_source"]
                    content = source.get("content", "").strip()
                    if content:
                        saved_document_docs.append({
                            "title": source.get("title", article.get("title", "")),
                            "content": content[:SAVED_DOCUMENT_CONTEXT_MAX_CHARS], "url": source.get("url", article.get("url", "")),
                        "source": "web", "score": 1.0, "indexed_at": source.get("updated_at", ""),
                            "file_id": document_id, "source_type": "web", "direct_document": True,
                        })
                    continue
                index = WEB_DOC_CHUNKS_INDEX if source_type == "web" else DOC_CHUNKS_INDEX
                id_field = "web_document_id" if source_type == "web" else "file_id"
                response = await es_client.search(index=index, body={
                    "size": 500,
                    "query": {"term": {id_field: document_id}},
                    "sort": [{"chunk_index": {"order": "asc"}}],
                    "_source": ["content", "url", "source", "indexed_at"],
                })
                chunks = response["hits"]["hits"]
                content = "\n\n".join(hit["_source"].get("content", "") for hit in chunks).strip()
                if content:
                    first = chunks[0]["_source"]
                    saved_document_docs.append({
                        "title": article.get("title", ""), "content": content[:SAVED_DOCUMENT_CONTEXT_MAX_CHARS],
                        "url": first.get("url", article.get("url", "")), "source": first.get("source", article.get("source", "")),
                        "score": 1.0, "indexed_at": first.get("indexed_at", article.get("indexed_at", "")),
                        "file_id": document_id, "source_type": source_type, "direct_document": True,
                    })
        except Exception as e:
            logger.warning("저장 문서 원문 조회 실패: %s", e)
        finally:
            await es_client.close()

    return direct_docs + saved_document_docs, []


# ── 히스토리 저장용 메시지 빌드 ──────────────────────────────────────────

def build_injected_context(sources: list[dict]) -> list[dict]:
    """이번 응답에 주입한 비메모 소스를 검증용으로 저장한다.

    이 데이터는 UI의 "주입된 데이터" 모달 전용이다. 대화 이력에 다시 주입하지
    않으므로, 문서 청크를 저장해도 다음 턴의 토큰을 불필요하게 점유하지 않는다.
    """
    return [
        {"source": s.get("source", s.get("title", "")), "title": s.get("title", ""), "data": s.get("content", "")}
        for s in sources
        if s.get("content")
        and s.get("source") not in ("", None, "memo", "quicknote", "붙여넣기")
    ]


def build_user_message(
    original_question: str, user_ts: str,
    attachments: list | None = None,
    articles: list | None = None,
) -> dict:
    """히스토리 저장용 user 메시지 빌드."""
    msg: dict = {"role": "user", "content": original_question, "timestamp": user_ts}
    if attachments:
        msg["attachments"] = attachments
    if articles:
        msg["article_sources"] = [
            {"title": a.get("title", ""), "url": a.get("url", ""), "source": a.get("source", ""),
             "indexed_at": a.get("indexed_at", ""), "file_id": a.get("file_id"), "source_type": a.get("source_type", "document")}
            for a in articles
        ]
    return msg


def build_assistant_message(
    answer: str, model: str,
    article_sources: list | None = None,
    injected_context: list | None = None,
    stats: dict | None = None,
) -> dict:
    """히스토리 저장용 assistant 메시지 빌드."""
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    msg: dict = {"role": "assistant", "content": answer, "timestamp": now, "model": model}
    if article_sources:
        msg["article_sources"] = [
            {"title": s.get("title", ""), "url": s.get("url", ""), "source": s.get("source", ""),
             "indexed_at": s.get("indexed_at", ""), "file_id": s.get("file_id"), "source_type": s.get("source_type", "document")}
            for s in article_sources
        ]
    if injected_context:
        msg["injected_context"] = injected_context
    if stats:
        msg["stats"] = stats
    return msg


def filter_article_sources(sources: list[dict]) -> list[dict]:
    """붙여넣기를 제외한 article_sources 필터."""
    return [s for s in sources if s.get("source") != "붙여넣기"]
