"""
routers/chat_helpers.py – chat.py의 query/query_stream에서 공통으로 쓰이는 로직 모음.

query/query_stream 안에서 "어떤 흐름으로 동작하는지" 한눈에 보이도록
세부 구현을 여기로 분리한다.
"""
import re
from datetime import datetime, timezone

from services.db import DOC_CHUNKS_INDEX
from services.indexer import get_embedding, get_es as get_es_client
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


# ── file_id 기반 청크 RAG 검색 ──────────────────────────────────────────

async def search_file_id_chunks(question: str, articles: list) -> tuple[list[dict], list[dict]]:
    """articles를 direct_articles / file_id_articles로 분류하고,
    file_id가 있는 문서는 ES에서 청크 검색.

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

    file_chunks: list[dict] = []
    if file_id_articles:
        file_ids = [a["file_id"] for a in file_id_articles]
        es_client = get_es_client()
        try:
            embedding = await get_embedding(question)
            search_body = {
                "size": 30,
                "_source": ["title", "content", "url", "source", "indexed_at", "file_id",
                            "chunk_type", "heading_path", "page_number"],
                "query": {"terms": {"file_id": file_ids}},
            }
            if embedding:
                search_body["knn"] = {
                    "field": "embedding", "query_vector": embedding, "k": 30,
                    "num_candidates": 150, "filter": {"terms": {"file_id": file_ids}}, "boost": 2.0,
                }
            res = await es_client.search(index=DOC_CHUNKS_INDEX, body=search_body)
            file_chunks = [
                {
                    "title": h["_source"]["title"], "content": h["_source"]["content"],
                    "url": h["_source"]["url"], "source": h["_source"]["source"],
                    "indexed_at": h["_source"].get("indexed_at", ""),
                    "chunk_type": h["_source"].get("chunk_type", "paragraph"),
                    "heading_path": h["_source"].get("heading_path") or [],
                    "page_number": h["_source"].get("page_number"),
                    "score": round(h.get("_score") or 0, 3),
                }
                for h in res["hits"]["hits"]
            ]
        except Exception as e:
            logger.warning("file_id 청크 검색 실패: %s", e)
        finally:
            await es_client.close()

    return direct_docs, file_chunks


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
             "indexed_at": a.get("indexed_at", ""), "file_id": a.get("file_id")}
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
             "indexed_at": s.get("indexed_at", "")}
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
