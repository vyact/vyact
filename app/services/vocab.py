"""
services/vocab.py – 다국어 단어장 관리 (크롬 확장 번역 기능에서 추출된 단어 누적)

단어 1개 = 문서 1개(ES _id = md5(word_lower)).
같은 단어를 다시 만나면 sentences 배열에 예문을 추가(같은 문장은 중복 추가 안 함),
meanings 배열에 새 뜻을 추가(같은 뜻은 중복 추가 안 함).

저장 구조:
{
  "word": "rallied",
  "word_lower": "rallied",
  "meanings": ["상승했다", "회복했다"],
  "sentences": [
    {
      "meaning": "상승했다",
      "original_text": "The sector has rallied roughly 28%...",
      "translated_text": "The sector has rallied roughly 28%.",
      "source_language": "en",
      "target_language": "ko",
      "source_url": "https://...",
      "source_title": "기사 제목",
      "added_at": "2026-06-30T..."
    }
  ],
  "first_added_at": "2026-06-30T...",
  "last_added_at": "2026-07-02T..."
}
"""
import hashlib
from datetime import datetime, timezone

from services.db import get_es, VOCAB_INDEX
from logger import get_logger

logger = get_logger(__name__)


def _word_doc_id(word_lower: str) -> str:
    return hashlib.md5(word_lower.encode("utf-8")).hexdigest()


# 같은 단어를 다시 만났을 때 sentences/meanings를 누적 upsert하는 painless 스크립트
_UPSERT_SCRIPT = """
if (ctx._source.sentences == null) { ctx._source.sentences = []; }
if (ctx._source.meanings == null) { ctx._source.meanings = []; }

boolean sentenceExists = false;
for (s in ctx._source.sentences) {
if (s.original_text == params.sentence.original_text && s.source_language == params.sentence.source_language && params.sentence.original_text != '') {
    sentenceExists = true;
    break;
  }
}
if (!sentenceExists) {
  ctx._source.sentences.add(params.sentence);
}

if (params.meaning != '' && !ctx._source.meanings.contains(params.meaning)) {
  ctx._source.meanings.add(params.meaning);
}

ctx._source.word = params.word;
if (params.source_language != null && params.source_language != '') { ctx._source.source_language = params.source_language; }
ctx._source.last_added_at = params.now;
if (params.ipa != null && params.ipa != '') { ctx._source.ipa = params.ipa; }
"""


async def add_vocab_word(
        word: str,
        ipa: str = "",
        meaning: str = "",
        original_text: str = "",
        translated_text: str = "",
        source_language: str = "",
        target_language: str = "",
        source_url: str = "",
        source_title: str = "",
) -> dict:
    """단어 1개를 단어장에 추가/병합(upsert). 같은 단어면 예문/뜻을 누적."""
    word = (word or "").strip()
    if not word:
        raise ValueError("word는 필수입니다")

    word_lower = word.lower()
    doc_id = _word_doc_id(word_lower)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    meaning = (meaning or "").strip()
    ipa = (ipa or "").strip()

    sentence_entry = {
        "meaning": meaning,
        "original_text": (original_text or "").strip(),
        "translated_text": (translated_text or "").strip(),
        "source_language": (source_language or "").strip(),
        "target_language": (target_language or "").strip(),
        "source_url": (source_url or "").strip(),
        "source_title": (source_title or "").strip(),
        "added_at": now,
    }

    upsert_doc = {
        "word": word,
        "word_lower": word_lower,
        "source_language": (source_language or "").strip(),
        "ipa": ipa,
        "meanings": [meaning] if meaning else [],
        "sentences": [sentence_entry],
        "first_added_at": now,
        "last_added_at": now,
    }

    es = get_es()
    try:
        await es.update(
            index=VOCAB_INDEX,
            id=doc_id,
            script={
                "source": _UPSERT_SCRIPT,
                "lang": "painless",
                "params": {"sentence": sentence_entry, "meaning": meaning, "word": word, "ipa": ipa, "source_language": (source_language or "").strip(), "now": now},
            },
            upsert=upsert_doc,
            refresh=True,
        )
        logger.info("단어장 추가/병합: %s", word)
        res = await es.get(index=VOCAB_INDEX, id=doc_id)
        return {"id": doc_id, **res["_source"]}
    finally:
        await es.close()


async def add_vocab_words_bulk(items: list[dict]) -> list[dict]:
    """여러 단어를 한 번에 추가(순차 upsert)"""
    results = []
    for item in items:
        try:
            res = await add_vocab_word(
                word=item.get("word", ""),
                ipa=item.get("ipa", ""),
                meaning=item.get("meaning", ""),
                original_text=item.get("original_text", ""),
                translated_text=item.get("translated_text", ""),
                source_language=item.get("source_language", ""),
                target_language=item.get("target_language", ""),
                source_url=item.get("source_url", ""),
                source_title=item.get("source_title", ""),
            )
            results.append(res)
        except Exception as e:
            logger.warning("단어장 추가 실패 (word=%s): %s", item.get("word"), e)
    return results


async def list_vocab_words(query: str = "", size: int = 100, from_: int = 0) -> dict:
    """단어장 목록 조회 (최근 추가/갱신 순). query가 있으면 단어/뜻으로 필터링"""
    es = get_es()
    try:
        if query:
            q = {
                "bool": {
                    "should": [
                        {"wildcard": {"word_lower": f"*{query.lower()}*"}},
                        {"match": {"meanings": query}},
                    ]
                }
            }
        else:
            q = {"match_all": {}}

        res = await es.search(
            index=VOCAB_INDEX,
            query=q,
            sort=[{"last_added_at": {"order": "desc"}}],
            size=min(max(size, 1), 500),
            from_=max(from_, 0),
        )
        hits = res["hits"]["hits"]
        total = res["hits"]["total"]["value"]
        items = [{"id": h["_id"], **h["_source"]} for h in hits]
        return {"items": items, "total": total}
    except Exception as e:
        logger.warning("단어장 조회 실패: %s", e)
        return {"items": [], "total": 0}
    finally:
        await es.close()


async def delete_vocab_word(doc_id: str) -> bool:
    """단어장에서 단어 전체(예문 포함) 삭제"""
    es = get_es()
    try:
        await es.delete(index=VOCAB_INDEX, id=doc_id, refresh=True, ignore=[404])
        return True
    except Exception as e:
        logger.warning("단어장 삭제 실패 (id=%s): %s", doc_id, e)
        return False
    finally:
        await es.close()


async def delete_vocab_sentence(doc_id: str, sentence_index: int) -> bool:
    """단어 안의 예문 1개만 삭제 (남은 예문이 0개가 되면 단어 자체도 삭제)"""
    es = get_es()
    try:
        res = await es.get(index=VOCAB_INDEX, id=doc_id, ignore=[404])
        if not res.get("found"):
            return False
        sentences = res["_source"].get("sentences", [])
        if not (0 <= sentence_index < len(sentences)):
            return False
        sentences.pop(sentence_index)
        if not sentences:
            await es.delete(index=VOCAB_INDEX, id=doc_id, refresh=True)
        else:
            await es.update(
                index=VOCAB_INDEX, id=doc_id,
                doc={"sentences": sentences},
                refresh=True,
            )
        return True
    except Exception as e:
        logger.warning("단어장 예문 삭제 실패 (id=%s): %s", doc_id, e)
        return False
    finally:
        await es.close()
