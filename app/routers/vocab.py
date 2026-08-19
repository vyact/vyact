"""
routers/vocab.py – 다국어 단어장 API (크롬 확장 연동)
"""
from fastapi import APIRouter
from pydantic import BaseModel

from services.vocab import (
    add_vocab_word, add_vocab_words_bulk, list_vocab_words, delete_vocab_word,
    delete_vocab_sentence,
)
from logger import get_logger
from services.saved_sentences import delete_saved_sentence, list_saved_sentences, save_sentence

logger = get_logger(__name__)

router = APIRouter()


class VocabItem(BaseModel):
    word: str
    ipa: str = ""
    meaning: str = ""
    original_text: str = ""
    translated_text: str = ""
    source_language: str = ""
    target_language: str = ""
    source_url: str = ""
    source_title: str = ""


class VocabAddRequest(BaseModel):
    items: list[VocabItem] = []
    # 단건 추가 시 직접 필드 사용 가능 (items가 비어있을 때)
    word: str = ""
    ipa: str = ""
    meaning: str = ""
    original_text: str = ""
    translated_text: str = ""
    source_language: str = ""
    target_language: str = ""
    source_url: str = ""
    source_title: str = ""


class SavedSentenceRequest(BaseModel):
    original_text: str
    translated_text: str = ""
    source_language: str = ""
    target_language: str = ""
    source_url: str = ""
    source_title: str = ""


@router.post("/vocab/add")
async def vocab_add(req: VocabAddRequest):
    if req.items:
        results = await add_vocab_words_bulk([i.dict() for i in req.items])
        return {"added": len(results), "items": results}

    if not req.word.strip():
        return {"added": 0, "items": []}

    result = await add_vocab_word(
        word=req.word,
        ipa=req.ipa,
        meaning=req.meaning,
        original_text=req.original_text,
        translated_text=req.translated_text,
        source_language=req.source_language,
        target_language=req.target_language,
        source_url=req.source_url,
        source_title=req.source_title,
    )
    return {"added": 1, "items": [result]}


@router.get("/vocab/list")
async def vocab_list(query: str = "", size: int = 100, from_: int = 0):
    return await list_vocab_words(query=query, size=size, from_=from_)


@router.delete("/vocab/{doc_id}")
async def vocab_delete(doc_id: str):
    ok = await delete_vocab_word(doc_id)
    return {"deleted": ok}


@router.delete("/vocab/{doc_id}/sentence/{sentence_index}")
async def vocab_delete_sentence(doc_id: str, sentence_index: int):
    ok = await delete_vocab_sentence(doc_id, sentence_index)
    return {"deleted": ok}


@router.post("/sentences")
async def sentence_save(req: SavedSentenceRequest):
    return await save_sentence(**req.dict())


@router.get("/sentences")
async def sentence_list(query: str = "", size: int = 100, from_: int = 0):
    return await list_saved_sentences(query=query, size=size, from_=from_)


@router.delete("/sentences/{doc_id}")
async def sentence_delete(doc_id: str):
    return {"deleted": await delete_saved_sentence(doc_id)}
