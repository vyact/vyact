"""Install and activate trusted Vyact plugins.

Plugins are ZIP archives containing ``vyact-plugin.json`` at their root.  A
plugin may register internal LLM tools and MCP catalog entries without running
a separate MCP server.
"""
import asyncio
import hashlib
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any
from collections.abc import Awaitable, Callable

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from config import INSTALL_DIR
from logger import get_logger
from error_responses import (
    http_exception_handler,
    public_error_payload,
    unhandled_exception_handler,
    validation_exception_handler,
)
from services.db import PLUGIN_STATE_INDEX, get_es
from services.mcp_client import mcp_manager
from services.mcp_config import MCP_CATALOG, load_mcp_config, save_mcp_config

logger = get_logger(__name__)

PLUGINS_DIR = INSTALL_DIR / "plugins"
PLUGIN_STATE_DOC_ID = "plugins"
PLUGIN_RESTORE_STATE_DOC_ID = "plugin_restore_state"
MANIFEST_NAME = "vyact-plugin.json"
REQUIREMENTS_NAME = "requirements.txt"
PLUGIN_DEPENDENCIES_DIR_NAME = ".dependencies"
MAX_PLUGIN_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_PLUGIN_FILES = 500
PLUGIN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,127}$")
INDEX_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


@dataclass
class PluginContext:
    plugin_id: str
    manifest: dict[str, Any]

    @property
    def mcp(self):
        return mcp_manager

    def register_mcp_catalog(self, type_name: str, entry: dict[str, Any]) -> None:
        if entry.get("kind") != "internal":
            raise ValueError("플러그인은 현재 internal MCP/AI tool만 등록할 수 있습니다.")
        existing = MCP_CATALOG.get(type_name)
        if existing and existing.get("plugin_id") != self.plugin_id:
            raise ValueError(f"이미 등록된 MCP/AI 도구 타입입니다: {type_name}")
        MCP_CATALOG[type_name] = {**entry, "plugin_id": self.plugin_id}

    def register_router(self, router: Any) -> None:
        """Attach a router to the plugin's isolated runtime ASGI application."""
        plugin_app = FastAPI()
        plugin_app.add_exception_handler(HTTPException, http_exception_handler)
        plugin_app.add_exception_handler(RequestValidationError, validation_exception_handler)
        plugin_app.add_exception_handler(Exception, unhandled_exception_handler)
        plugin_app.include_router(router)
        _plugin_apps[self.plugin_id] = plugin_app

    def register_url_resolver(
        self,
        resolver: Callable[[str], Awaitable[dict[str, Any] | None]],
    ) -> None:
        _plugin_url_resolvers[self.plugin_id] = resolver


@dataclass
class LoadedPlugin:
    manifest: dict[str, Any]
    module: ModuleType
    plugin_dir: Path


_loaded_plugins: dict[str, LoadedPlugin] = {}
_plugin_activation_errors: dict[str, str] = {}
_plugin_apps: dict[str, FastAPI] = {}
_plugin_url_resolvers: dict[
    str, Callable[[str], Awaitable[dict[str, Any] | None]]
] = {}
_plugin_dependency_paths: dict[str, str] = {}


async def resolve_plugin_url(url: str) -> dict[str, Any] | None:
    for resolver in tuple(_plugin_url_resolvers.values()):
        result = await resolver(url)
        if result is not None:
            return result
    return None


def has_plugin_url_resolvers() -> bool:
    """Return whether an active plugin can provide URL context."""
    return bool(_plugin_url_resolvers)


class PluginApiDispatcher:
    """Stable ASGI mount whose children may safely change at runtime."""

    async def __call__(self, scope, receive, send):
        request_path = scope.get("path", "")
        mount_root_path = scope.get("root_path", "")
        relative_path = (
            request_path[len(mount_root_path):]
            if mount_root_path and request_path.startswith(mount_root_path)
            else request_path
        )
        path_parts = relative_path.lstrip("/").split("/", 1)
        plugin_id = path_parts[0] if path_parts else ""
        plugin_app = _plugin_apps.get(plugin_id)
        if plugin_app is None:
            await JSONResponse(public_error_payload("plugin_not_active"), status_code=404)(
                scope, receive, send
            )
            return
        child_scope = dict(scope)
        child_scope["root_path"] = (
            mount_root_path + f"/{plugin_id}"
        )
        await plugin_app(child_scope, receive, send)


plugin_api_dispatcher = PluginApiDispatcher()


def _plugin_package_name(plugin_id: str) -> str:
    return "_vyact_plugin_" + re.sub(r"[^a-zA-Z0-9_]", "_", plugin_id)


def _deactivate_plugin_runtime(plugin_id: str, manifest: dict[str, Any]) -> None:
    for type_name in manifest.get("mcp_types", []):
        mcp_manager.unregister_internal_tools_by_type(type_name)
        entry = MCP_CATALOG.get(type_name)
        if entry and entry.get("plugin_id") == plugin_id:
            MCP_CATALOG.pop(type_name, None)
    _loaded_plugins.pop(plugin_id, None)
    _plugin_apps.pop(plugin_id, None)
    _plugin_url_resolvers.pop(plugin_id, None)
    dependency_path = _plugin_dependency_paths.pop(plugin_id, None)
    if dependency_path:
        while dependency_path in sys.path:
            sys.path.remove(dependency_path)
    package_name = _plugin_package_name(plugin_id)
    for module_name in list(sys.modules):
        if module_name == package_name or module_name.startswith(f"{package_name}."):
            sys.modules.pop(module_name, None)


async def _install_plugin_dependencies(plugin_dir: Path) -> None:
    requirements_file = plugin_dir / REQUIREMENTS_NAME
    if not requirements_file.is_file() or not requirements_file.read_text("utf-8").strip():
        return
    dependencies_dir = plugin_dir / PLUGIN_DEPENDENCIES_DIR_NAME
    if dependencies_dir.is_dir():
        return
    temporary_dependencies_dir = plugin_dir / f"{PLUGIN_DEPENDENCIES_DIR_NAME}.installing"
    shutil.rmtree(temporary_dependencies_dir, ignore_errors=True)
    temporary_dependencies_dir.mkdir()
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--target",
        str(temporary_dependencies_dir),
        "--requirement",
        str(requirements_file),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await process.communicate()
    if process.returncode != 0:
        shutil.rmtree(temporary_dependencies_dir, ignore_errors=True)
        error_detail = output.decode("utf-8", errors="replace").strip().splitlines()
        raise ValueError(
            "플러그인 Python 의존성 설치에 실패했습니다."
            + (f" {error_detail[-1]}" if error_detail else "")
        )
    temporary_dependencies_dir.rename(dependencies_dir)


def _activate_plugin_dependency_path(plugin_id: str, plugin_dir: Path) -> None:
    dependencies_dir = plugin_dir / PLUGIN_DEPENDENCIES_DIR_NAME
    if not dependencies_dir.is_dir():
        return
    dependency_path = str(dependencies_dir)
    if dependency_path not in sys.path:
        sys.path.insert(0, dependency_path)
    _plugin_dependency_paths[plugin_id] = dependency_path


def _validate_manifest(manifest: Any) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise ValueError("플러그인 매니페스트 형식이 올바르지 않습니다.")
    plugin_id = str(manifest.get("id", "")).strip()
    if not PLUGIN_ID_PATTERN.fullmatch(plugin_id):
        raise ValueError("플러그인 id는 영문 소문자, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.")
    for key in ("name", "version", "entry"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            raise ValueError(f"매니페스트에 {key} 값이 필요합니다.")
    if ":" not in manifest["entry"]:
        raise ValueError("entry는 'module:function' 형식이어야 합니다.")
    indices = manifest.get("data_indices", [])
    index_prefix = "vyact_plugin_" + re.sub(r"[^a-z0-9]+", "_", plugin_id).strip("_") + "_"
    if not isinstance(indices, list) or any(
        not isinstance(name, str)
        or not INDEX_NAME_PATTERN.fullmatch(name)
        or not name.startswith(index_prefix)
        for name in indices
    ):
        raise ValueError(
            f"data_indices는 플러그인 전용 접두사 '{index_prefix}'로 시작해야 합니다."
        )
    required_modules = manifest.get("required_python_modules", [])
    if not isinstance(required_modules, list) or any(
        not isinstance(module_name, str)
        or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", module_name)
        for module_name in required_modules
    ):
        raise ValueError("required_python_modules는 유효한 Python 모듈명 목록이어야 합니다.")
    settings_doc_prefix = "plugin_" + re.sub(
        r"[^a-z0-9]+", "_", plugin_id
    ).strip("_") + "_"
    settings_doc_ids = manifest.get("settings_doc_ids", [])
    if not isinstance(settings_doc_ids, list) or any(
        not isinstance(document_id, str)
        or not document_id.startswith(settings_doc_prefix)
        for document_id in settings_doc_ids
    ):
        raise ValueError(
            f"settings_doc_ids는 '{settings_doc_prefix}'로 시작해야 합니다."
        )
    settings = manifest.get("settings")
    if settings is not None:
        expected_endpoint_prefix = f"/api/plugin-api/{plugin_id}/"
        fields = settings.get("fields", []) if isinstance(settings, dict) else []
        if (
            not isinstance(settings, dict)
            or not isinstance(settings.get("endpoint"), str)
            or not settings["endpoint"].startswith(expected_endpoint_prefix)
            or not isinstance(fields, list)
            or any(
                not isinstance(field, dict)
                or field.get("type") != "secret"
                or not isinstance(field.get("id"), str)
                or not re.fullmatch(r"[a-z][a-z0-9_]{1,63}", field["id"])
                or not isinstance(field.get("label"), str)
                for field in fields
            )
        ):
            raise ValueError("플러그인 settings 선언 형식이 올바르지 않습니다.")
    return manifest


def _safe_extract(archive: zipfile.ZipFile, destination: Path) -> None:
    members = archive.infolist()
    if len(members) > MAX_PLUGIN_FILES:
        raise ValueError(f"플러그인 파일 수는 {MAX_PLUGIN_FILES}개를 넘을 수 없습니다.")
    total_size = sum(member.file_size for member in members)
    if total_size > MAX_PLUGIN_ARCHIVE_BYTES:
        raise ValueError("압축 해제된 플러그인 크기가 50MB를 초과합니다.")
    root = destination.resolve()
    for member in members:
        member_path = (destination / member.filename).resolve()
        if root != member_path and root not in member_path.parents:
            raise ValueError("플러그인 ZIP에 허용되지 않은 경로가 포함되어 있습니다.")
        mode = member.external_attr >> 16
        if mode & 0o170000 == 0o120000:
            raise ValueError("플러그인 ZIP에는 심볼릭 링크를 포함할 수 없습니다.")
    archive.extractall(destination)


def _find_plugin_root(extracted: Path) -> Path:
    direct = extracted / MANIFEST_NAME
    if direct.is_file():
        return extracted
    candidates = list(extracted.glob(f"*/{MANIFEST_NAME}"))
    if len(candidates) == 1:
        return candidates[0].parent
    raise ValueError(f"ZIP 루트에 {MANIFEST_NAME} 파일이 필요합니다.")


def _load_module(plugin_dir: Path, manifest: dict[str, Any]) -> tuple[ModuleType, str]:
    module_name, function_name = manifest["entry"].split(":", 1)
    module_path = plugin_dir.joinpath(*module_name.split(".")).with_suffix(".py")
    if not module_path.is_file():
        raise ValueError(f"플러그인 entry 파일을 찾을 수 없습니다: {module_name}")
    package_name = _plugin_package_name(manifest["id"])
    full_name = f"{package_name}.{module_name}"
    package = ModuleType(package_name)
    package.__path__ = [str(plugin_dir)]
    sys.modules[package_name] = package
    spec = importlib.util.spec_from_file_location(full_name, module_path)
    if spec is None or spec.loader is None:
        raise ValueError("플러그인 모듈을 로드할 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[full_name] = module
    spec.loader.exec_module(module)
    if not callable(getattr(module, function_name, None)):
        raise ValueError(f"플러그인 entry 함수가 없습니다: {function_name}")
    return module, function_name


def _validate_plugin_frontend(plugin_dir: Path, manifest: dict[str, Any]) -> None:
    if not manifest.get("ui_extensions"):
        return
    frontend_entry = manifest.get("frontend")
    if not isinstance(frontend_entry, str) or frontend_entry.startswith("official:"):
        raise ValueError(
            "UI 확장을 선언한 플러그인은 컴파일된 frontend ESM 번들을 포함해야 합니다."
        )
    frontend_file = (plugin_dir / frontend_entry).resolve()
    if (
        plugin_dir.resolve() not in frontend_file.parents
        or frontend_file.suffix not in {".js", ".mjs"}
        or not frontend_file.is_file()
    ):
        raise ValueError(
            f"플러그인 frontend 번들을 찾을 수 없습니다: {frontend_entry}"
        )


async def _save_plugin_state() -> None:
    es = get_es()
    try:
        plugins = [
            {
                "id": loaded.manifest["id"],
                "name": loaded.manifest["name"],
                "version": loaded.manifest["version"],
            }
            for loaded in _loaded_plugins.values()
        ]
        await es.index(
            index=PLUGIN_STATE_INDEX,
            id=PLUGIN_STATE_DOC_ID,
            document={"key": PLUGIN_STATE_DOC_ID, "value": {"plugins": plugins}},
            refresh=True,
        )
    finally:
        await es.close()


async def get_backup_plugin_inventory() -> list[dict[str, Any]]:
    """Return metadata only; executable plugin files are never backed up."""
    inventory_by_id = {}
    for loaded in _loaded_plugins.values():
        manifest = loaded.manifest
        inventory_by_id[manifest["id"]] = {
            "id": manifest["id"],
            "name": manifest["name"],
            "version": manifest["version"],
            "mcp_types": list(manifest.get("mcp_types", [])),
            "data_indices": list(manifest.get("data_indices", [])),
        }
    try:
        restore_state = await _load_restore_state()
        for pending in restore_state.get("plugins", []):
            plugin_id = pending.get("id")
            if plugin_id and plugin_id not in inventory_by_id:
                inventory_by_id[plugin_id] = {
                    "id": plugin_id,
                    "name": pending.get("name", plugin_id),
                    "version": pending.get("version", ""),
                    "mcp_types": [],
                    "data_indices": list(pending.get("data_indices", [])),
                }
    except Exception as error:
        logger.warning("[plugins] pending backup metadata unavailable: %s", error)
    return list(inventory_by_id.values())


async def _load_restore_state() -> dict[str, Any]:
    es = get_es()
    try:
        response = await es.get(
            index=PLUGIN_STATE_INDEX,
            id=PLUGIN_RESTORE_STATE_DOC_ID,
            ignore=[404],
        )
        if not response.get("found"):
            return {"plugins": []}
        value = response.get("_source", {}).get("value", {})
        return value if isinstance(value, dict) else {"plugins": []}
    finally:
        await es.close()


async def _save_restore_state(state: dict[str, Any]) -> None:
    es = get_es()
    try:
        await es.index(
            index=PLUGIN_STATE_INDEX,
            id=PLUGIN_RESTORE_STATE_DOC_ID,
            document={"key": PLUGIN_RESTORE_STATE_DOC_ID, "value": state},
            refresh=True,
        )
    finally:
        await es.close()


async def record_restored_plugin_inventory(
    plugins: list[dict[str, Any]],
    restored_indices: set[str],
) -> None:
    """Remember restored plugin data until the matching plugin is installed.

    This state is independent from the installed-plugin registry, so restoring a
    backup never pretends that executable plugin code is present.
    """
    state = await _load_restore_state()
    by_id = {
        item.get("id"): item
        for item in state.get("plugins", [])
        if isinstance(item, dict) and item.get("id")
    }
    for plugin in plugins:
        plugin_id = plugin.get("id")
        if not isinstance(plugin_id, str) or not PLUGIN_ID_PATTERN.fullmatch(plugin_id):
            continue
        index_prefix = "vyact_plugin_" + re.sub(
            r"[^a-z0-9]+", "_", plugin_id
        ).strip("_") + "_"
        declared_indices = [
            name for name in plugin.get("data_indices", [])
            if isinstance(name, str)
            and name.startswith(index_prefix)
            and name in restored_indices
        ]
        by_id[plugin_id] = {
            "id": plugin_id,
            "name": str(plugin.get("name", plugin_id)),
            "version": str(plugin.get("version", "")),
            "data_indices": declared_indices,
            "status": "pending",
        }
    await _save_restore_state({"plugins": list(by_id.values())})


async def reconcile_plugin_data(plugin_ids: set[str] | None = None) -> list[dict[str, Any]]:
    """Mark restored plugin data ready when the matching plugin is installed."""
    state = await _load_restore_state()
    remaining = []
    results = []
    for pending in state.get("plugins", []):
        plugin_id = pending.get("id")
        if plugin_ids is not None and plugin_id not in plugin_ids:
            remaining.append(pending)
            continue
        loaded = _loaded_plugins.get(plugin_id)
        if loaded is None:
            remaining.append(pending)
            results.append({"id": plugin_id, "status": "plugin_missing"})
            continue

        if not pending.get("data_indices"):
            results.append({"id": plugin_id, "status": "ready"})
            continue
        results.append({"id": plugin_id, "status": "ready"})
    await _save_restore_state({"plugins": remaining})
    return results


async def activate_plugin(plugin_dir: Path) -> dict[str, Any]:
    manifest = _validate_manifest(json.loads((plugin_dir / MANIFEST_NAME).read_text("utf-8")))
    plugin_id = manifest["id"]
    if plugin_id in _loaded_plugins:
        return _loaded_plugins[plugin_id].manifest
    _validate_plugin_frontend(plugin_dir, manifest)
    await _install_plugin_dependencies(plugin_dir)
    _activate_plugin_dependency_path(plugin_id, plugin_dir)
    missing_modules = [
        module_name
        for module_name in manifest.get("required_python_modules", [])
        if importlib.util.find_spec(module_name) is None
    ]
    if missing_modules:
        _deactivate_plugin_runtime(plugin_id, manifest)
        raise ValueError(
            "플러그인 전용 Python 의존성이 준비되지 않았습니다: "
            + ", ".join(missing_modules)
            + ". 보안을 위해 플러그인 설치 중 패키지를 자동 설치하지 않습니다."
        )
    module, function_name = _load_module(plugin_dir, manifest)
    context = PluginContext(plugin_id=plugin_id, manifest=manifest)
    result = getattr(module, function_name)(context)
    if hasattr(result, "__await__"):
        await result
    _loaded_plugins[plugin_id] = LoadedPlugin(
        manifest=manifest,
        module=module,
        plugin_dir=plugin_dir,
    )
    _plugin_activation_errors.pop(plugin_id, None)
    try:
        await reconcile_plugin_data({plugin_id})
    except Exception as error:
        _deactivate_plugin_runtime(plugin_id, manifest)
        raise ValueError(
            f"{plugin_id} 플러그인의 복원 데이터 확인에 실패했습니다: {error}"
        ) from error
    logger.info("[plugins] activated %s %s", plugin_id, manifest["version"])
    return manifest


async def load_installed_plugins() -> None:
    PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    for manifest_path in sorted(PLUGINS_DIR.glob(f"*/{MANIFEST_NAME}")):
        try:
            await activate_plugin(manifest_path.parent)
        except Exception as error:
            _plugin_activation_errors[manifest_path.parent.name] = str(error)
            _deactivate_plugin_runtime(manifest_path.parent.name, {})
            logger.warning("[plugins] failed to activate %s: %s", manifest_path.parent.name, error)
    try:
        await _save_plugin_state()
    except Exception as error:
        logger.debug("[plugins] state save skipped: %s", error)


async def shutdown_loaded_plugins() -> None:
    """Run optional plugin shutdown hooks without deleting installed state."""
    for plugin_id, loaded in list(_loaded_plugins.items()):
        shutdown = getattr(loaded.module, "shutdown", None)
        if not callable(shutdown):
            continue
        try:
            result = shutdown(PluginContext(plugin_id=plugin_id, manifest=loaded.manifest))
            if hasattr(result, "__await__"):
                await result
        except Exception as error:
            logger.warning("[plugins] shutdown failed for %s: %s", plugin_id, error)


async def install_plugin_archive(content: bytes) -> dict[str, Any]:
    if not content or len(content) > MAX_PLUGIN_ARCHIVE_BYTES:
        raise ValueError("플러그인 ZIP은 비어 있지 않아야 하며 50MB 이하여야 합니다.")
    PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="vyact-plugin-") as temp_name:
        extracted = Path(temp_name)
        try:
            archive_path = Path(temp_name) / "plugin.zip"
            archive_path.write_bytes(content)
            with zipfile.ZipFile(archive_path) as archive:
                _safe_extract(archive, extracted / "content")
        except zipfile.BadZipFile as error:
            raise ValueError("올바른 ZIP 플러그인 파일이 아닙니다.") from error
        plugin_root = _find_plugin_root(extracted / "content")
        manifest = _validate_manifest(json.loads((plugin_root / MANIFEST_NAME).read_text("utf-8")))
        target = PLUGINS_DIR / manifest["id"]
        if target.exists():
            raise ValueError("이미 설치된 플러그인입니다. 먼저 삭제해주세요.")
        shutil.copytree(plugin_root, target)
    try:
        await activate_plugin(target)
    except Exception:
        _deactivate_plugin_runtime(manifest["id"], manifest)
        shutil.rmtree(target, ignore_errors=True)
        raise
    try:
        await _save_plugin_state()
    except Exception as error:
        logger.warning("[plugins] state save failed after install: %s", error)
    return manifest


async def uninstall_plugin(plugin_id: str) -> dict[str, Any]:
    if not PLUGIN_ID_PATTERN.fullmatch(plugin_id):
        raise ValueError("올바르지 않은 플러그인 id입니다.")
    target = (PLUGINS_DIR / plugin_id).resolve()
    root = PLUGINS_DIR.resolve()
    if target.parent != root or not target.is_dir():
        raise ValueError("설치된 플러그인을 찾을 수 없습니다.")
    loaded = _loaded_plugins.get(plugin_id)
    manifest = loaded.manifest if loaded else _validate_manifest(
        json.loads((target / MANIFEST_NAME).read_text("utf-8"))
    )

    for type_name, entry in list(MCP_CATALOG.items()):
        if entry.get("plugin_id") == plugin_id:
            mcp_manager.unregister_internal_tools_by_type(type_name)
            MCP_CATALOG.pop(type_name, None)
            config = await load_mcp_config()
            config["servers"] = [
                server for server in config.get("servers", [])
                if server.get("type") != type_name
            ]
            await save_mcp_config(config)

    loaded = _loaded_plugins.get(plugin_id)
    if loaded:
        shutdown = getattr(loaded.module, "shutdown", None)
        if callable(shutdown):
            result = shutdown(PluginContext(plugin_id=plugin_id, manifest=manifest))
            if hasattr(result, "__await__"):
                await result
    _deactivate_plugin_runtime(plugin_id, manifest)
    shutil.rmtree(target)
    try:
        await _save_plugin_state()
    except Exception as error:
        logger.warning("[plugins] state save failed after uninstall: %s", error)
    logger.info("[plugins] uninstalled %s and preserved declared data", plugin_id)
    return manifest


def _build_plugin_frontend_url(
    plugin_id: str,
    plugin_dir: Path,
    frontend_entry: Any,
) -> str | None:
    if not isinstance(frontend_entry, str) or frontend_entry.startswith("official:"):
        return None
    frontend_file = (plugin_dir / frontend_entry).resolve()
    if not frontend_file.is_file():
        return None
    frontend_digest = hashlib.sha256(frontend_file.read_bytes()).hexdigest()[:12]
    return (
        f"/api/plugins/{plugin_id}/frontend/{Path(frontend_entry).name}"
        f"?v={frontend_digest}"
    )


def list_installed_plugins() -> list[dict[str, Any]]:
    installed_plugins: list[dict[str, Any]] = []
    for manifest_path in sorted(PLUGINS_DIR.glob(f"*/{MANIFEST_NAME}")):
        try:
            manifest = _validate_manifest(json.loads(manifest_path.read_text("utf-8")))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            logger.warning("[plugins] invalid installed manifest %s: %s", manifest_path, error)
            continue
        plugin_id = manifest["id"]
        frontend_entry = manifest.get("frontend")
        active = plugin_id in _loaded_plugins
        frontend_url = (
            _build_plugin_frontend_url(plugin_id, manifest_path.parent, frontend_entry)
            if active
            else None
        )
        installed_plugins.append({
            "id": plugin_id,
            "name": manifest["name"],
            "version": manifest["version"],
            "description": manifest.get("description", ""),
            "mcp_types": manifest.get("mcp_types", []),
            "data_indices": manifest.get("data_indices", []),
            "frontend": frontend_entry,
            "frontend_url": frontend_url,
            "removal_items": manifest.get("removal_items", []),
            "settings": manifest.get("settings"),
            "active": active,
            "activation_error": _plugin_activation_errors.get(plugin_id),
        })
    return installed_plugins


def get_plugin_frontend_file(plugin_id: str) -> Path:
    loaded = _loaded_plugins.get(plugin_id)
    if loaded is None:
        raise ValueError("설치된 플러그인을 찾을 수 없습니다.")
    frontend_entry = loaded.manifest.get("frontend")
    if not isinstance(frontend_entry, str) or frontend_entry.startswith("official:"):
        raise ValueError("플러그인 프런트엔드 번들이 없습니다.")
    frontend_file = (loaded.plugin_dir / frontend_entry).resolve()
    if loaded.plugin_dir.resolve() not in frontend_file.parents or not frontend_file.is_file():
        raise ValueError("플러그인 프런트엔드 파일을 찾을 수 없습니다.")
    return frontend_file


def get_plugin_frontend_asset(plugin_id: str, asset_name: str) -> Path:
    frontend_file = get_plugin_frontend_file(plugin_id)
    frontend_root = frontend_file.parent.resolve()
    asset_file = (frontend_root / asset_name).resolve()
    if frontend_root not in asset_file.parents or not asset_file.is_file():
        raise ValueError("플러그인 프런트엔드 파일을 찾을 수 없습니다.")
    return asset_file
