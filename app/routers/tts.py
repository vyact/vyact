"""
routers/tts.py – Kokoro TTS 합성 엔드포인트
Kokoro-82M 기반 로컬 TTS. 지원 언어만 처리하고,
미지원 언어는 프론트엔드에서 Web Speech API로 폴백.
"""
import io
import asyncio
import json
import logging
import warnings

warnings.filterwarnings("ignore", message=r"invalid escape sequence.*", category=SyntaxWarning)
warnings.filterwarnings(
    "ignore",
    message=r"pkg_resources is deprecated as an API.*",
    category=UserWarning,
)
warnings.filterwarnings(
    "ignore",
    message=r"dropout option adds dropout.*num_layers greater than 1.*",
    category=UserWarning,
    module=r"torch\.nn\.modules\.rnn",
)
warnings.filterwarnings(
    "ignore",
    message=r"`torch\.nn\.utils\.weight_norm` is deprecated.*",
    category=FutureWarning,
    module=r"torch\.nn\.utils\.weight_norm",
)

import jieba

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logger import get_logger
from error_responses import public_error_payload
from config import INSTALL_DIR, VENV_DIR, get_log_file
from routers.deps import APP_DIR
from services.installer import Installer

logger = get_logger(__name__)
router = APIRouter()
KOKORO_REPOSITORY_ID = "hexgrad/Kokoro-82M"
jieba.setLogLevel(logging.WARNING)

# ── Kokoro 싱글톤 ──────────────────────────────────
_pipelines: dict = {}  # lang_code -> KPipeline
_lock = asyncio.Lock()
_unidic_install_lock = asyncio.Lock()

# lang_code 매핑 (detectLang 결과 -> Kokoro lang_code)
KOKORO_LANG_MAP: dict[str, str] = {
    "en-US": "a",  # American English
    "en-GB": "b",  # British English
    "es":    "e",  # Spanish
    "fr":    "f",  # French
    "hi":    "h",  # Hindi
    "it":    "i",  # Italian
    "ja-JP": "j",  # Japanese
    "pt-BR": "p",  # Brazilian Portuguese
    "zh-CN": "z",  # Mandarin Chinese
}

# 기본 voice (lang_code -> voice name)
KOKORO_DEFAULT_VOICES: dict[str, str] = {
    "a": "af_heart",
    "b": "bf_emma",
    "e": "ef_dora",
    "f": "ff_siwis",
    "h": "hf_alpha",
    "i": "if_sara",
    "j": "jf_alpha",
    "p": "pf_dora",
    "z": "zf_xiaobei",
}


def _unidic_installer() -> Installer:
    return Installer(INSTALL_DIR, APP_DIR, VENV_DIR, get_log_file("event"))


@router.get("/tts/japanese-dictionary/status")
async def japanese_dictionary_status():
    return {"installed": await _unidic_installer().is_unidic_dictionary_installed()}


@router.post("/tts/japanese-dictionary/install")
async def install_japanese_dictionary():
    async def stream_installation():
        async with _unidic_install_lock:
            installer = _unidic_installer()
            installed = False
            async for progress, message in installer.install_unidic_dictionary_with_progress():
                installed = progress == 100 and await installer.is_unidic_dictionary_installed()
                payload = json.dumps({"progress": progress, "message": message, "installed": installed})
                yield f"data: {payload}\n\n"
            if not installed:
                yield f"data: {json.dumps({'progress': 0, 'installed': False, 'error': True})}\n\n"

    return StreamingResponse(
        stream_installation(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _get_pipeline(lang_code: str):
    """KPipeline 싱글톤 (lang_code별 캐시)"""
    if lang_code not in _pipelines:
        try:
            from kokoro import KPipeline
        except ModuleNotFoundError as error:
            if error.name != "kokoro":
                logger.error("Kokoro dependency missing: %s", error.name)
                raise HTTPException(
                    status_code=500,
                    detail=f"Kokoro dependency missing: {error.name}",
                ) from error
            raise HTTPException(
                status_code=503,
                detail="kokoro 패키지가 설치되어 있지 않습니다. pip install kokoro soundfile",
            ) from error
        except ImportError as error:
            logger.error("Kokoro import failed: %s", error)
            raise HTTPException(status_code=500, detail=f"Kokoro import failed: {error}") from error

        try:
            logger.info(f"Kokoro pipeline loaded: lang_code={lang_code}")
            _pipelines[lang_code] = KPipeline(
                lang_code=lang_code,
                repo_id=KOKORO_REPOSITORY_ID,
            )
        except ModuleNotFoundError as error:
            logger.error("Kokoro dependency missing for %s: %s", lang_code, error.name)
            raise HTTPException(
                status_code=500,
                detail=f"Kokoro dependency missing for {lang_code}: {error.name}",
            ) from error
        except Exception as error:
            logger.error("Kokoro pipeline creation failed for %s: %s", lang_code, error)
            raise HTTPException(status_code=500, detail=str(error)) from error
    return _pipelines[lang_code]


# ── 요청 모델 ──────────────────────────────────────
class TtsSynthRequest(BaseModel):
    text: str
    lang: str = "en-US"         # 프론트엔드 detectLang 결과
    voice: str = ""             # 빈 문자열이면 기본 voice 사용
    speed: float = 1.0


# ── 지원 언어 조회 ─────────────────────────────────
@router.get("/tts/kokoro/languages")
async def kokoro_languages():
    """Kokoro가 지원하는 언어 목록 반환"""
    return {
        "languages": list(KOKORO_LANG_MAP.keys()),
        "voices": KOKORO_DEFAULT_VOICES,
    }


# ── 합성 엔드포인트 ────────────────────────────────
@router.post("/tts/kokoro/synthesize")
async def kokoro_synthesize(req: TtsSynthRequest):
    """텍스트 → WAV 오디오 반환"""
    import soundfile as sf

    # lang 매핑
    lang_code = KOKORO_LANG_MAP.get(req.lang)
    if not lang_code:
        # prefix 매칭 시도 (en-AU -> a)
        prefix = req.lang.split("-")[0]
        for k, v in KOKORO_LANG_MAP.items():
            if k.startswith(prefix):
                lang_code = v
                break
    if not lang_code:
        raise HTTPException(
            status_code=400,
            detail=f"Kokoro 미지원 언어: {req.lang}",
        )

    voice = req.voice or KOKORO_DEFAULT_VOICES.get(lang_code, "af_heart")

    async with _lock:
        pipeline = _get_pipeline(lang_code)

    # Kokoro 합성 (CPU-bound → run_in_executor)
    loop = asyncio.get_running_loop()

    def _synthesize():
        import numpy as np
        chunks = []
        for _gs, _ps, audio in pipeline(req.text, voice=voice, speed=req.speed):
            chunks.append(audio)
        if not chunks:
            return None
        return np.concatenate(chunks)

    audio = await loop.run_in_executor(None, _synthesize)

    if audio is None:
        raise HTTPException(status_code=400, detail="합성 결과 없음")

    # WAV로 인코딩
    buf = io.BytesIO()
    sf.write(buf, audio, 24000, format="WAV")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="audio/wav",
        headers={"Content-Disposition": "inline; filename=tts.wav"},
    )


# ── 상태 확인 ──────────────────────────────────────
@router.get("/tts/kokoro/status")
async def kokoro_status():
    """Kokoro 사용 가능 여부 확인"""
    try:
        loop = asyncio.get_running_loop()
        async with _lock:
            await loop.run_in_executor(None, _get_pipeline, "a")
        return {"available": True}
    except HTTPException as error:
        return {"available": False, **public_error_payload("speech_model_unavailable")}
    except Exception as error:
        logger.warning("Kokoro availability check failed: %s", error)
        return {"available": False, **public_error_payload("speech_model_unavailable")}
