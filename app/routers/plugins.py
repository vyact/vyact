"""Plugin installation and removal API."""
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from services.plugin_manager import (
    get_plugin_frontend_asset,
    install_plugin_archive,
    list_installed_plugins,
    uninstall_plugin,
)

router = APIRouter()

PLUGIN_RUNTIME_MODULES = {
    "react.js": """
const r = window.__VYACT_PLUGIN_RUNTIME__.React;
export default r;
export const {
    Suspense, createContext, createElement, forwardRef, lazy, memo,
    useCallback, useContext, useEffect, useMemo, useRef, useState
} = r;
""",
    "jsx-runtime.js": """
const r = window.__VYACT_PLUGIN_RUNTIME__.ReactJsxRuntime;
export const {Fragment, jsx, jsxs} = r;
""",
    "react-i18next.js": """
export const useTranslation = window.__VYACT_PLUGIN_RUNTIME__.useTranslation;
""",
    "sdk.js": """
const runtime = window.__VYACT_PLUGIN_RUNTIME__;
export const {
    CustomSelect, ModalOverlay, getReasoningEnabled, i18n,
    openPluginModal, openPluginPanel, toast, usePanelManager
} = runtime;
""",
}


@router.get("/plugins")
async def get_plugins():
    return {"plugins": list_installed_plugins()}


@router.get("/plugin-runtime/{module_name}")
async def get_plugin_runtime_module(module_name: str):
    source = PLUGIN_RUNTIME_MODULES.get(module_name)
    if source is None:
        raise HTTPException(404, "Plugin runtime module not found.")
    return Response(source, media_type="text/javascript")


@router.post("/plugins/install")
async def install_plugin(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(400, "ZIP 형식의 플러그인만 설치할 수 있습니다.")
    try:
        manifest = await install_plugin_archive(await file.read())
        return {"plugin": manifest}
    except (ValueError, OSError) as error:
        raise HTTPException(400, str(error)) from error


@router.get("/plugins/{plugin_id}/frontend/{asset_name:path}")
async def get_plugin_frontend(plugin_id: str, asset_name: str):
    try:
        return FileResponse(get_plugin_frontend_asset(plugin_id, asset_name))
    except (ValueError, OSError) as error:
        raise HTTPException(404, str(error)) from error


@router.delete("/plugins/{plugin_id}")
async def delete_plugin(plugin_id: str):
    try:
        manifest = await uninstall_plugin(plugin_id)
        return {"ok": True, "plugin": manifest}
    except (ValueError, OSError) as error:
        raise HTTPException(400, str(error)) from error
