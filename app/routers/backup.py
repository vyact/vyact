"""
routers/backup.py – ES 전체 인덱스 백업 / 복원
- include_files=True 시 원본 문서 파일도 zip에 포함
- 복원 시 zip이면 ES 복원 + 원본 파일 복구
"""
import asyncio
import copy
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.microsoft_workspace.backup import upload_backup
from config import INSTALL_DIR
from services.db import (
    EXTERNAL_DATA_SETTINGS_INDEX,
    EXTERNAL_DATA_STATE_INDEX,
    GOOGLE_WORKSPACE_SETTINGS_INDEX,
    INDEX_FAMILIES,
    INTEGRATION_CREDENTIALS_INDEX,
    INTEGRATION_SETTINGS_INDEX,
    LANGUAGES,
    MODEL_RUNTIME_PROFILES_INDEX,
    MODEL_BENCHMARK_RESULTS_INDEX,
    PLUGIN_STATE_INDEX,
    RUNTIME_STATE_INDEX,
    SETTINGS_INDEX,
    get_es,
    get_language_index,
)
from services.google_workspace.auth import revoke_all_tokens
from services.prompts import load_prompts_cache
from logger import get_logger

logger = get_logger(__name__)
router = APIRouter()

DOCS_DIR = INSTALL_DIR / "documents"
MEMO_ATTACHMENTS_DIR = INSTALL_DIR / "uploads" / "memo_attachments"
KNOWLEDGE_MAIL_IMAGES_DIR = INSTALL_DIR / "uploads" / "knowledge_mail_images"
_EXCLUDE_PREFIXES = (".kibana", ".security", ".monitoring", ".watches", ".triggered_watches", ".geoip")
_SETTINGS_EXCLUDE = {
    "index.creation_date", "index.uuid", "index.version",
    "index.provided_name", "index.routing",
}
_MCP_SETTINGS_DOC_ID = "mcp"
_CONFIG_DOC_ID = "config"
_MACHINE_LOCAL_CONFIG_FIELDS = ("type", "model", "vyact_config")
_BACKUP_EXCLUDED_INDICES = {
    INTEGRATION_CREDENTIALS_INDEX,
    EXTERNAL_DATA_STATE_INDEX,
    PLUGIN_STATE_INDEX,
    RUNTIME_STATE_INDEX,
    MODEL_RUNTIME_PROFILES_INDEX,
    MODEL_BENCHMARK_RESULTS_INDEX,
}
_UPSERT_INDICES = {
    SETTINGS_INDEX,
    INTEGRATION_SETTINGS_INDEX,
    GOOGLE_WORKSPACE_SETTINGS_INDEX,
    EXTERNAL_DATA_SETTINGS_INDEX,
}

EMAIL_THREAD_INDICES = {get_language_index("knowledge_email_threads", language) for language in LANGUAGES}
LANGUAGE_SUFFIXES = tuple(f"_{language}" for language in LANGUAGES)


def _logical_index_name(index_name: str) -> str:
    if index_name.endswith("_all") and index_name[:-4] in INDEX_FAMILIES:
        return index_name[:-4]
    for family in INDEX_FAMILIES:
        if index_name.startswith(f"{family}_") and index_name.endswith(LANGUAGE_SUFFIXES):
            return family
    return index_name


def _expand_selected_indices(selected: list[str], available: list[str]) -> list[str]:
    selected_names = {_logical_index_name(name) for name in selected}
    return [name for name in available if name in selected_names or _logical_index_name(name) in selected_names]


def _preserve_machine_local_config(backup: dict, current_config: dict) -> None:
    """Keep this device's provider and managed-model selection during restore."""
    settings = backup.get("indices", {}).get(SETTINGS_INDEX)
    if not isinstance(settings, dict):
        return
    for doc in settings.get("docs", []):
        if doc.get("_id") != _CONFIG_DOC_ID:
            continue
        source = doc.get("_source")
        restored_config = source.get("value") if isinstance(source, dict) else None
        if not isinstance(restored_config, dict):
            continue
        for field in _MACHINE_LOCAL_CONFIG_FIELDS:
            if field in current_config:
                restored_config[field] = copy.deepcopy(current_config[field])
            else:
                restored_config.pop(field, None)
        return


async def _preserve_google_workspace_on_restore(backup: dict) -> bool:
    """복원본에서 OAuth 토큰을 제거하고 기존 Google Workspace 설정을 보존한다.

    반환값은 복원 후 Google 계정들의 OAuth 재연결이 필요한지 여부다.
    """
    settings = backup.get("indices", {}).get(INTEGRATION_SETTINGS_INDEX)
    if not settings:
        return False
    docs = settings.get("docs", [])

    from services.mcp_config import list_servers
    current_google_servers = [
        server for server in await list_servers()
        if server.get("type") == "google_workspace"
    ]
    backup_has_google_server = False
    for doc in docs:
        source = doc.get("_source", {})
        if doc.get("_id") == _MCP_SETTINGS_DOC_ID:
            config = source.get("value")
            servers = config.get("servers") if isinstance(config, dict) else None
            if isinstance(servers, list):
                backup_google_servers = [
                    server for server in servers
                    if server.get("type") == "google_workspace"
                ]
                backup_has_google_server = bool(backup_google_servers)
                if current_google_servers:
                    # 현재 앱의 Google 설정이 우선이다. 나머지 MCP 설정은 백업본을 쓴다.
                    config["servers"] = [
                        server for server in servers
                        if server.get("type") != "google_workspace"
                    ] + current_google_servers
    return backup_has_google_server or bool(current_google_servers)


async def _get_user_indices(es) -> list[str]:
    try:
        indices = await es.indices.get(index="*")
        return sorted([
            name for name in indices.keys()
            if not name.startswith(".") and name not in _BACKUP_EXCLUDED_INDICES
        ])
    except Exception:
        return []


async def _scroll_all(es, index: str) -> list[dict]:
    docs = []
    try:
        resp = await es.search(
            index=index, **{
                "query": {"match_all": {}},
                "size": 1000,
                "_source": True,
            },
            scroll="2m",
        )
        scroll_id = resp.get("_scroll_id")
        hits = resp["hits"]["hits"]
        while hits:
            for h in hits:
                docs.append({"_id": h["_id"], "_source": h["_source"]})
            if not scroll_id:
                break
            resp = await es.scroll(scroll_id=scroll_id, scroll="2m")
            scroll_id = resp.get("_scroll_id")
            hits = resp["hits"]["hits"]
        if scroll_id:
            try:
                await es.clear_scroll(scroll_id=scroll_id)
            except Exception:
                pass
    except Exception as e:
        logger.warning("[backup] %s 스크롤 실패: %s", index, e)
    return docs


async def _get_schema(es, index: str) -> dict:
    try:
        mapping_resp = await es.indices.get_mapping(index=index)
        settings_resp = await es.indices.get_settings(index=index)
        raw_settings = settings_resp.get(index, {}).get("settings", {})

        def _clean(d: dict, prefix: str = "") -> dict:
            result = {}
            for k, v in d.items():
                full_key = f"{prefix}.{k}" if prefix else k
                if full_key in _SETTINGS_EXCLUDE:
                    continue
                if isinstance(v, dict):
                    cleaned = _clean(v, full_key)
                    if cleaned:
                        result[k] = cleaned
                else:
                    result[k] = v
            return result

        clean_settings = _clean(raw_settings.get("index", {}), "index")
        return {
            "mappings": mapping_resp.get(index, {}).get("mappings", {}),
            "settings": {"index": clean_settings} if clean_settings else {},
        }
    except Exception as e:
        logger.warning("[backup] %s 스키마 조회 실패: %s", index, e)
        return {}


def _build_create_body(schema: dict) -> dict:
    body = {}
    if schema.get("mappings"):
        body["mappings"] = schema["mappings"]
    raw = schema.get("settings", {}).get("index", {})
    keep = {k: raw[k] for k in ("number_of_shards", "number_of_replicas", "analysis") if k in raw}
    # exclude_source_vectors 설정 보존 — 복원 시 벡터가 _source에 포함되도록
    if "mapping" in raw and "exclude_source_vectors" in raw.get("mapping", {}):
        keep.setdefault("mapping", {})["exclude_source_vectors"] = raw["mapping"]["exclude_source_vectors"]
    else:
        # 기본적으로 false 강제 — 복원 후 벡터 export 가능하도록
        keep["mapping"] = {"exclude_source_vectors": False}
    if keep:
        body["settings"] = {"index": keep}
    return body


# ── 엔드포인트 ─────────────────────────────────────

@router.get("/backup/stats")
async def backup_stats():
    es = get_es()
    try:
        # 일반 인덱스는 한 번의 stats 요청으로 집계한다. 언어별 인덱스 그룹은
        # 물리 인덱스 값을 UI에서 직접 합산하지 않고 대표 read alias를 조회한다.
        response = await es.indices.stats(index="*", metric="docs")
        stats = {}
        for index_name, index_stats in sorted(response.get("indices", {}).items()):
            if index_name.startswith("."):
                continue
            if index_name in _BACKUP_EXCLUDED_INDICES:
                continue
            logical_name = _logical_index_name(index_name)
            if logical_name in INDEX_FAMILIES:
                continue
            stats[index_name] = index_stats.get("total", {}).get("docs", {}).get("count", 0)

        alias_counts = await asyncio.gather(*(
            es.count(index=f"{family}_all") for family in INDEX_FAMILIES
        ))
        for family, count_response in zip(INDEX_FAMILIES, alias_counts):
            stats[family] = count_response.get("count", 0)
        return {"stats": stats}
    finally:
        await es.close()


class ExportRequest(BaseModel):
    indices: Optional[list[str]] = None
    include_files: bool = True  # 원본 문서 파일 포함 여부
    account_id: Optional[str] = None
    provider: Literal["google", "microsoft"] = "google"


async def _read_backup(file: UploadFile) -> tuple[dict, dict[str, bytes], dict[str, bytes], dict[str, bytes]]:
    """업로드한 JSON/ZIP 백업을 읽어 백업 데이터와 원본 파일을 반환한다."""
    filename = file.filename or ""
    if not (filename.endswith(".json") or filename.endswith(".zip")):
        raise HTTPException(400, "JSON 또는 ZIP 파일만 업로드 가능합니다.")

    raw = await file.read()
    doc_files: dict[str, bytes] = {}
    memo_files: dict[str, bytes] = {}
    knowledge_mail_image_files: dict[str, bytes] = {}
    if filename.endswith(".zip"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                if "backup.json" not in zf.namelist():
                    raise HTTPException(400, "올바른 Vyact 백업 ZIP이 아닙니다.")
                backup = json.loads(zf.read("backup.json"))
                for name in zf.namelist():
                    if name.startswith("documents/") and name != "documents/":
                        doc_files[Path(name).name] = zf.read(name)
                    if name.startswith("memo_attachments/") and not name.endswith("/"):
                        relative_name = name.removeprefix("memo_attachments/")
                        relative_path = Path(relative_name)
                        if not relative_path.is_absolute() and ".." not in relative_path.parts:
                            memo_files[relative_name] = zf.read(name)
                    if name.startswith("knowledge_mail_images/") and not name.endswith("/"):
                        relative_name = name.removeprefix("knowledge_mail_images/")
                        relative_path = Path(relative_name)
                        if not relative_path.is_absolute() and ".." not in relative_path.parts:
                            knowledge_mail_image_files[relative_name] = zf.read(name)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(400, "ZIP 파싱 실패")
    else:
        try:
            backup = json.loads(raw)
        except Exception:
            raise HTTPException(400, "JSON 파싱 실패")

    if backup.get("vyact_backup") is not True or backup.get("version") != "3.0" or not isinstance(backup.get("indices"), dict):
        raise HTTPException(400, "올바른 Vyact 백업 파일이 아닙니다.")
    for excluded_index in _BACKUP_EXCLUDED_INDICES:
        backup["indices"].pop(excluded_index, None)
    return backup, doc_files, memo_files, knowledge_mail_image_files


@router.post("/backup/preview")
async def preview_backup(file: UploadFile = File(...)):
    """복원 전에 백업에 포함된 인덱스와 원본 파일을 확인한다."""
    backup, doc_files, memo_files, knowledge_mail_image_files = await _read_backup(file)
    grouped_counts = {}
    for name, payload in backup["indices"].items():
        docs = payload.get("docs", [])
        logical_name = _logical_index_name(name)
        grouped_counts[logical_name] = grouped_counts.get(logical_name, 0) + len(docs)
    indices = [{"name": name, "count": count} for name, count in sorted(grouped_counts.items())]
    from services.plugin_manager import list_installed_plugins
    installed_ids = {plugin["id"] for plugin in list_installed_plugins()}
    plugins = [
        {
            **plugin,
            "installed": plugin.get("id") in installed_ids,
        }
        for plugin in backup.get("plugins", [])
        if isinstance(plugin, dict) and plugin.get("id")
    ]
    return {
        "indices": indices,
        "file_count": len(doc_files) + len(memo_files) + len(knowledge_mail_image_files),
        "plugins": plugins,
    }


@router.post("/backup/export")
async def export_backup(req: ExportRequest = None):
    """선택한 인덱스 → JSON 또는 ZIP 다운로드"""
    es = get_es()
    try:
        all_indices = await _get_user_indices(es)
        if req and req.indices:
            index_names = _expand_selected_indices(req.indices, all_indices)
        else:
            index_names = all_indices

        include_files = req.include_files if req else True

        backup = {
            "vyact_backup": True,
            "version": "3.0",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "include_files": include_files,
            "indices": {},
        }
        from services.plugin_manager import get_backup_plugin_inventory
        backup["plugins"] = await get_backup_plugin_inventory()

        for idx in index_names:
            schema = await _get_schema(es, idx)
            docs = await _scroll_all(es, idx)
            backup["indices"][idx] = {"schema": schema, "docs": docs}
            logger.info("[backup] %s: %s건", idx, len(docs))

        json_bytes = json.dumps(backup, ensure_ascii=False, indent=2).encode("utf-8")
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")

        include_knowledge_mail_images = bool(EMAIL_THREAD_INDICES.intersection(index_names))
        if include_files and (
            DOCS_DIR.exists()
            or MEMO_ATTACHMENTS_DIR.exists()
            or (include_knowledge_mail_images and KNOWLEDGE_MAIL_IMAGES_DIR.exists())
        ):
            # ZIP으로 패키징
            zip_buf = io.BytesIO()
            with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("backup.json", json_bytes)
                if DOCS_DIR.exists():
                    for f in DOCS_DIR.iterdir():
                        if f.is_file():
                            zf.write(f, f"documents/{f.name}")
                            logger.info("[backup] 파일 포함: %s", f.name)
                if MEMO_ATTACHMENTS_DIR.exists():
                    for f in MEMO_ATTACHMENTS_DIR.rglob("*"):
                        if f.is_file():
                            zf.write(f, f"memo_attachments/{f.relative_to(MEMO_ATTACHMENTS_DIR)}")
                            logger.info("[backup] 메모 첨부 포함: %s", f.name)
                if include_knowledge_mail_images and KNOWLEDGE_MAIL_IMAGES_DIR.exists():
                    for f in KNOWLEDGE_MAIL_IMAGES_DIR.rglob("*"):
                        if f.is_file():
                            zf.write(f, f"knowledge_mail_images/{f.relative_to(KNOWLEDGE_MAIL_IMAGES_DIR)}")
                            logger.info("[backup] 지식 메일 이미지 포함: %s", f.name)
            zip_buf.seek(0)
            filename = f"vyact_backup_{ts}.zip"
            return StreamingResponse(
                iter([zip_buf.read()]),
                media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        else:
            filename = f"vyact_backup_{ts}.json"
            return StreamingResponse(
                iter([json_bytes]),
                media_type="application/json",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
    finally:
        await es.close()


@router.post("/backup/import")
async def import_backup(
    file: UploadFile = File(...),
    indices: Optional[str] = Form(None),
    restore_files: bool = Form(True),
):
    """JSON 또는 ZIP 백업 → ES 복원 + 원본 파일 복구"""
    backup, doc_files, memo_files, knowledge_mail_image_files = await _read_backup(file)
    backup_plugins = [
        plugin for plugin in backup.get("plugins", [])
        if isinstance(plugin, dict)
    ]
    if indices is not None:
        try:
            selected_indices = {
                _logical_index_name(name) for name in json.loads(indices)
            }
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(400, "복원할 인덱스 선택 정보가 올바르지 않습니다.")
        backup["indices"] = {
            name: payload for name, payload in backup["indices"].items()
            if name in selected_indices or _logical_index_name(name) in selected_indices
        }

    google_reconnect_required = await _preserve_google_workspace_on_restore(backup)
    if google_reconnect_required:
        # OAuth 토큰은 백업으로 이동하지 않으며, 복원 뒤에는 모든 계정을
        # 설정 화면에서 명시적으로 다시 연결해야 한다.
        await revoke_all_tokens()
        logger.info("[restore] Google Workspace 전체 계정 OAuth 재연결 필요")

    if SETTINGS_INDEX in backup["indices"]:
        from routers.deps import load_config_async
        _preserve_machine_local_config(backup, await load_config_async())

    # 원본 파일 복원
    files_restored = 0
    files_skipped = 0
    if restore_files and doc_files:
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
        for fname, fbytes in doc_files.items():
            dest = DOCS_DIR / fname
            if dest.exists():
                files_skipped += 1
                logger.info("[restore] 기존 파일 유지(복원 건너뜀): %s", fname)
                continue
            dest.write_bytes(fbytes)
            files_restored += 1
            logger.info("[restore] 파일 복원: %s", fname)
    if restore_files and memo_files:
        for relative_name, fbytes in memo_files.items():
            dest = MEMO_ATTACHMENTS_DIR / relative_name
            if dest.exists():
                files_skipped += 1
                logger.info("[restore] 기존 메모 첨부 유지(복원 건너뜀): %s", relative_name)
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(fbytes)
            files_restored += 1
            logger.info("[restore] 메모 첨부 복원: %s", relative_name)
    if restore_files and EMAIL_THREAD_INDICES.intersection(backup["indices"]) and knowledge_mail_image_files:
        for relative_name, fbytes in knowledge_mail_image_files.items():
            dest = KNOWLEDGE_MAIL_IMAGES_DIR / relative_name
            if dest.exists():
                files_skipped += 1
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(fbytes)
            files_restored += 1

    # ES 복원
    es = get_es()
    result = {}
    try:
        for index, payload in backup["indices"].items():
            schema = payload.get("schema", {})
            docs = payload.get("docs", [])

            schema_created = False
            try:
                if not await es.indices.exists(index=index):
                    if schema:
                        await es.indices.create(index=index, **_build_create_body(schema))
                    else:
                        await es.indices.create(index=index, **{
                            "settings": {"number_of_shards": 1, "number_of_replicas": 0}
                        })
                    schema_created = True
            except Exception as e:
                logger.warning("[restore] %s 인덱스 생성 실패: %s", index, e)

            if not docs:
                result[index] = {"inserted": 0, "skipped": 0, "schema_created": schema_created}
                continue

            actions = []
            for doc in docs:
                doc_id = doc.get("_id")
                source = doc.get("_source", {})
                if not doc_id or not source:
                    continue
                # 설정 및 상태 인덱스는 복원본으로 기존 문서를 갱신한다.
                if index in _UPSERT_INDICES:
                    actions.append({"index": {"_index": index, "_id": doc_id}})
                else:
                    actions.append({"create": {"_index": index, "_id": doc_id}})
                actions.append(source)

            if not actions:
                result[index] = {"inserted": 0, "skipped": 0, "schema_created": schema_created}
                continue

            inserted = skipped = 0
            try:
                resp = await es.bulk(operations=actions, refresh=True)
                for item in resp.get("items", []):
                    operation = item.get("index") or item.get("create") or {}
                    if operation.get("status") in {200, 201}:
                        inserted += 1
                    else:
                        skipped += 1
            except Exception as e:
                logger.warning("[restore] %s bulk 실패: %s", index, e)
                result[index] = {"inserted": 0, "skipped": len(docs), "schema_created": schema_created, "error": "backup_index_restore_failed"}
                continue

            result[index] = {"inserted": inserted, "skipped": skipped, "schema_created": schema_created}
            logger.info("[restore] %s: inserted=%s, skipped=%s", index, inserted, skipped)

    finally:
        await es.close()

    if "system_prompts" in backup["indices"]:
        try:
            await load_prompts_cache()
            logger.info("[restore] 시스템 프롬프트 캐시 재동기화 완료")
        except Exception as e:
            logger.warning("[restore] 시스템 프롬프트 캐시 재동기화 실패: %s", e)

    plugin_reconciliation = []
    if backup_plugins:
        try:
            from services.plugin_manager import (
                reconcile_plugin_data,
                record_restored_plugin_inventory,
            )
            restored_indices = set(backup["indices"].keys())
            await record_restored_plugin_inventory(backup_plugins, restored_indices)
            plugin_reconciliation = await reconcile_plugin_data()
            logger.info("[restore] plugin data reconciliation: %s", plugin_reconciliation)
        except Exception as e:
            logger.warning("[restore] plugin data reconciliation failed: %s", e)

    if SETTINGS_INDEX in backup["indices"]:
        try:
            from routers.deps import load_config_async
            from services.runtime_settings import apply_runtime_settings
            apply_runtime_settings((await load_config_async()).get("runtime_settings"))
            logger.info("[restore] 런타임 설정 재적용 완료")
        except Exception as e:
            logger.warning("[restore] 런타임 설정 재적용 실패: %s", e)

    # 연동 설정 복원 후 MCP worker를 새 설정과 일치시킨다.
    if INTEGRATION_SETTINGS_INDEX in backup["indices"]:
        try:
            from services.mcp_client import mcp_manager
            from services.mcp_config import build_servers_config
            await mcp_manager.connect_all(await build_servers_config())
            logger.info("[restore] mcp_manager 재동기화 완료")
        except Exception as e:
            logger.warning("[restore] mcp_manager 재동기화 실패: %s", e)

    # 복원 후 Google Workspace tool 재등록
    google_auth_ok = False if google_reconnect_required else None
    if INTEGRATION_SETTINGS_INDEX in backup["indices"]:
        try:
            from services.google_workspace.auth import get_credentials
            from services.google_workspace import register_google_workspace_tools, get_granted_scopes
            creds = await get_credentials()
            if creds and creds.valid:
                google_auth_ok = True
                granted = await get_granted_scopes()
                register_google_workspace_tools(mcp_manager, granted_scopes=granted)
                await mcp_manager.refresh_google_auth()
                logger.info("[restore] Google OAuth 토큰 유효 — tool 재등록 + 인증 캐시 갱신 완료")
            elif creds:
                google_auth_ok = False
                logger.warning("[restore] Google OAuth 토큰 만료/무효 — 재연결 필요")
            else:
                google_auth_ok = False
                logger.info("[restore] Google OAuth 토큰 없음")
        except Exception as e:
            google_auth_ok = False
            logger.warning("[restore] Google OAuth 검증 실패: %s", e)

    return {
        "ok": True,
        "detail": result,
        "files_restored": files_restored,
        "files_skipped": files_skipped,
        "total_inserted": sum(v.get("inserted", 0) for v in result.values()),
        "total_skipped": sum(v.get("skipped", 0) for v in result.values()),
        "google_auth_ok": google_auth_ok,
        "plugins": plugin_reconciliation,
    }


@router.post("/backup/export-to-drive")
async def export_backup_to_drive(req: ExportRequest = None):
    """백업을 생성한 뒤 Google Drive의 vyact 폴더에 업로드한다."""
    from services.google_workspace.auth import _build_service

    es = get_es()
    try:
        all_indices = await _get_user_indices(es)
        if req and req.indices:
            index_names = _expand_selected_indices(req.indices, all_indices)
        else:
            index_names = all_indices

        include_files = req.include_files if req else True

        backup = {
            "vyact_backup": True,
            "version": "3.0",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "include_files": include_files,
            "indices": {},
        }
        from services.plugin_manager import get_backup_plugin_inventory
        backup["plugins"] = await get_backup_plugin_inventory()

        for idx in index_names:
            schema = await _get_schema(es, idx)
            docs = await _scroll_all(es, idx)
            backup["indices"][idx] = {"schema": schema, "docs": docs}
            logger.info("[backup-drive] %s: %s건", idx, len(docs))

        json_bytes = json.dumps(backup, ensure_ascii=False, indent=2).encode("utf-8")
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")

        if include_files and (DOCS_DIR.exists() or MEMO_ATTACHMENTS_DIR.exists()):
            zip_buf = io.BytesIO()
            with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("backup.json", json_bytes)
                if DOCS_DIR.exists():
                    for f in DOCS_DIR.iterdir():
                        if f.is_file():
                            zf.write(f, f"documents/{f.name}")
                if MEMO_ATTACHMENTS_DIR.exists():
                    for f in MEMO_ATTACHMENTS_DIR.rglob("*"):
                        if f.is_file():
                            zf.write(f, f"memo_attachments/{f.relative_to(MEMO_ATTACHMENTS_DIR)}")
            file_bytes = zip_buf.getvalue()
            filename = f"vyact_backup_{ts}.zip"
            mime_type = "application/zip"
        else:
            file_bytes = json_bytes
            filename = f"vyact_backup_{ts}.json"
            mime_type = "application/json"
    finally:
        await es.close()

    if req and req.provider == "microsoft":
        return await upload_backup(file_bytes, filename, req.account_id or "")

    # Google Drive 업로드
    try:
        from googleapiclient.http import MediaInMemoryUpload
    except ImportError:
        raise HTTPException(500, "googleapiclient 패키지가 설치되어 있지 않습니다.")

    service = await _build_service("drive", "v3", account_id=req.account_id if req else None)

    # vyact 폴더 찾기 또는 생성
    query = "name = 'vyact' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    results = service.files().list(q=query, pageSize=1, fields="files(id,name)").execute()
    folders = results.get("files", [])

    if folders:
        folder_id = folders[0]["id"]
    else:
        folder_meta = {
            "name": "vyact",
            "mimeType": "application/vnd.google-apps.folder",
        }
        folder = service.files().create(body=folder_meta, fields="id").execute()
        folder_id = folder["id"]
        logger.info("[backup-drive] vyact 폴더 생성: %s", folder_id)

    # 백업 파일 업로드
    file_meta = {"name": filename, "parents": [folder_id]}
    media = MediaInMemoryUpload(file_bytes, mimetype=mime_type, resumable=False)
    uploaded = service.files().create(
        body=file_meta, media_body=media, fields="id,name,webViewLink"
    ).execute()

    logger.info("[backup-drive] 업로드 완료: %s → %s", filename, uploaded["id"])

    return {
        "ok": True,
        "file_id": uploaded["id"],
        "file_name": uploaded["name"],
        "web_link": uploaded.get("webViewLink", ""),
        "folder_id": folder_id,
    }
