"""
routers/images.py – 이미지 업로드 / 생성
"""
import asyncio
import base64
import json
import re
import unicodedata
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from agent import save_conversation
from routers.deps import IMAGES_DIR, load_config_async, sse, write_log

router = APIRouter()


class ImageGenerateRequest(BaseModel):
    prompt: str
    conv_id: str = ""
    messages: list = []
    attachments: list = []
    override_model: str = ""  # 현재 모델이 이미지 불가일 때 임시 사용할 모델


@router.post("/images/upload")
async def upload_image(file: UploadFile = File(...)):
    try:
        if not file.content_type.startswith("image/"):
            raise HTTPException(400, "이미지 파일만 업로드 가능합니다")
        contents = await file.read()
        uid = str(uuid.uuid4())[:8]
        original_name = unicodedata.normalize("NFC", file.filename or "image.jpg")
        filename = f"{uid}_{original_name}"
        (IMAGES_DIR / filename).write_bytes(contents)
        return {"status": "ok", "filename": filename, "original_name": original_name, "path": str(IMAGES_DIR / filename)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"이미지 저장 실패: {str(e)}")


@router.get("/images/{filename}")
async def get_image(filename: str):
    filepath = IMAGES_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "이미지를 찾을 수 없습니다")
    return FileResponse(filepath)


async def _ensure_ollama_model(model: str):
    """모델 미설치 시 pull. (installed, error_msg) 반환"""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ollama", "list",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if model in stdout.decode():
            return True, None
        # 미설치 → pull
        pull = await asyncio.create_subprocess_exec(
            "ollama", "pull", model,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        await pull.wait()
        if pull.returncode != 0:
            return False, f"{model} 다운로드 실패"
        return True, None
    except Exception as e:
        return False, str(e)


@router.post("/generate-image")
async def generate_image(req: ImageGenerateRequest):
    cfg = await load_config_async()
    provider_type = cfg.get("type", "ollama")
    current_model = cfg.get("model", "")

    from config import IMAGE_MODEL_IDS

    # override_model: ollama이면서 현재 모델이 이미지 불가일 때만 적용
    use_model = current_model
    needs_override = (
            req.override_model
            and provider_type == "ollama"
            and current_model not in IMAGE_MODEL_IDS
    )
    if needs_override:
        use_model = req.override_model

    if not use_model:
        async def _no_model():
            yield sse("모델이 선택되지 않았습니다.", "error")

        return StreamingResponse(_no_model(), media_type="text/event-stream")

    async def stream():
        images_b64 = []
        for att in req.attachments:
            if att.get("type") == "image":
                path = IMAGES_DIR / att["filename"]
                if path.exists():
                    images_b64.append(base64.b64encode(path.read_bytes()).decode())

        payload: dict = {"model": use_model, "prompt": req.prompt, "stream": True}
        if images_b64:
            payload["images"] = images_b64

        yield sse("이미지 생성 시작...", "info", 0)
        generated_images = []

        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                async with client.stream("POST", "http://localhost:11434/api/generate", json=payload) as resp:
                    if not resp.is_success:
                        err_text = await resp.aread()
                        try:
                            err_msg = json.loads(err_text).get("error", err_text.decode())
                        except Exception:
                            err_msg = err_text.decode()
                        write_log("image_generate_failed", {"model": use_model, "error": err_msg})
                        yield sse(err_msg, "error")
                        return

                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                        except Exception:
                            continue

                        if not chunk.get("done"):
                            completed = chunk.get("completed", 0)
                            total = chunk.get("total", 0)
                            if total > 0:
                                yield sse("이미지 생성 중...", "info", int(completed / total * 95))
                            elif chunk.get("status"):
                                yield sse("이미지 생성 중...", "info")
                            continue

                        imgs = chunk.get("images", [])
                        if not imgs and chunk.get("image"):
                            imgs = [chunk["image"]]
                        if not imgs:
                            raw = chunk.get("response", "")
                            if raw and re.match(r'^[A-Za-z0-9+/=\r\n]+$', raw.strip()) and len(raw) > 100:
                                imgs = [raw]
                            elif raw:
                                yield sse(raw, "error");
                                return
                        generated_images = imgs

        except Exception as e:
            write_log("image_generate_failed", {"model": use_model, "prompt": req.prompt[:100], "error": str(e)})
            err_msg = str(e)
            if any(k in err_msg for k in ("libmlxc", "mlx runner", "MLX")):
                yield sse("이 모델은 Apple MLX 프레임워크가 필요합니다.\npip install mlx 후 Ollama를 재시작하세요.", "error")
            else:
                yield sse(f"오류: {err_msg}", "error")
            return

        if not generated_images:
            yield sse("이미지 생성 실패: 모델 응답에 이미지가 없습니다.", "error")
            return

        yield sse("이미지 저장 중...", "info", 97)

        saved_filenames = []
        for img_b64 in generated_images:
            if "," in img_b64:
                img_b64 = img_b64.split(",", 1)[1]
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"gen_{timestamp}_{str(uuid.uuid4())[:8]}.png"
            (IMAGES_DIR / filename).write_bytes(base64.b64decode(img_b64))
            saved_filenames.append(filename)

        conv_id = req.conv_id or str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        user_msg: dict = {"role": "user", "content": req.prompt, "timestamp": now}
        if req.attachments:
            user_msg["attachments"] = req.attachments

        await save_conversation(conv_id, req.messages + [
            user_msg,
            {
                "role": "assistant",
                "content": f"이미지를 생성했습니다. ({len(saved_filenames)}장)",
                "timestamp": now, "model": use_model,
                "attachments": [{"type": "image", "filename": f} for f in saved_filenames],
                "is_generated_image": True,
            },
        ])

        yield sse(
            json.dumps(
                {"conv_id": conv_id, "model": use_model, "filenames": saved_filenames, "count": len(saved_filenames)},
                ensure_ascii=False),
            "done", 100,
        )

    return StreamingResponse(stream(), media_type="text/event-stream")
