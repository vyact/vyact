"""
services/mcp_config.py — MCP 서버 설정 저장/로드 (ES 기반)

저장 위치: ES INTEGRATION_SETTINGS_INDEX, id="mcp", 구조 {"key":"mcp", "value":{...}}
  value 구조:
    { "servers": [
        {"id": "fs1", "type": "filesystem", "enabled": true,
         "config": {"directories": ["/Users/alex"]}},
        {"id": "gh1", "type": "github", "enabled": false,
         "config": {"token": "ghp_..."}},
        {"id": "custom1", "type": "custom", "enabled": true,
         "config": {"name": "myserver", "command": "npx", "args": ["-y","x"], "env": {}}},
      ]
    }

ES에 저장하므로 기존 백업/복원(전 인덱스 백업)에 자동 포함된다.
연결에 필요한 stdio config 변환은 build_servers_config()가 담당한다.
"""
import hashlib
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from logger import get_logger
from services.db import INTEGRATION_SETTINGS_INDEX, get_es
from services.tool_messages import get_tool_language
from services.filesystem_prompts import get_filesystem_prompt
from services.web_search_prompts import get_web_search_prompt
from services.workspace_prompts import get_workspace_prompt

logger = get_logger(__name__)

_MCP_DOC_ID = "mcp"
_BUILTIN_MIGRATION_TYPES = ("browser", "web_search")

# Earlier settings screens saved their displayed stock prompt as if it were a
# user edit. Match only those exact released defaults when upgrading the two
# prompts below; genuinely edited instructions must remain untouched.
_LEGACY_DEFAULT_PROMPT_HASHES = {
    "github": frozenset({
        "0987ec0847d02aa6", "d53c976daad913e0", "da5e23cf0be5c6c3",
        "01aa2c5349d4ec7c", "9b9e5b28c625fe27", "66cea7c0e48c9675",
        "7d5df05730bf3754", "858c765be1c79ca1", "9412980b07125c42",
    }),
    "sequential_thinking": frozenset({
        "62130635b3ee2cdd", "d62659c9ba43b76d", "c8e1817e6f4cb4db",
        "1e7779244a5cc52c", "3a4e096c6b7a78d8", "77c0b3db65b07f1f",
        "36f81986c25a471c", "8a4936779fe879ac", "633a55bc65bdc49a",
    }),
}


def _clear_legacy_default_prompts(cfg: dict) -> bool:
    changed = False
    for server in cfg.get("servers", []):
        prompt = (server.get("prompt") or "").strip()
        if not prompt:
            continue
        fingerprint = hashlib.sha256(prompt.encode()).hexdigest()[:16]
        if fingerprint in _LEGACY_DEFAULT_PROMPT_HASHES.get(server.get("type"), ()):
            server["prompt"] = ""
            changed = True
    return changed

# 서버 타입별 노출 tool 화이트리스트.
# 작은 모델(gemma4:e4b 등)은 tool이 많으면 선택 정확도가 급락하므로,
# tool이 많은 서버는 자주 쓰는 조회 위주 tool만 LLM에 노출한다.
# (빈 리스트/미정의면 전체 노출)
TOOL_WHITELIST: dict[str, list[str]] = {
    "github": [
        "search_repositories",  # 저장소 검색 (public)
        "list_user_repositories",  # 사용자 저장소 목록 (private 포함)
        "get_file_contents",  # 파일 내용 조회
        "list_commits",  # 커밋 목록
        "list_issues",  # 이슈 목록
        "get_issue",  # 이슈 상세
        "create_issue",  # 이슈 생성
        "search_code",  # 코드 검색
        "list_pull_requests",  # PR 목록
        "get_pull_request",  # PR 상세
        "list_branches",  # 브랜치 목록
        "create_branch",  # 브랜치 생성
        "create_or_update_file",  # 파일 생성/수정 + 커밋
        "push_files",  # 여러 파일 한번에 커밋·푸시
        "create_pull_request",  # PR 생성
    ],
    "google_workspace": [
        # Gmail
        "search_emails",  # 이메일 검색
        "get_email",  # 이메일 상세 조회
        "create_email_draft",  # 초안 작성
        "send_email",  # 이메일 전송
        "reply_email",  # 이메일 답장
        "trash_email",  # 이메일 삭제 (휴지통)
        "batch_trash_emails",  # 이메일 일괄 삭제
        # Calendar
        "list_upcoming_events",  # 다가오는 일정
        "search_calendar_events",  # 일정 검색
        "list_calendars",  # 캘린더 목록
        "check_free_busy",  # 빈 시간 확인
        "get_calendar_event",  # 일정 상세
        "create_calendar_event",  # 일정 생성
        "update_calendar_event",  # 일정 수정
        "delete_calendar_event",  # 일정 삭제
        # Drive
        "search_files",  # 파일 검색
        "get_drive_file",  # 파일 조회
        "read_document_content",  # 문서 내용 읽기
        "list_drive_folder_items",  # 폴더 내용 목록
        "create_drive_file",  # 파일 생성
        "update_drive_file",  # 파일 업데이트
        "delete_drive_file",  # 파일 삭제 (휴지통)
        "move_drive_file",  # 파일 이동
        "create_drive_folder",  # 폴더 생성
        # Docs
        "create_google_doc",  # 문서 생성
        "get_google_doc",  # 문서 읽기
        "append_to_google_doc",  # 문서 끝에 추가
        "update_google_doc",  # 문서 찾아 바꾸기
        # Sheets
        "create_google_sheet",  # 스프레드시트 생성
        "get_google_sheet",  # 스프레드시트 읽기
        "update_google_sheet",  # 셀 업데이트
        "append_to_google_sheet",  # 행 추가
        "clear_google_sheet",  # 범위 삭제
        # Slides
        "create_google_slides",  # 프레젠테이션 생성
        "get_google_slides",  # 프레젠테이션 읽기
        "add_slide",  # 슬라이드 추가
        "update_slide_text",  # 텍스트 찾아 바꾸기
        "delete_slide",  # 슬라이드 삭제
        # Forms
        "create_google_form",  # 설문지 생성
        "get_google_form",  # 설문지 읽기
        "add_form_question",  # 질문 추가
        "get_form_responses",  # 응답 조회
        "update_form_info",  # 설문지 정보 수정
    ],
}

# ── MCP 서버 타입 카탈로그 (프리셋) ─────────────────────────────────────────
# 각 타입이 어떤 입력 필드를 받고, 외부 프로세스로 실행되는지(kind) 정의.
#   kind="stdio_npx": npx로 실행되는 외부 MCP 서버
#   kind="internal" : 파이썬 내부 tool. 실행 config 불필요.
#   kind="custom"   : 사용자가 command/args/env 직접 지정
#   kind="sse"      : SSE(Server-Sent Events) 방식 원격 MCP 서버
#   kind="streamable_http" : Streamable HTTP 방식 원격 MCP 서버
MCP_CATALOG: dict[str, dict] = {
    "filesystem": {
        "label": "파일 시스템",
        "singleton": True,
        "kind": "internal",
        "default_prompt": get_filesystem_prompt("en"),
        "fields": [
            {"key": "directories", "label": "허용 폴더", "type": "dir_list", "required": True},
        ],
    },
    "browser": {
        "label": "브라우저",
        "singleton": True,
        "kind": "internal",
        "fields": [],
    },
    "web_search": {
        "label": "Web Search (Tavily)",
        "singleton": True,
        "kind": "internal",
        "fields": [{"key": "api_key", "label": "API Key", "type": "secret", "required": True}],
        "default_prompt": get_web_search_prompt("en"),
    },
    "github": {
        "label": "GitHub",
        "singleton": True,
        "kind": "remote",
        "fields": [
            {"key": "token", "label": "Personal Access Token", "type": "secret", "required": True},
        ],
        "default_prompt": (
            "GitHub 작업에는 실제 제공된 도구만 사용합니다. 수정 전 대상 파일·현재 SHA와 기본 브랜치를 확인하고, "
            "별도 작업 브랜치에서 요청 범위만 변경합니다. 여러 파일 변경은 가능한 도구의 원자적 커밋을 사용합니다. "
            "PR은 요청받았을 때 만들고 변경 이유를 설명합니다. 리뷰 요청은 읽기만 수행합니다. "
            "도구 결과로 확인되지 않은 커밋·PR을 완료로 보고하지 않습니다."
        ),
    },
    "sequential_thinking": {
        "label": "순차적 사고 (Sequential Thinking)",
        "singleton": True,
        "kind": "stdio_npx",
        "package": "@modelcontextprotocol/server-sequential-thinking",
        "fields": [],  # 별도 입력값 없음 — 켜기만 하면 동작
        "default_prompt": (
            "여러 단계의 분석·설계·디버깅이 필요한 경우에만 제공된 sequential thinking 도구로 "
            "근거와 결론을 단계별로 검토합니다. 단순 조회나 짧은 답변에는 사용하지 않습니다."
        ),
    },
    "microsoft_workspace": {"label": "Microsoft 365", "singleton": True, "kind": "internal", "fields": [], "default_prompt": get_workspace_prompt("microsoft_workspace", "en")},
    "google_workspace": {
        "label": "Google Workspace",
        "singleton": True,
        "kind": "internal",
        # Google Workspace는 프론트의 계정 카드 UI에서 accounts[]로 관리한다.
        "fields": [],
        "default_prompt": (
            get_workspace_prompt("google_workspace", "en")
        ),
    },
    "custom": {
        "label": "커스텀 MCP 서버 (stdio)",
        "kind": "custom",
        "fields": [
            {"key": "name", "label": "이름", "type": "text", "required": True},
            {"key": "command", "label": "실행 명령", "type": "text", "required": True},
            {"key": "args", "label": "인자 (줄바꿈 구분)", "type": "lines", "required": False},
            {"key": "env", "label": "환경변수 (KEY=VALUE, 줄바꿈)", "type": "env", "required": False},
            {"key": "trust_tool_annotations", "label": "서버의 읽기 전용 정보 신뢰 (조회 승인 생략)", "type": "toggle", "required": False},
        ],
    },
    "custom_remote": {
        "label": "커스텀 MCP 서버 (Remote)",
        "kind": "remote",
        "fields": [
            {"key": "name", "label": "이름", "type": "text", "required": True},
            {"key": "url", "label": "서버 URL", "type": "text", "required": True},
            {"key": "transport", "label": "전송 방식", "type": "select", "required": True,
             "options": [
                 {"value": "streamable_http", "label": "Streamable HTTP (권장)"},
                 {"value": "sse", "label": "SSE"},
             ]},
            {"key": "headers", "label": "헤더 (KEY=VALUE, 줄바꿈)", "type": "env", "required": False},
            {"key": "trust_tool_annotations", "label": "서버의 읽기 전용 정보 신뢰 (조회 승인 생략)", "type": "toggle", "required": False},
        ],
    },
}


def _default_config() -> dict:
    """기본값: 비활성 filesystem·browser·web_search 도구."""
    return {"servers": [
        {
            "id": uuid.uuid4().hex[:8],
            "type": "filesystem",
            "enabled": False,
            "config": {"directories": [str(Path.home())]},
        },
        {"id": uuid.uuid4().hex[:8], "type": "browser", "enabled": False, "config": {}},
        {"id": uuid.uuid4().hex[:8], "type": "web_search", "enabled": False, "config": {}},
    ]}


def _ensure_builtin_servers(cfg: dict) -> tuple[dict, bool]:
    """기존 설치에도 비활성 기본 internal 도구를 안전하게 추가한다."""
    servers = cfg.setdefault("servers", [])
    existing_types = {server.get("type") for server in servers}
    removed_types = set(cfg.get("removed_builtin_server_types", []))
    missing_types = [
        type_ for type_ in _BUILTIN_MIGRATION_TYPES
        if type_ not in existing_types and type_ not in removed_types
    ]
    for type_ in missing_types:
        servers.append({"id": uuid.uuid4().hex[:8], "type": type_, "enabled": False, "config": {}})
    return cfg, bool(missing_types)


async def load_mcp_config() -> dict:
    try:
        es = get_es()
        try:
            res = await es.get(index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID, ignore=[404])
            if res.get("found"):
                value = res["_source"].get("value")
                if value and isinstance(value.get("servers"), list):
                    value, changed = _ensure_builtin_servers(value)
                    changed = _clear_legacy_default_prompts(value) or changed
                    if changed:
                        # Persist generated IDs before exposing them to callers; otherwise
                        # the next read creates different IDs and deletion cannot match.
                        await es.index(
                            index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID,
                            document={"key": _MCP_DOC_ID, "value": value}, refresh=True,
                        )
                    return value
        finally:
            await es.close()
    except Exception as e:
        from config import SETUP_DONE
        if SETUP_DONE.exists():
            logger.warning("[mcp_config] ES load failed, using defaults: %s", e)
        else:
            logger.debug("[mcp_config] ES not available (initial setup), using defaults")
    return _default_config()


async def save_mcp_config(cfg: dict) -> None:
    try:
        es = get_es()
        try:
            await es.index(index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID,
                           document={"key": _MCP_DOC_ID, "value": cfg}, refresh=True)
        finally:
            await es.close()
    except Exception as e:
        logger.warning("[mcp_config] ES save failed: %s", e)


async def ensure_mcp_config() -> dict:
    """ES에 MCP 문서가 없을 때만 설치 기본값을 영속화한다."""
    es = get_es()
    try:
        if await es.exists(index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID):
            res = await es.get(index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID)
            value = res["_source"].get("value")
            if not isinstance(value, dict):
                return {"servers": []}
            value, changed = _ensure_builtin_servers(value)
            changed = _clear_legacy_default_prompts(value) or changed
            if changed:
                await es.index(
                    index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID,
                    document={"key": _MCP_DOC_ID, "value": value}, refresh=True,
                )
                logger.info("[mcp_config] default internal MCP configs added")
            return value

        cfg = _default_config()
        await es.index(
            index=INTEGRATION_SETTINGS_INDEX,
            id=_MCP_DOC_ID,
            document={"key": _MCP_DOC_ID, "value": cfg},
            refresh=True,
        )
        logger.info("[mcp_config] default filesystem MCP config created")
        return cfg
    finally:
        await es.close()


# ── 서버 CRUD ───────────────────────────────────────────────────────────────
async def list_servers() -> list[dict]:
    return (await load_mcp_config()).get("servers", [])


async def reorder_servers(server_ids: list[str]) -> list[dict]:
    """Reorder existing records without changing the backup schema or credentials."""
    es = get_es()
    try:
        result = await es.get(index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID)
        cfg = result["_source"]["value"]
        servers = cfg["servers"]
        by_id = {server["id"]: server for server in servers}
        requested_ids = set(server_ids)
        if len(server_ids) != len(requested_ids) or not requested_ids <= by_id.keys():
            raise ValueError("Invalid MCP server order")
        ordered = iter(by_id[server_id] for server_id in server_ids)
        cfg["servers"] = [next(ordered) if server["id"] in requested_ids else server for server in servers]
        # Fail on concurrent edits and storage errors rather than reporting a false success.
        await es.index(
            index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID,
            document={**result["_source"], "value": cfg}, refresh=True,
            if_seq_no=result["_seq_no"], if_primary_term=result["_primary_term"],
        )
        return cfg["servers"]
    finally:
        await es.close()


async def add_server(type_: str, config: dict, enabled: bool = True, prompt: str = "") -> dict:
    if type_ not in MCP_CATALOG:
        raise ValueError(f"알 수 없는 MCP 타입: {type_}")
    cfg = await load_mcp_config()
    server = {"id": uuid.uuid4().hex[:8], "type": type_,
              "enabled": enabled and (type_ != "web_search" or bool((config or {}).get("api_key", "").strip())), "config": config or {},
              "prompt": (prompt or "").strip()}
    cfg.setdefault("servers", []).append(server)
    await save_mcp_config(cfg)
    return server


async def update_server(server_id: str, *, config: dict | None = None,
                        enabled: bool | None = None, prompt: str | None = None) -> list[dict]:
    cfg = await load_mcp_config()
    for s in cfg.get("servers", []):
        if s.get("id") == server_id:
            if config is not None:
                s["config"] = config
            if enabled is not None:
                s["enabled"] = enabled
            if s.get("type") == "web_search" and not (s.get("config") or {}).get("api_key", "").strip():
                s["enabled"] = False
            if prompt is not None:
                s["prompt"] = prompt.strip()
            break
    await save_mcp_config(cfg)
    return cfg.get("servers", [])


async def remove_server(server_id: str) -> list[dict]:
    cfg = await load_mcp_config()
    removed_types = set(cfg.get("removed_builtin_server_types", []))
    removed_types.update(
        server["type"] for server in cfg.get("servers", [])
        if server.get("id") == server_id and server.get("type") in _BUILTIN_MIGRATION_TYPES
    )
    if removed_types:
        cfg["removed_builtin_server_types"] = sorted(removed_types)
    cfg["servers"] = [s for s in cfg.get("servers", []) if s.get("id") != server_id]
    await save_mcp_config(cfg)
    return cfg["servers"]


async def disable_server_by_type(type_: str) -> None:
    """특정 타입의 enabled 서버를 비활성화한다. 인증 실패 시 자동 호출용."""
    if not type_:
        return
    cfg = await load_mcp_config()
    for s in cfg.get("servers", []):
        if s.get("type") == type_ and s.get("enabled"):
            s["enabled"] = False
            logger.info("[mcp_config] auth failed, disabling '%s' server", type_)
    await save_mcp_config(cfg)


# ── 켜진 MCP 서버들의 사용자 지정 프롬프트 취합 ───────────────────────────────
# 사용자가 저장한 prompt를 우선 사용하고, 비어 있으면 카탈로그 기본값을 쓴다.
# 도구 목록을 받으면 실제 노출된 서버의 프롬프트만 모델에 전달한다.
async def get_active_mcp_prompt(
    selected_server_ids: set[str] | None = None,
    available_tool_names: list[str] | None = None,
) -> str:
    """서버들의 prompt를 등록 순서대로 이어붙여 반환. 없으면 빈 문자열.

    selected_server_ids가 주어지면 enabled 여부와 관계없이 해당 서버만 포함한다.
    이는 @ 선택 요청에서 off MCP의 개별 프롬프트도 도구와 같은 범위로 주입하기 위함이다.
    사용자가 프롬프트를 비워뒀으면 카탈로그의 default_prompt를 사용한다.
    """
    parts = []
    exposed_ids: set[str] = set()
    exposed_types: set[str] = set()
    if available_tool_names is not None:
        from services.mcp_client import mcp_manager
        exposed_ids, exposed_types = mcp_manager.exposed_server_scopes(available_tool_names)
    for s in await list_servers():
        if selected_server_ids is None and not s.get("enabled"):
            continue
        if selected_server_ids is not None and s.get("id") not in selected_server_ids:
            continue
        if available_tool_names is not None:
            kind = MCP_CATALOG.get(s.get("type", ""), {}).get("kind")
            if kind == "internal" and s.get("type") not in exposed_types:
                continue
            if kind != "internal" and s.get("id") not in exposed_ids:
                continue
        p = (s.get("prompt") or "").strip()
        if not p:
            cat = MCP_CATALOG.get(s.get("type", ""), {})
            server_type = s.get("type")
            if server_type == "filesystem":
                p = get_filesystem_prompt(await get_tool_language())
            elif server_type == "web_search":
                p = get_web_search_prompt(await get_tool_language())
            elif server_type in {"google_workspace", "microsoft_workspace"}:
                p = get_workspace_prompt(server_type, await get_tool_language())
            else:
                p = cat.get("default_prompt", "")
        if p:
            if s.get("type") == "filesystem":
                from services.filesystem_tools import allowed_filesystem_folders
                folders = await allowed_filesystem_folders()
                if folders:
                    folder_list = ", ".join(f"{folder_id} ({path})" for folder_id, path in folders.items())
                    p += f"\nAllowed folder IDs: {folder_list}. Pass a folder_id and a path relative to that folder to filesystem_* tools."
            parts.append(p)
    return "\n\n".join(parts)


# ── GitHub username 조회 (토큰 주인) — tool 지시에 주입해 "내 저장소" 지원 ──────
# username은 github 서버 config에 저장한다 (ES 영속 → 앱 재시작해도 유지).
#   config["username"] : 조회된 GitHub 로그인 아이디
# 토큰을 바꾸면 update_server가 config를 교체하며 username이 사라지므로 자동 재조회된다.


async def get_github_username() -> str:
    """enabled인 github 서버의 username을 반환한다.

    config에 username이 있으면 그대로 사용하고(API 호출 없음),
    없으면 GET /user로 조회 후 ES config에 저장한다. 실패 시 ''를 반환한다.
    """
    cfg = await load_mcp_config()
    target = None
    for s in cfg.get("servers", []):
        if s.get("type") == "github" and s.get("enabled"):
            target = s
            break
    if target is None:
        return ""

    conf = target.get("config") or {}
    token = conf.get("token", "") or ""
    if not token:
        return ""

    # 저장된 username이 있으면 그대로 사용 (API 호출 없음)
    if conf.get("username"):
        return conf["username"]

    # username이 없으면 토큰으로 GitHub API 조회 후 저장
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {token}",
                         "Accept": "application/vnd.github+json"},
            )
            if res.status_code == 200:
                login = res.json().get("login", "") or ""
                conf["username"] = login
                target["config"] = conf
                await save_mcp_config(cfg)
                logger.info("[mcp_config] GitHub username resolved: %s", login)
                return login
            logger.warning("[mcp_config] GitHub /user query failed: %s", res.status_code)
    except Exception as e:
        logger.warning("[mcp_config] GitHub username lookup error: %s", e)
    return ""


# ── connect_all()용 서버 config 빌드 (외부 stdio 서버만) ─────────────────────
async def build_servers_config(include_server_ids: set[str] | None = None) -> dict:
    """enabled인 외부(stdio/sse/streamable_http) 서버만 mcp_manager.connect_all() 형태로 변환.
    internal 타입은 여기 포함하지 않는다(파이썬 내부 tool).
    """
    servers: dict[str, dict] = {}
    npx = shutil.which("npx")

    for s in await list_servers():
        if not s.get("enabled") and s.get("id") not in (include_server_ids or set()):
            continue
        type_ = s.get("type")
        cat = MCP_CATALOG.get(type_, {})
        kind = cat.get("kind")
        conf = s.get("config") or {}
        # LLM이 tool 이름으로 서버를 식별할 수 있도록
        # 사용자가 지정한 name을 key에 사용한다 (영문/숫자/_만 허용).
        # 긴 타입명은 짧은 별칭으로 대체 (gemma4 tool call 정확도 향상).
        _KEY_ALIAS = {"google_workspace": "google"}
        raw_name = conf.get("name") or ""
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "", raw_name)
        key = safe_name or _KEY_ALIAS.get(type_, "") or f"{type_}_{s.get('id')}"
        if key in servers:
            key = f"{key}_{s.get('id')}"

        if kind == "stdio_npx":
            if not npx:
                logger.warning("[mcp_config] npx not found — skipping %s", type_)
                continue
            if type_ == "github":
                # github은 이제 remote kind — stdio_npx에서는 스킵
                continue
            elif cat.get("package"):
                # 별도 입력값이 없는 npx 프리셋(예: sequential_thinking)은
                # 패키지만 실행한다.
                servers[key] = {"command": npx, "args": ["-y", cat["package"]], "env": {}}
        elif kind == "custom":
            command = conf.get("command", "")
            if not command:
                continue
            servers[key] = {"command": command,
                            "args": conf.get("args", []) or [],
                            "env": conf.get("env", {}) or {}}
        elif kind in ("sse", "streamable_http", "remote"):
            # GitHub 프리셋: PAT → Authorization 헤더로 변환
            if type_ == "github":
                token = conf.get("token", "")
                if not token:
                    continue
                servers[key] = {"transport": "streamable_http",
                                "url": "https://api.githubcopilot.com/mcp/",
                                "headers": {"Authorization": f"Bearer {token}"}}
            else:
                url = conf.get("url", "")
                if not url:
                    continue
                transport = conf.get("transport") or kind
                if transport == "remote":
                    transport = "streamable_http"
                servers[key] = {"transport": transport,
                                "url": url,
                                "headers": conf.get("headers", {}) or {}}

        # tool 화이트리스트 주입 (해당 타입에 정의된 경우)
        if key in servers:
            servers[key]["_server_id"] = s.get("id")
            servers[key]["_server_type"] = type_
            servers[key]["trust_tool_annotations"] = conf.get("trust_tool_annotations") is True
        if key in servers and type_ in TOOL_WHITELIST:
            servers[key]["tool_whitelist"] = TOOL_WHITELIST[type_]

    return servers
