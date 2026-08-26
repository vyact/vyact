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
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from logger import get_logger
from services.db import INTEGRATION_SETTINGS_INDEX, get_es

logger = get_logger(__name__)

_MCP_DOC_ID = "mcp"

# 서버 타입별 노출 tool 화이트리스트.
# 작은 모델(gemma4:e4b 등)은 tool이 많으면 선택 정확도가 급락하므로,
# tool이 많은 서버는 자주 쓰는 조회 위주 tool만 LLM에 노출한다.
# (빈 리스트/미정의면 전체 노출)
TOOL_WHITELIST: dict[str, list[str]] = {
    "filesystem": [
        "read_text_file",  # 파일 읽기
        "write_file",  # 파일 쓰기
        "edit_file",  # 파일 수정
        "list_directory",  # 폴더 목록
        "directory_tree",  # 폴더 구조
        "search_files",  # 파일 검색
    ],
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
        "kind": "stdio_npx",
        "package": "@modelcontextprotocol/server-filesystem",
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
    "github": {
        "label": "GitHub",
        "singleton": True,
        "kind": "remote",
        "fields": [
            {"key": "token", "label": "Personal Access Token", "type": "secret", "required": True},
        ],
        "default_prompt": (
            "## GitHub 코드 수정 및 PR 생성 규칙\n"
            "사용자가 GitHub 저장소의 코드를 수정하거나 PR을 요청하면 아래 순서를 따른다.\n\n"
            "1. **코드 확인**: get_file_contents로 대상 파일의 현재 내용과 SHA를 조회한다.\n"
            "2. **브랜치 생성**: create_branch로 작업 브랜치를 생성한다.\n"
            "   - 브랜치명은 작업 내용을 반영한다 (예: fix/typo-in-readme, feat/add-login-api).\n"
            "   - from_ref는 기본 브랜치(main 또는 master)를 사용한다.\n"
            "3. **파일 수정**: create_or_update_file로 변경된 내용을 커밋한다.\n"
            "   - 반드시 1단계에서 조회한 SHA를 전달해야 한다 (충돌 방지).\n"
            "   - 커밋 메시지는 변경 내용을 명확히 기술한다.\n"
            "   - 여러 파일을 수정할 때는 push_files를 사용하면 한 번에 커밋할 수 있다.\n"
            "4. **PR 생성**: create_pull_request로 PR을 생성한다.\n"
            "   - title: 변경 요약 (한국어 가능)\n"
            "   - body: 무엇을 왜 바꿨는지 설명\n"
            "   - head: 2단계의 작업 브랜치, base: 기본 브랜치\n\n"
            "주의사항:\n"
            "- 파일을 수정하기 전에 반드시 현재 내용을 먼저 조회해라.\n"
            "- 수정 내용을 사용자에게 먼저 보여주고, 확인 후 커밋해라.\n"
            "- 기본 브랜치를 모르면 list_branches로 확인해라.\n"
            "- '코드 리뷰해줘'는 get_file_contents로 읽어서 리뷰만 하면 된다 (수정 불필요)."
        ),
    },
    "sequential_thinking": {
        "label": "순차적 사고 (Sequential Thinking)",
        "singleton": True,
        "kind": "stdio_npx",
        "package": "@modelcontextprotocol/server-sequential-thinking",
        "fields": [],  # 별도 입력값 없음 — 켜기만 하면 동작
        "default_prompt": (
            "## 순차적 사고(Sequential Thinking) 사용 규칙\n"
            "디버깅, 아키텍처 설계, 근본 원인 분석, 투자 판단, 복잡한 비교·의사결정처럼\n"
            "여러 단계의 추론이 필요한 작업에서는 sequential thinking tool을 사용해\n"
            "사고를 단계별로 나누어 진행합니다. 각 단계에서 이전 결론을 검토하고 필요하면\n"
            "수정하며 최종 답에 도달합니다.\n"
            "단순 사실 질문, 짧은 답변, 단일 조회로 끝나는 요청에는 사용하지 않습니다."
        ),
    },
    "google_workspace": {
        "label": "Google Workspace",
        "singleton": True,
        "kind": "internal",
        # Google Workspace는 프론트의 계정 카드 UI에서 accounts[]로 관리한다.
        "fields": [],
        "default_prompt": (
            "## Google Workspace 사용 규칙\n"
            "Gmail, Google Calendar, Google Drive, Google Docs 도구를 사용할 수 있다.\n"
            "사용 가능한 모든 도구는 사용자의 요청에 따라 적극적으로 활용한다.\n\n"

            "## 1. Gmail (이메일)\n"
            "- 이메일 검색은 search_emails를 사용한다.\n"
            "- 이메일 상세 내용 확인은 get_email을 사용한다.\n"
            "- 이메일 초안 작성은 create_email_draft를 사용한다.\n"
            "- 이메일 전송은 send_email을 사용한다.\n"
            "- 이메일 답장은 reply_email을 사용한다.\n"
            "- 이메일 삭제는 trash_email을 사용한다.\n"
            "- 여러 이메일 삭제는 batch_trash_emails를 사용한다.\n"
            "- 이메일 관련 작업 시 대상 이메일, 수신자, 제목, 내용을 정확히 확인한다.\n"
            "- 사용자의 요청 목적에 맞는 이메일 작업을 수행하며 필요한 경우 관련 이메일을 먼저 검색한다.\n\n"

            "## 2. Google Calendar (일정)\n"
            "- 다가오는 일정 확인은 list_upcoming_events를 사용한다.\n"
            "- 특정 일정 검색은 search_calendar_events를 사용한다.\n"
            "- 캘린더 목록 확인은 list_calendars를 사용한다.\n"
            "- 사용자의 빈 시간 확인은 check_free_busy를 사용한다.\n"
            "- 특정 일정 상세 확인은 get_calendar_event를 사용한다.\n"
            "- 새로운 일정 생성은 create_calendar_event를 사용한다.\n"
            "- 기존 일정 수정은 update_calendar_event를 사용한다.\n"
            "- 일정 삭제는 delete_calendar_event를 사용한다.\n"
            "- 일정 관련 작업 시 제목, 날짜, 시간, 참석자, 위치, 설명 정보를 정확히 처리한다.\n\n"

            "### 캘린더 날짜 및 시간 처리 규칙\n"
            "- 날짜와 시간은 ISO 8601 형식으로 처리한다.\n"
            "- 사용자가 입력한 timezone을 유지한다.\n"
            "- Google Calendar API 요청 시 timezone 정보를 함께 전달한다.\n"
            "- 예: 서울 시간 오후 3시는 '2026-07-20T15:00:00+09:00' 형태로 처리한다.\n"
            "- 내부적으로 UTC 변환이 필요한 경우에도 사용자에게 표시하는 시간은 원래 timezone 기준으로 유지한다.\n"
            "- timezone 정보가 명확하지 않은 경우 사용자의 기본 timezone을 사용한다.\n"
            "- 여러 timezone이 관련된 경우 가장 적절한 timezone을 판단하거나 필요한 경우 확인한다.\n"
            "- 날짜만 입력된 경우 종일 일정(all-day event)으로 처리한다.\n"
            "- 일정 시간이 불명확한 경우 임의로 시간을 생성하지 않는다.\n\n"

            "## 3. Google Drive (파일 관리)\n"
            "- 파일 검색은 search_files를 사용한다.\n"
            "- 파일 상세 정보 조회는 get_drive_file을 사용한다.\n"
            "- 문서 내용 확인은 read_document_content를 사용한다.\n"
            "- 폴더 내부 목록 확인은 list_drive_folder_items를 사용한다.\n"
            "- 로컬 파일을 Drive에 업로드는 upload_drive_file을 사용한다.\n"
            "- Drive 파일 다운로드는 download_drive_file을 사용한다. 사용자의 ~/Downloads 폴더에 저장된다.\n"
            "- 텍스트 파일 생성은 create_drive_file을 사용한다.\n"
            "- 파일 수정은 update_drive_file을 사용한다.\n"
            "- 파일 삭제는 delete_drive_file을 사용한다.\n"
            "- 파일 이동은 move_drive_file을 사용한다.\n"
            "- 폴더 생성은 create_drive_folder를 사용한다.\n"
            "- Drive 작업 시 파일명, 위치, 대상 파일을 정확히 확인한다.\n"
            "- 문서를 수정/재작성 요청 시 반드시 create_google_doc 또는 update_google_doc을 호출하여 실제로 저장한다. 텍스트로만 답변하지 않는다.\n\n"

            "## 4. Google Docs (문서 관리)\n"
            "- Google 문서 생성은 create_google_doc을 사용한다.\n"
            "- Google 문서 조회는 get_google_doc을 사용한다.\n"
            "- 문서 마지막에 내용 추가는 append_to_google_doc을 사용한다.\n"
            "- 문서 내용 수정은 update_google_doc을 사용한다.\n"
            "- 문서 수정 시 기존 내용을 보호하고 요청된 범위만 변경한다.\n\n"

            "## 5. Google Sheets (스프레드시트)\n"
            "- 스프레드시트 생성은 create_google_sheet을 사용한다.\n"
            "- 스프레드시트 정보/데이터 조회는 get_google_sheet을 사용한다.\n"
            "- 셀 데이터 수정은 update_google_sheet을 사용한다.\n"
            "- 행 추가는 append_to_google_sheet을 사용한다.\n"
            "- 데이터 삭제는 clear_google_sheet을 사용한다.\n"
            "- values 파라미터는 JSON 2차원 배열 문자열로 전달한다.\n\n"

            "## 6. Google Slides (프레젠테이션)\n"
            "- 프레젠테이션 생성은 create_google_slides를 사용한다.\n"
            "- 프레젠테이션 정보 조회는 get_google_slides를 사용한다.\n"
            "- 슬라이드 추가는 add_slide를 사용한다.\n"
            "- 텍스트 수정은 update_slide_text를 사용한다.\n"
            "- 슬라이드 삭제는 delete_slide를 사용한다.\n"
            "- 슬라이드 추가 시 layout으로 BLANK, TITLE, TITLE_AND_BODY 등을 지정할 수 있다.\n\n"

            "## 7. Google Forms (설문지)\n"
            "- 설문지 생성은 create_google_form을 사용한다.\n"
            "- 설문지 정보 조회는 get_google_form을 사용한다.\n"
            "- 질문 추가는 add_form_question을 사용한다.\n"
            "- 응답 조회는 get_form_responses를 사용한다.\n"
            "- 설문지 제목/설명 수정은 update_form_info를 사용한다.\n"
            "- 질문 유형: TEXT, PARAGRAPH, RADIO, CHECKBOX, DROP_DOWN, SCALE\n\n"

            "## 작업 처리 원칙\n"
            "- 사용자의 요청 의도를 정확히 파악하고 적절한 Google Workspace 도구를 선택한다.\n"
            "- 여러 단계가 필요한 작업은 필요한 순서대로 도구를 호출한다.\n"
            "- 검색이 필요한 작업은 먼저 관련 데이터를 조회한 후 작업한다.\n"
            "- 대상이 불명확하거나 여러 개 존재하는 경우 가장 가능성 높은 대상을 선택하지 말고 확인한다.\n"
            "- 중요한 데이터 변경 작업은 변경 범위를 정확히 파악한 후 수행한다.\n"
            "- 작업 결과를 사용자에게 명확하게 요약한다."
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
        ],
        "default_prompt": (
            "## Context7 사용 규칙 (예시 — @upstash/context7-mcp 등록 시 참고)\n"
            "라이브러리/API/프레임워크/docker-compose 관련 요청에서는 반드시 Context7 MCP를 먼저 호출합니다.\n"
            "Context7 조회 전에는 코드를 생성하지 않습니다."
        ),
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
        ],
    },
}


def _default_config() -> dict:
    """기본값: 비활성 filesystem·browser 도구."""
    return {"servers": [
        {
            "id": uuid.uuid4().hex[:8],
            "type": "filesystem",
            "enabled": False,
            "config": {"directories": [str(Path.home())]},
        },
        {"id": uuid.uuid4().hex[:8], "type": "browser", "enabled": False, "config": {}},
    ]}


def _ensure_builtin_servers(cfg: dict) -> tuple[dict, bool]:
    """기존 설치에도 비활성 기본 internal 도구를 안전하게 추가한다."""
    servers = cfg.setdefault("servers", [])
    if any(server.get("type") == "browser" for server in servers):
        return cfg, False
    servers.append({"id": uuid.uuid4().hex[:8], "type": "browser", "enabled": False, "config": {}})
    return cfg, True


async def load_mcp_config() -> dict:
    try:
        es = get_es()
        try:
            res = await es.get(index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID, ignore=[404])
            if res.get("found"):
                value = res["_source"].get("value")
                if value and isinstance(value.get("servers"), list):
                    return _ensure_builtin_servers(value)[0]
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
            if changed:
                await es.index(
                    index=INTEGRATION_SETTINGS_INDEX, id=_MCP_DOC_ID,
                    document={"key": _MCP_DOC_ID, "value": value}, refresh=True,
                )
                logger.info("[mcp_config] default browser MCP config added")
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


async def add_server(type_: str, config: dict, enabled: bool = True, prompt: str = "") -> dict:
    if type_ not in MCP_CATALOG:
        raise ValueError(f"알 수 없는 MCP 타입: {type_}")
    cfg = await load_mcp_config()
    server = {"id": uuid.uuid4().hex[:8], "type": type_,
              "enabled": enabled, "config": config or {},
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
            if prompt is not None:
                s["prompt"] = prompt.strip()
            break
    await save_mcp_config(cfg)
    return cfg.get("servers", [])


async def remove_server(server_id: str) -> list[dict]:
    cfg = await load_mcp_config()
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
# 예전엔 "context7이 켜져 있으면 이 문구를, sequential thinking이 켜져 있으면
# 저 문구를 붙인다"처럼 서버 타입별로 주입할 프롬프트가 코드에 하드코딩돼 있었다.
# 이제는 서버 등록/편집 시 사용자가 직접 입력한 prompt 필드를 그대로 사용하고,
# enabled인 서버 중 prompt가 비어있지 않은 것만 모아 이어붙인다. 비어있으면 아무것도 추가하지 않는다.
async def get_active_mcp_prompt(selected_server_ids: set[str] | None = None) -> str:
    """서버들의 prompt를 등록 순서대로 이어붙여 반환. 없으면 빈 문자열.

    selected_server_ids가 주어지면 enabled 여부와 관계없이 해당 서버만 포함한다.
    이는 @ 선택 요청에서 off MCP의 개별 프롬프트도 도구와 같은 범위로 주입하기 위함이다.
    사용자가 프롬프트를 비워뒀으면 카탈로그의 default_prompt를 사용한다.
    """
    parts = []
    for s in await list_servers():
        if selected_server_ids is None and not s.get("enabled"):
            continue
        if selected_server_ids is not None and s.get("id") not in selected_server_ids:
            continue
        p = (s.get("prompt") or "").strip()
        if not p:
            cat = MCP_CATALOG.get(s.get("type", ""), {})
            p = cat.get("default_prompt", "")
        if p:
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
            if type_ == "filesystem":
                dirs = [d for d in conf.get("directories", []) if Path(d).is_dir()]
                if not dirs:
                    continue
                servers[key] = {"command": npx, "args": ["-y", cat["package"], *dirs], "env": {}}
            elif type_ == "github":
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
        if key in servers and type_ in TOOL_WHITELIST:
            servers[key]["tool_whitelist"] = TOOL_WHITELIST[type_]

    return servers
