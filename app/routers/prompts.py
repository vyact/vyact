"""
routers/prompts.py – System Prompt 관리
"""
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent import (
    get_prompts_list, get_prompt_by_id,
    create_prompt, update_prompt, delete_prompt, reorder_prompts,
)
from routers.deps import (
    load_config_async, save_config_async,
    load_ui_language_async, save_ui_language_async,
)

router = APIRouter()

SUPPORTED_UI_LANGUAGES = {"ko", "en", "ja", "zh", "th", "vi", "es", "fr"}


class SystemPromptRequest(BaseModel):
    title: str
    content: str


class SelectPromptRequest(BaseModel):
    prompt_id: str | None


class ReorderPromptsRequest(BaseModel):
    prompt_ids: list[str]


class UiLanguageRequest(BaseModel):
    language: str


@router.get("/system-prompts")
async def get_system_prompts():
    prompts = get_prompts_list()
    cfg = await load_config_async()
    return {"prompts": prompts, "selected_id": cfg.get("selected_prompt_id")}


@router.get("/extension/bootstrap")
async def get_extension_bootstrap():
    """크롬 확장 시작에 필요한 ES 설정을 단일 요청으로 제공한다."""
    language = await load_ui_language_async()
    return {
        "prompts": get_prompts_list(),
        # 저장된 선택값이 없으면 클라이언트가 OS 언어를 첫 기본값으로 사용한다.
        # 여기서 ko를 반환하면 태국어·베트남어·스페인어 OS에서도 감지값이 즉시
        # 한국어로 덮어써지는 문제가 생긴다.
        "language": language if language in SUPPORTED_UI_LANGUAGES else None,
    }


@router.put("/extension/language")
async def update_extension_language(req: UiLanguageRequest):
    """앱 UI 언어를 저장한다. bootstrap과 같은 라우터에 둬 개발 서버에서도 일관되게 제공한다."""
    language = req.language.lower().split("-", 1)[0]
    if language not in SUPPORTED_UI_LANGUAGES:
        raise HTTPException(400, "지원하지 않는 언어입니다.")
    saved = await save_ui_language_async(language)
    # 초기 설치 중에는 ES가 아직 없으므로 언어는 클라이언트가 임시 보관한다.
    # 이 경우 정상 응답을 반환해 설치 화면에서 500 오류가 발생하지 않게 한다.
    return {"language": language, "saved": saved}


@router.post("/system-prompts")
async def create_system_prompt(req: SystemPromptRequest):
    prompt_id = str(uuid.uuid4())[:8]
    prompt = await create_prompt(prompt_id, req.title, req.content)
    return {"ok": True, "prompt": prompt}


@router.put("/system-prompts/order")
async def reorder_system_prompts(req: ReorderPromptsRequest):
    if not await reorder_prompts(req.prompt_ids):
        raise HTTPException(400, "저장된 프롬프트 목록이 일치하지 않습니다.")
    return {"ok": True}


@router.put("/system-prompts/{prompt_id}")
async def update_system_prompt(prompt_id: str, req: SystemPromptRequest):
    prompt = await update_prompt(prompt_id, req.title, req.content)
    if not prompt:
        raise HTTPException(404, "Prompt not found")
    return {"ok": True, "prompt": prompt}


@router.delete("/system-prompts/{prompt_id}")
async def delete_system_prompt(prompt_id: str):
    await delete_prompt(prompt_id)
    cfg2 = await load_config_async()
    if cfg2.get("selected_prompt_id") == prompt_id:
        cfg2["selected_prompt_id"] = None
        await save_config_async(cfg2)
    return {"ok": True}


@router.post("/system-prompts/select")
async def select_system_prompt(req: SelectPromptRequest):
    if req.prompt_id:
        if not get_prompt_by_id(req.prompt_id):
            raise HTTPException(404, "Prompt not found")
    cfg = await load_config_async()
    cfg["selected_prompt_id"] = req.prompt_id
    await save_config_async(cfg)
    return {"ok": True}


@router.get("/system-prompts/current")
async def get_current_system_prompt():
    cfg = await load_config_async()
    prompt_id = cfg.get("selected_prompt_id")
    if not prompt_id:
        return {"content": ""}
    prompt = get_prompt_by_id(prompt_id)
    if prompt:
        return {"content": prompt["content"], "title": prompt["title"]}
    return {"content": ""}
