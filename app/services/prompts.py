"""
prompts.py – System Prompt CRUD + 메모리 캐시
"""
from services.db import PROMPTS_INDEX, get_es
from logger import get_logger
logger = get_logger(__name__)

# 앱 시작 시 ES에서 로드되는 메모리 캐시
PROMPTS_CACHE: dict = {}


async def load_prompts_cache():
    """앱 시작 시 ES에서 전체 prompts를 메모리에 로드"""
    global PROMPTS_CACHE
    es = get_es()
    try:
        result = await es.search(
            index=PROMPTS_INDEX,
            body={"query": {"match_all": {}}, "size": 1000},
        )
        PROMPTS_CACHE = {
            hit["_source"]["id"]: hit["_source"]
            for hit in result["hits"]["hits"]
        }
        logger.info("[PROMPTS] Loaded %s prompts into cache", len(PROMPTS_CACHE))

    except Exception as e:
        logger.error("[PROMPTS] Cache load error: %s", e)

        PROMPTS_CACHE = {}
    finally:
        await es.close()


def get_prompts_list() -> list[dict]:
    return list(PROMPTS_CACHE.values())


def get_prompt_by_id(prompt_id: str) -> dict | None:
    return PROMPTS_CACHE.get(prompt_id)


async def create_prompt(prompt_id: str, title: str, content: str) -> dict:
    prompt = {"id": prompt_id, "title": title, "content": content}
    es = get_es()
    try:
        await es.index(index=PROMPTS_INDEX, id=prompt_id, body=prompt, refresh=True)
        PROMPTS_CACHE[prompt_id] = prompt
        return prompt
    finally:
        await es.close()


async def update_prompt(prompt_id: str, title: str, content: str) -> dict | None:
    if prompt_id not in PROMPTS_CACHE:
        return None
    prompt = {"id": prompt_id, "title": title, "content": content}
    es = get_es()
    try:
        await es.index(index=PROMPTS_INDEX, id=prompt_id, body=prompt, refresh=True)
        PROMPTS_CACHE[prompt_id] = prompt
        return prompt
    finally:
        await es.close()


async def delete_prompt(prompt_id: str):
    es = get_es()
    try:
        await es.delete(index=PROMPTS_INDEX, id=prompt_id, ignore=[404], refresh=True)
        PROMPTS_CACHE.pop(prompt_id, None)
    finally:
        await es.close()
