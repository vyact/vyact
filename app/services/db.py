"""
db.py – ES 클라이언트 / 인덱스 상수 / 인덱스 초기화
ES 9.x 최적화
"""
import os
import asyncio

from elasticsearch import AsyncElasticsearch
from logger import get_logger

logger = get_logger(__name__)

# vyact 전용 ES 포트. 업무용 등 별도 ES(기본 9200/9300)와 충돌하지 않도록
# 9251/9351 사용. 환경변수로 오버라이드 가능.
ES_PORT = os.getenv("ES_PORT", "9251")           # HTTP (REST API)
ES_TRANSPORT_PORT = os.getenv("ES_TRANSPORT_PORT", "9351")  # 노드 간 transport
KIBANA_PORT = os.getenv("KIBANA_PORT", "5651")   # Kibana (기본 5601 회피)
ES_URL = os.getenv("ES_URL", f"http://localhost:{ES_PORT}")

LANGUAGES = ("ko", "en", "ja", "zh", "th", "vi", "es", "fr", "und")
INDEX_NAME = "rag_documents_all"
DOC_CHUNKS_INDEX = "doc_chunks_all"   # 파일 업로드 청크 전용 read alias
WEB_DOC_CHUNKS_INDEX = "web_doc_chunks_all"  # 저장한 웹 문서 청크 전용 read alias
CHAT_FILE_CHUNKS_INDEX = "chat_file_chunks"   # 채팅 첨부(zip/파일) 청크 전용 인덱스 — conv_id 종속, 방 삭제 시 cascade
HIST_INDEX = "rag_history"
PROJECTS_INDEX = "projects"
PROMPTS_INDEX = "system_prompts"
SETTINGS_INDEX = "system_settings"
FILES_INDEX = "rag_files"
WEB_DOCUMENTS_INDEX = "web_documents"
DOCUMENT_ORIGINALS_INDEX = "document_originals"
MEMO_INDEX = "memo_documents_all"
QUICKNOTE_INDEX = "quick_notes_all"   # 빠른 메모(todo형) — 메모 RAG 검색 대상
KNOWLEDGE_COLLECTIONS_INDEX = "knowledge_collections"
EMAIL_THREADS_INDEX = "knowledge_email_threads_all"
USER_PROFILE_INDEX = "user_profile"
VOCAB_INDEX = "vocab_words"
NOTIFICATIONS_INDEX = "notifications"

# 공통 분석기 설정 (nori)
KOREAN_ANALYSIS = {
    "tokenizer": {
        "korean_tokenizer": {
            "type": "nori_tokenizer",
            "decompound_mode": "mixed",
            "discard_punctuation": True,
        }
    },
    "filter": {
        "korean_pos_filter": {
            "type": "nori_part_of_speech",
            "stoptags": [
                "IC",
                "MAG", "MAJ", "MM",
                "SP", "SSC", "SSO", "SC", "SE",
                "XPN", "XSA", "XSN", "XSV",
                "UNA", "NA", "VSV",
            ],
        }
    },
    "analyzer": {
        "korean": {
            "type": "custom",
            "tokenizer": "korean_tokenizer",
            "filter": ["lowercase", "korean_pos_filter"],
        }
    },
}

LANGUAGE_ANALYSIS = {
    "ko": (KOREAN_ANALYSIS, "korean"), "ja": ({}, "kuromoji"), "zh": ({}, "smartcn"),
    "th": ({}, "thai"), "en": ({}, "english"), "fr": ({}, "french"), "es": ({}, "spanish"),
    "vi": ({"analyzer": {"unicode": {"type": "custom", "tokenizer": "standard", "char_filter": ["icu_normalizer"], "filter": ["lowercase", "icu_folding"]}}}, "unicode"),
    "und": ({"analyzer": {"unicode": {"type": "custom", "tokenizer": "standard", "char_filter": ["icu_normalizer"], "filter": ["lowercase", "icu_folding"]}}}, "unicode"),
}
INDEX_FAMILIES = ("rag_documents", "doc_chunks", "web_doc_chunks", "memo_documents", "quick_notes", "knowledge_email_threads")

def get_language_index(index_family: str, language: str) -> str:
    if index_family not in INDEX_FAMILIES:
        raise ValueError(f"Unknown language index family: {index_family}")
    return f"{index_family}_{language if language in LANGUAGES else 'und'}"

async def find_document_index(es, alias: str, document_id: str) -> str | None:
    """Resolve an ID through a multi-index read alias before single-document writes."""
    response = await es.search(index=alias, size=1, query={"ids": {"values": [document_id]}}, _source=False)
    hits = response.get("hits", {}).get("hits", [])
    return hits[0]["_index"] if hits else None

def _vector_mapping():
    return {"type": "dense_vector", "dims": 1024, "index": True, "similarity": "cosine", "index_options": {"type": "bbq_hnsw", "m": 16, "ef_construction": 100}}

def _language_mapping(family: str, analyzer: str) -> dict:
    text = lambda **extra: {"type": "text", "analyzer": analyzer, **extra}
    common = {
        "id": {"type": "keyword"},
        "title": text(fields={"keyword": {"type": "keyword", "ignore_above": 512}}),
        "content": text(),
        "source": {"type": "keyword"},
        "content_language": {"type": "keyword"},
        "created_at": {"type": "date"},
        "updated_at": {"type": "date"},
        "indexed_at": {"type": "date"},
        "embedding": _vector_mapping(),
    }
    if family == "rag_documents":
        return {**common, "url":{"type":"keyword"}, "doc_hash":{"type":"keyword"}, "file_id":{"type":"keyword"}, "news_type":{"type":"keyword"}, "original_file":{"type":"keyword"}, "chunk_index":{"type":"integer"}, "total_chunks":{"type":"integer"}, "content_length":{"type":"integer"}, "embedding_model":{"type":"keyword"}, "chunk_type":{"type":"keyword"}}
    if family == "doc_chunks":
        return {**common, "url":{"type":"keyword"}, "doc_hash":{"type":"keyword"}, "file_id":{"type":"keyword"}, "original_file":{"type":"keyword"}, "chunk_index":{"type":"integer"}, "total_chunks":{"type":"integer"}, "content_length":{"type":"integer"}, "embedding_model":{"type":"keyword"}, "chunk_type":{"type":"keyword"}, "heading_path":{"type":"keyword"}, "page_number":{"type":"integer"}}
    if family == "web_doc_chunks":
        return {**common, "url":{"type":"keyword"}, "web_document_id":{"type":"keyword"}, "chunk_index":{"type":"integer"}, "total_chunks":{"type":"integer"}, "content_length":{"type":"integer"}, "embedding_model":{"type":"keyword"}}
    if family == "memo_documents":
        return {**common, "content_html": {"type": "text", "index": False}}
    if family == "quick_notes":
        return {**common, "done": {"type": "boolean"}}
    return {**common, "account_id":{"type":"keyword"}, "thread_id":{"type":"keyword"}, "message_count":{"type":"integer"}, "display_messages":{"type":"object", "enabled":False}, "inline_images":{"type":"object", "enabled":False}, "attachments":{"type":"object", "enabled":False}}

async def ensure_language_indices(es) -> None:
    for family in INDEX_FAMILIES:
        alias = f"{family}_all"
        for language in LANGUAGES:
            index = get_language_index(family, language)
            if not await es.indices.exists(index=index):
                analysis, analyzer = LANGUAGE_ANALYSIS[language]
                await es.indices.create(index=index, settings={"number_of_shards": 1, "number_of_replicas": 0, "analysis": analysis}, mappings={"properties": _language_mapping(family, analyzer)})
            await es.indices.update_aliases(actions=[{"add": {"index": index, "alias": alias}}])


# ── ES 싱글턴 클라이언트 ──────────────────────────────────────────
_shared_es_client: AsyncElasticsearch | None = None


class SharedElasticsearchClient:
    """기존 try/finally 호출 계약을 유지하면서 연결 풀을 공유하는 경량 프록시."""

    def __init__(self, client: AsyncElasticsearch):
        self._client = client

    def __getattr__(self, name):
        return getattr(self._client, name)

    async def close(self) -> None:
        # 기존 호출부의 `await es.close()`는 요청 단위 lease 반환으로 취급한다.
        # 실제 공유 transport는 애플리케이션 종료 시 close_shared_es()가 닫는다.
        return None


def get_es() -> SharedElasticsearchClient:
    global _shared_es_client
    if _shared_es_client is None:
        _shared_es_client = AsyncElasticsearch(ES_URL)
    return SharedElasticsearchClient(_shared_es_client)


async def close_shared_es() -> None:
    global _shared_es_client
    client = _shared_es_client
    _shared_es_client = None
    if client is not None:
        await client.close()


async def wait_for_es(es, retries=30):
    for i in range(retries):
        try:
            health = await es.cluster.health()
            status = health.get("status")
            logger.info("⏳ ES status: %s", status)
            if status in ("yellow", "green"):
                return True
        except Exception as e:
            logger.info("ES 대기 중... %s", str(e))
        await asyncio.sleep(1)
    return False


async def ensure_index():
    """현재 지원하는 ES 인덱스를 생성한다 (ES 9.x 최적화)."""
    es = get_es()
    try:
        if not await wait_for_es(es):
            raise Exception("Elasticsearch 준비 안됨")
        logger.info("✅ Connected to ES")
        await ensure_language_indices(es)

        # ── rag_history ────────────────────────────────────────────
        if not await es.indices.exists(index=HIST_INDEX):
            await es.indices.create(
                index=HIST_INDEX,
                settings={"number_of_shards": 1, "number_of_replicas": 0},
                mappings={"properties": {
                    "conv_id": {"type": "keyword"},
                    "title": {"type": "text"},
                    "messages": {"type": "object", "enabled": False},
                    "created_at": {"type": "date"},
                    "updated_at": {"type": "date"},
                    "is_favorite": {"type": "boolean"},
                }},
            )
            logger.info("rag_history 인덱스 생성 완료")

        # ── system_prompts ─────────────────────────────────────────
        if not await es.indices.exists(index=PROMPTS_INDEX):
            await es.indices.create(
                index=PROMPTS_INDEX,
                settings={"number_of_shards": 1, "number_of_replicas": 0},
                mappings={"properties": {
                    "id": {"type": "keyword"},
                    "title": {"type": "text"},
                    "content": {"type": "text"},
                }},
            )
            logger.info("system_prompts 인덱스 생성 완료")

        # ── notifications ──────────────────────────────────────────
        if not await es.indices.exists(index=NOTIFICATIONS_INDEX):
            await es.indices.create(
                index=NOTIFICATIONS_INDEX,
                settings={"number_of_shards": 1, "number_of_replicas": 0},
                mappings={"properties": {
                    "type": {"type": "keyword"}, "source_id": {"type": "keyword"},
                    "account_id": {"type": "keyword"}, "account_email": {"type": "keyword"},
                    "title": {"type": "text"}, "message": {"type": "text"},
                    "is_read": {"type": "boolean"}, "created_at": {"type": "date"},
                    "occurred_at": {"type": "date"},
                }},
            )
            logger.info("notifications 인덱스 생성 완료")
        else:
            await es.indices.put_mapping(
                index=NOTIFICATIONS_INDEX,
                properties={
                    "account_id": {"type": "keyword"},
                    "account_email": {"type": "keyword"},
                },
            )

        # ── system_settings ────────────────────────────────────────
        if not await es.indices.exists(index=SETTINGS_INDEX):
            await es.indices.create(
                index=SETTINGS_INDEX,
                settings={"number_of_shards": 1, "number_of_replicas": 0},
                mappings={"properties": {
                    "key": {"type": "keyword"},
                    "value": {"type": "object", "enabled": False},
                    "google_granted_scopes": {"type": "keyword"},
                    "google_account_key": {"type": "keyword"},
                    "google_account_slot_id": {"type": "keyword"},
                    "google_access_token_expires_at": {
                        "type": "date",
                        "format": "strict_date_optional_time||epoch_millis",
                    },
                }},
            )
            logger.info("system_settings 인덱스 생성 완료")
        else:
            # 기존 설치에도 Google OAuth 권한/만료 메타데이터 필드를 추가한다.
            await es.indices.put_mapping(
                index=SETTINGS_INDEX,
                properties={
                    "google_granted_scopes": {"type": "keyword"},
                    "google_account_key": {"type": "keyword"},
                    "google_account_slot_id": {"type": "keyword"},
                    "google_access_token_expires_at": {
                        "type": "date",
                        "format": "strict_date_optional_time||epoch_millis",
                    },
                },
            )

        # ── chat_file_chunks ───────────────────────────────────────
        # 채팅 중 첨부한 zip/파일 청크 전용 (doc_chunks와 분리 — 대화방 종속, 방 삭제 시 cascade 삭제)
        if not await es.indices.exists(index=CHAT_FILE_CHUNKS_INDEX):
            await es.indices.create(
                index=CHAT_FILE_CHUNKS_INDEX,
                settings={
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                },
                mappings={
                    "properties": {
                        "conv_id": {"type": "keyword"},       # 방 삭제 시 이 필드로 delete_by_query
                        "batch_id": {"type": "keyword"},      # 같은 zip/첨부 이벤트 묶음
                        "file_id": {"type": "keyword"},       # 파일 1개당 고유 ID
                        "filename": {"type": "keyword"},      # zip 내 상대경로
                        "source_name": {"type": "keyword"},   # 원본 zip명 또는 첨부명
                        "content": {"type": "text"},          # 코드라 한국어 analyzer 불필요
                        "chunk_index": {"type": "integer"},
                        "total_chunks": {"type": "integer"},
                        "content_length": {"type": "integer"},
                        "embedding_model": {"type": "keyword"},
                        "indexed_at": {"type": "date"},
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
                    }
                },
            )
            logger.info("chat_file_chunks 인덱스 생성 완료")

        # ── rag_files ──────────────────────────────────────────────
        if not await es.indices.exists(index=FILES_INDEX):
            await es.indices.create(
                index=FILES_INDEX,
                settings={"number_of_shards": 1, "number_of_replicas": 0},
                mappings={"properties": {
                    "file_id": {"type": "keyword"},
                    "filename": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                    "file_ext": {"type": "keyword"},
                    "file_size": {"type": "long"},
                    "chunk_count": {"type": "integer"},
                    "indexed_at": {"type": "date"},
                    "original_path": {"type": "keyword"},
                    "content_hash": {"type": "keyword"},
                }},
            )
            logger.info("rag_files 인덱스 생성 완료")

        # ── document_originals ─────────────────────────────────────
        # 언어별 청크는 검색(RAG) 전용이며, 사용자가 문서를 채팅에 직접 첨부할 때는
        # 이 인덱스의 정규화된 전체 텍스트를 사용한다. 원본 바이너리 파일과도 분리한다.
        if not await es.indices.exists(index=DOCUMENT_ORIGINALS_INDEX):
            await es.indices.create(
                index=DOCUMENT_ORIGINALS_INDEX,
                settings={"number_of_shards": 1, "number_of_replicas": 0},
                mappings={"properties": {
                    "document_id": {"type": "keyword"},
                    "source_type": {"type": "keyword"},
                    "title": {"type": "text", "fields": {"keyword": {"type": "keyword", "ignore_above": 512}}},
                    "content": {"type": "text", "index": False},
                    "url": {"type": "keyword"},
                    "file_ext": {"type": "keyword"},
                    "content_length": {"type": "integer"},
                    "created_at": {"type": "date"},
                    "updated_at": {"type": "date"},
                }},
            )
            logger.info("document_originals 인덱스 생성 완료")

        # ── web_documents ─────────────────────────────────────────
        # 파일 메타데이터(rag_files)와 분리해 URL 기반 갱신과 원문 열기를 안전하게 지원한다.
        if not await es.indices.exists(index=WEB_DOCUMENTS_INDEX):
            await es.indices.create(
                index=WEB_DOCUMENTS_INDEX,
                settings={"number_of_shards": 1, "number_of_replicas": 0},
                mappings={"properties": {
                    "id": {"type": "keyword"},
                    "url": {"type": "keyword"},
                    "title": {"type": "text", "fields": {"keyword": {"type": "keyword", "ignore_above": 512}}},
                    "content": {"type": "text", "index": False},
                    "domain": {"type": "keyword"},
                    "published_at": {"type": "date"},
                    "saved_at": {"type": "date"},
                    "updated_at": {"type": "date"},
                    "chunk_count": {"type": "integer"},
                    "source_type": {"type": "keyword"},
                }},
            )
            logger.info("web_documents 인덱스 생성 완료")

        # ── knowledge_collections ──────────────────────────────────
        if not await es.indices.exists(index=KNOWLEDGE_COLLECTIONS_INDEX):
            await es.indices.create(
                index=KNOWLEDGE_COLLECTIONS_INDEX,
                settings={"number_of_shards": 1, "number_of_replicas": 0},
                mappings={"properties": {
                    "id": {"type": "keyword"},
                    "name": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                    "description": {"type": "text"},
                    "instruction": {"type": "text"},
                    "items": {"type": "nested", "properties": {
                        "source_type": {"type": "keyword"},
                        "source_id": {"type": "keyword"},
                    }},
                    "created_at": {"type": "date"},
                    "updated_at": {"type": "date"},
                    "sort_order": {"type": "integer"},
                }},
            )
            logger.info("knowledge_collections 인덱스 생성 완료")

        # ── user_profile ────────────────────────────────────────────
        if not await es.indices.exists(index=USER_PROFILE_INDEX):
            await es.indices.create(index=USER_PROFILE_INDEX, body={
                "mappings": {
                    "properties": {
                        "profile": {"type": "text"},
                        "last_processed_at": {"type": "date"},
                        "updated_at": {"type": "date"},
                    }
                }
            })
            logger.info("user_profile 인덱스 생성 완료")

        # ── vocab_words ───────────────────────────────────────────
        # 단어 1개 = 문서 1개. 같은 단어를 다시 만나면 sentences 배열에 예문 누적(upsert).
        if not await es.indices.exists(index=VOCAB_INDEX):
            await es.indices.create(
                index=VOCAB_INDEX,
                settings={"number_of_shards": 1, "number_of_replicas": 0},
                mappings={"properties": {
                    "word": {"type": "keyword"},
                    "word_lower": {"type": "keyword"},
                    "source_language": {"type": "keyword"},
                    "meanings": {"type": "keyword"},
                    "sentences": {
                        "type": "object",
                        "properties": {
                            "meaning": {"type": "text"},
                            "original_text": {"type": "text"},
                            "translated_text": {"type": "text"},
                            "source_language": {"type": "keyword"},
                            "target_language": {"type": "keyword"},
                            "source_url": {"type": "keyword"},
                            "source_title": {"type": "text"},
                            "added_at": {"type": "date"},
                        },
                    },
                    "first_added_at": {"type": "date"},
                    "last_added_at": {"type": "date"},
                }},
            )
            logger.info("vocab_words 인덱스 생성 완료")
        else:
            # 기존 설치본에도 원문 언어를 keyword로 추가한다.
            await es.indices.put_mapping(
                index=VOCAB_INDEX,
                body={"properties": {
                    "source_language": {"type": "keyword"},
                    "sentences": {"properties": {
                        "original_text": {"type": "text"},
                        "translated_text": {"type": "text"},
                        "source_language": {"type": "keyword"},
                        "target_language": {"type": "keyword"},
                    }},
                }},
            )

    finally:
        await es.close()


async def index_default_system_prompt():
    from services.prompts import create_prompt, get_prompt_by_id, update_prompt
    import logging

    logger = logging.getLogger(__name__)

    def build_prompt(language_name: str, base_rules: str) -> str:
        rules = [
            f"- Respond ONLY in the {language_name} language.",
            "- NEVER use any other language.",
            "- Do NOT provide translations.",
            "- If you use another language, it is a critical error.",
            f"- Your entire response must be written in {language_name} with no exceptions.",
            "- Do NOT repeat the same sentence twice."
        ]
        if language_name != "Korean":
            rules.insert(2, "- NEVER use Korean in your response.")
        important_block = "\n".join(rules)
        return f"""You are a friendly {language_name} conversation tutor for beginners.

IMPORTANT:
{important_block}

Rules:
{base_rules.strip()}
"""

    def get_base_rules(extra_info=""):
        info_part = f" {extra_info}" if extra_info else ""
        return f"""
1. Use short sentences and common words for beginners{info_part}.
2. Correct mistakes ONLY in parentheses like (corrected word or sentence) and nowhere else.
3. If the user's sentence is correct and natural, do NOT use parentheses.
4. Do NOT repeat the user's sentence or your own sentence.
5. Ask exactly one simple follow-up question at the end of your response.
6. Be encouraging and positive.
7. Keep the total response to a maximum of 2 sentences, including the question.
8. Do NOT use emojis or emoticons.
"""

    prompts = [
        {"id": "default-english-tutor", "title": "영어 초급 회화",
         "content": build_prompt("English", get_base_rules("(A1-A2 level)"))},
        {"id": "default-thai-tutor", "title": "태국어 초급 회화", "content": build_prompt("Thai", get_base_rules())},
        {"id": "default-japanese-tutor", "title": "일본어 초급 회화",
         "content": build_prompt("Japanese", get_base_rules("(Hiragana/Katakana preferred)"))},
        {"id": "default-chinese-tutor", "title": "중국어 초급 회화",
         "content": build_prompt("Chinese", get_base_rules("(Mandarin)"))},
        {"id": "default-vietnamese-tutor", "title": "베트남어 초급 회화",
         "content": build_prompt("Vietnamese", get_base_rules())},
        {"id": "default-spanish-tutor", "title": "스페인어 초급 회화", "content": build_prompt("Spanish", get_base_rules())},
        {"id": "default-korean-tutor", "title": "한국어 초급 회화", "content": build_prompt("Korean", get_base_rules())},
    ]

    for prompt in prompts:
        existing = get_prompt_by_id(prompt["id"])
        if not existing:
            await create_prompt(prompt["id"], prompt["title"], prompt["content"])
            logger.info(f"프롬프트 생성: {prompt['id']}")
        else:
            await update_prompt(prompt["id"], prompt["title"], prompt["content"])
            logger.info(f"프롬프트 업데이트: {prompt['id']}")

    logger.info("다국어 초급 회화 프롬프트 동기화 완료")


async def _index_default_translator_prompt():
    from services.prompts import create_prompt, get_prompt_by_id
    PROMPT_ID = "default-translator"
    if not get_prompt_by_id(PROMPT_ID):
        await create_prompt(PROMPT_ID, "번역가", """당신은 전문 번역가입니다. 사용자가 입력한 텍스트를 정확하고 자연스럽게 번역해주세요.

규칙:
1. 입력 언어를 자동으로 감지하여 적절한 언어로 번역합니다.
   - 한국어 입력 → 영어로 번역
   - 영어 입력 → 한국어로 번역
   - 일본어 입력 → 한국어로 번역
   - 기타 언어 → 한국어로 번역
2. 단순 직역이 아닌 원문의 뉘앙스, 어조, 문화적 맥락을 살려 번역합니다.
3. 전문 용어나 고유명사는 원문을 괄호에 병기합니다. 예: 인공지능(Artificial Intelligence)
4. 번역 결과만 출력하고 불필요한 설명은 생략합니다.
5. 사용자가 특정 언어를 지정하면 그 언어로 번역합니다.""")
        logger.info("기본 번역가 프롬프트 생성 완료")


async def _index_default_summarizer_prompt():
    from services.prompts import create_prompt, get_prompt_by_id
    PROMPT_ID = "default-summarizer"
    if not get_prompt_by_id(PROMPT_ID):
        await create_prompt(PROMPT_ID, "문서 요약가", """당신은 문서 요약 전문가입니다. 긴 글, 기사, 보고서를 핵심만 간결하게 요약합니다.

요약 원칙:
1. 원문의 핵심 주제와 중요 정보를 빠짐없이 포함합니다.
2. 불필요한 수식어, 반복 표현, 부연 설명은 제거합니다.
3. 원문의 논리적 흐름과 순서를 유지합니다.
4. 원문에 없는 내용을 추가하거나 의미를 변형하지 않습니다.
5. 전문 용어는 그대로 유지하되 필요 시 간단히 설명을 덧붙입니다.

출력 형식:
- 📌 핵심 요약 (3줄 이내)
- 주요 내용 (bullet point, 5개 이내)
- 💡 시사점 또는 결론 (있는 경우)

사용자가 요약 길이나 형식을 별도로 요청하면 그에 맞게 조정합니다.""")
        logger.info("기본 문서 요약가 프롬프트 생성 완료")


async def _index_default_coding_prompt():
    from services.prompts import create_prompt, get_prompt_by_id

    PROMPT_ID = "default-coding"

    if not get_prompt_by_id(PROMPT_ID):
        await create_prompt(
            PROMPT_ID,
            "코딩 전문가",
            """당신은 실무 중심의 전문 소프트웨어 개발 AI입니다.
기본 원칙:

1. 정확하고 실행 가능한 코드를 우선적으로 제공합니다.
2. 기존 프로젝트 구조, 네이밍 규칙, 코딩 스타일을 최대한 유지합니다.
3. 요청되지 않은 기능 제거 또는 과도한 리팩토링은 하지 않습니다.
4. 성능, 안정성, 유지보수성을 고려하여 구현합니다.
5. 존재하지 않는 라이브러리나 API를 임의로 만들지 않습니다.

코드 수정 규칙:

1. 파일이 수정된 경우 반드시 수정된 파일의 전체 내용을 제공합니다.
2. 일부 코드만 생략하거나 다음과 같은 표현을 사용하지 않습니다:

   * "// existing code..."
   * "// rest of file remains unchanged"
   * "... 생략 ..."
3. 반환된 코드는 바로 복사하여 사용할 수 있는 완전한 형태여야 합니다.
4. 여러 파일 수정 시 파일 경로를 명확히 구분하여 제공합니다.

응답 형식:

* 필요한 경우 변경 사항을 짧고 명확하게 설명합니다.
* 코드는 반드시 markdown 코드 블록으로 제공합니다.
* 코드 블록에는 적절한 언어 타입을 명시합니다.
* 불확실한 부분은 임의로 가정하지 말고 짧게 가정을 설명합니다.

중요:

* 실용적인 구현을 우선합니다.
* 요청 범위를 벗어난 변경은 최소화합니다.
* 가능한 한 안정적으로 동작하는 방향으로 구현합니다.""")

    logger.info("기본 코딩 프롬프트 생성 완료")
