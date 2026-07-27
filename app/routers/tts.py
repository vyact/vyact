"""
routers/tts.py – Kokoro TTS 합성 엔드포인트
Kokoro-82M 기반 로컬 TTS. 지원 언어만 처리하고,
미지원 언어는 프론트엔드에서 Web Speech API로 폴백.
"""
import io
import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logger import get_logger

logger = get_logger(__name__)
router = APIRouter()

# ── Kokoro 싱글톤 ──────────────────────────────────
_pipelines: dict = {}  # lang_code -> KPipeline
_lock = asyncio.Lock()

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


def _get_pipeline(lang_code: str):
    """KPipeline 싱글톤 (lang_code별 캐시)"""
    if lang_code not in _pipelines:
        try:
            from kokoro import KPipeline
            logger.info(f"Kokoro pipeline loaded: lang_code={lang_code}")
            _pipelines[lang_code] = KPipeline(lang_code=lang_code)
        except ImportError:
            raise HTTPException(
                status_code=503,
                detail="kokoro 패키지가 설치되어 있지 않습니다. pip install kokoro soundfile",
            )
        except Exception as e:
            logger.error(f"Kokoro pipeline 생성 실패: {e}")
            raise HTTPException(status_code=500, detail=str(e))
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
        return {"available": False, "detail": error.detail}
    except Exception as error:
        logger.warning("Kokoro availability check failed: %s", error)
        return {"available": False, "detail": str(error)}
