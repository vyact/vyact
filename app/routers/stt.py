"""
routers/stt.py – Whisper 로컬 STT 엔드포인트
faster-whisper 기반, 다국어 지원
"""
import io
import tempfile
import os

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse
from logger import get_logger
from error_responses import public_error_payload

logger = get_logger(__name__)
router = APIRouter()

# Whisper 모델 싱글톤 (최초 요청 시 로드)
_whisper_model = None
_whisper_lock = None


def _get_model(force_download: bool = False):
    global _whisper_model
    if _whisper_model is None:
        try:
            from faster_whisper import WhisperModel
            logger.info("Loading Whisper model... (first time)")
            # small model: speed/accuracy balance, ~500MB
            from huggingface_hub import try_to_load_from_cache
            _cached = try_to_load_from_cache("Systran/faster-whisper-small", "config.json")
            if _cached is not None:
                try:
                    _whisper_model = WhisperModel(
                        "small", device="cpu", compute_type="int8", local_files_only=True,
                    )
                except Exception:
                    if not force_download:
                        raise
                    logger.info("Whisper cache is incomplete — resuming download")
                    _whisper_model = None
            if _whisper_model is None:
                _whisper_model = WhisperModel(
                    "small", device="cpu", compute_type="int8", local_files_only=False,
                )
            logger.info("Whisper model loaded")
        except Exception as e:
            logger.error("Whisper model load failed: %s", e)
            raise
    return _whisper_model


# 언어 코드 매핑 (BCP-47 → Whisper 언어 코드)
LANG_MAP = {
    "ko-KR": "ko",
    "en-US": "en",
    "en-GB": "en",
    "ja-JP": "ja",
    "zh-CN": "zh",
    "th-TH": "th",
    "vi-VN": "vi",
    "es-ES": "es",
}


@router.post("/stt")
async def speech_to_text(
        audio: UploadFile = File(...),
        lang: str = Form(default="ko-KR"),
):
    """
    오디오 파일 → 텍스트 변환 (faster-whisper)
    - audio: webm/ogg/wav 등 MediaRecorder 출력 포맷
    - lang: BCP-47 언어 코드 (ko-KR, en-US 등), auto이면 자동 감지
    """
    whisper_lang = None if lang == "auto" else LANG_MAP.get(lang, "ko")

    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            return JSONResponse(public_error_payload("empty_audio"), status_code=400)

        # 임시 파일로 저장 후 Whisper에 전달
        suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            model = _get_model()
            segments, info = model.transcribe(
                tmp_path,
                language=whisper_lang,
                beam_size=5,
                vad_filter=True,          # 무음 구간 자동 필터링
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                ),
            )
            text = " ".join(seg.text.strip() for seg in segments).strip()
            logger.info("STT 완료 [%s]: %s", info.language, text[:50] if text else "(없음)")
            return {"text": text, "lang": info.language}
        finally:
            os.unlink(tmp_path)

    except Exception as e:
        logger.exception("STT 실패")
        return JSONResponse(public_error_payload("speech_recognition_failed"), status_code=500)


@router.get("/stt/status")
async def stt_status():
    """Whisper 모델 로드 상태 확인"""
    try:
        _get_model()
        return {"ready": True, "model": "small"}
    except Exception as e:
        logger.warning("STT 모델을 사용할 수 없음: %s", e)
        return {"ready": False, **public_error_payload("speech_model_unavailable")}
