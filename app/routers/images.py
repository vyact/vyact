"""
routers/images.py – 이미지 업로드 / 생성
"""
import unicodedata
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from routers.deps import IMAGES_DIR, sse

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


@router.post("/generate-image")
async def generate_image(_req: ImageGenerateRequest):
    async def stream():
        yield sse("image_generation_disabled", "error", 0)

    return StreamingResponse(stream(), media_type="text/event-stream")
