"""
ollama_manager.py – Ollama 모델 메모리 수명 관리

- load_model(model)   : 런타임 설정의 keep_alive 값으로 로드 (미설정 시 -1 무기한)
- unload_model(model) : keep_alive=0  으로 언로드
- switch_model(old, new) : 기존 언로드 → 새 모델 로드
"""
import logging

import httpx

from config.models import LLM_INITIAL_NUM_CTX, OLLAMA_KEEP_ALIVE
from services.runtime_settings import get_runtime_settings

OLLAMA_URL = "http://localhost:11434"
logger = logging.getLogger(__name__)


async def get_loaded_model_names() -> set[str]:
    """Ollama 메모리에 실제로 유지 중인 모델 이름을 반환한다."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{OLLAMA_URL}/api/ps")
            response.raise_for_status()
        return {str(model.get("name", "")) for model in response.json().get("models", [])}
    except Exception as error:
        logger.warning("[Ollama] loaded model check failed: %s", error)
        return set()


def _get_keep_alive() -> int:
    """런타임 설정에서 ollama_keep_alive 값을 가져온다. 미설정 시 상수 기본값."""
    runtime = get_runtime_settings()
    val = runtime.get("ollama_keep_alive")
    return int(val) if val is not None else OLLAMA_KEEP_ALIVE


async def load_embed_model(model: str = "bge-m3") -> bool:
    """임베딩 모델 메모리 유지 (임베딩은 항상 무기한)"""
    try:
        # 대형 모델의 첫 로드는 디스크에서 RAM/VRAM으로 가중치를 옮기느라
        # 1분을 넘길 수 있다. 다운로드 완료 직후의 정상 로드를 실패로 처리하지 않는다.
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": model, "prompt": "warmup", "keep_alive": -1},
            )
            resp.raise_for_status()
            logger.info(f"[Ollama] Embedding model loaded: {model}")
            return True
    except Exception as e:
        logger.warning(f"[Ollama] 임베딩 모델 로드 실패 ({model}): {e}")
        return False


async def load_model(model: str) -> bool:
    """모델을 메모리에 로드. 런타임 설정의 keep_alive 값 적용."""
    keep_alive = _get_keep_alive()
    runtime = get_runtime_settings()
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": model, "prompt": "", "keep_alive": keep_alive,
                      "options": {"num_ctx": LLM_INITIAL_NUM_CTX, "num_predict": 0}},
            )
            resp.raise_for_status()
            logger.info(f"[Ollama] Model loaded: {model}")
            return True
    except Exception as e:
        logger.warning(f"[Ollama] 모델 로드 실패 ({model}): {e}")
        return False


async def unload_model(model: str) -> bool:
    """모델을 메모리에서 즉시 해제."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": model, "prompt": "", "keep_alive": 0},
            )
            resp.raise_for_status()
            logger.info(f"[Ollama] 모델 언로드 완료: {model}")
            return True
    except Exception as e:
        logger.warning(f"[Ollama] 모델 언로드 실패 ({model}): {e}")
        return False


async def unload_embed_model(model: str = "bge-m3") -> bool:
    """임베딩 전용 모델을 메모리에서 즉시 해제한다."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": model, "prompt": "", "keep_alive": 0},
            )
            response.raise_for_status()
            logger.info("[Ollama] Embedding model unloaded: %s", model)
            return True
    except Exception as error:
        logger.warning("[Ollama] Embedding model unload failed (%s): %s", model, error)
        return False


async def switch_model(old_model: str | None, new_model: str) -> bool:
    """기존 모델 언로드 후 새 모델 로드."""
    if old_model and old_model != new_model:
        await unload_model(old_model)
    return await load_model(new_model)


async def ensure_embed_model(model: str = "bge-m3") -> bool:
    """임베딩 모델이 없으면 pull, 있으면 스킵."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            models = [m["name"].split(":")[0] for m in resp.json().get("models", [])]
            if model in models:
                logger.info(f"[Ollama] 임베딩 모델 이미 존재: {model}")
                return True

        logger.info(f"[Ollama] 임베딩 모델 pull 시작: {model} (시간이 걸릴 수 있습니다)")
        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream(
                    "POST",
                    f"{OLLAMA_URL}/api/pull",
                    json={"name": model},
            ) as resp:
                async for line in resp.aiter_lines():
                    if line:
                        import json
                        try:
                            data = json.loads(line)
                            status = data.get("status", "")
                            if "pulling" in status or "success" in status:
                                logger.info(f"[Ollama] pull: {status}")
                        except Exception:
                            pass

        logger.info(f"[Ollama] 임베딩 모델 pull 완료: {model}")
        return True

    except Exception as e:
        logger.warning(f"[Ollama] 임베딩 모델 pull 실패 ({model}): {e}")
        return False
