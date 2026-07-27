"""OAuth2 자격증명 관리 및 Google API 서비스 빌더."""
import json
import asyncio
import concurrent.futures
import hashlib
from datetime import datetime

import httpx
from elasticsearch import ConnectionError as ElasticsearchConnectionError

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import Flow
    from googleapiclient.discovery import build
except ImportError:
    Request = None  # type: ignore
    Credentials = None  # type: ignore
    Flow = None  # type: ignore
    build = None  # type: ignore

from logger import get_logger
from services.db import get_es, SETTINGS_INDEX
from services.mcp_config import list_servers

logger = get_logger(__name__)

# ── OAuth2 설정 ──────────────────────────────────────────────────────────
GMAIL_FULL_ACCESS_SCOPE = "https://mail.google.com/"

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    # Gmail의 messages.delete/threads.delete는 gmail.modify로 호출할 수 없다.
    # 휴지통에서 영구 삭제를 지원하려면 이 scope를 OAuth 동의 시 받아야 한다.
    GMAIL_FULL_ACCESS_SCOPE,
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/forms.responses.readonly",
]

_TOKEN_ES_KEY_PREFIX = "google_workspace_token_"
_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"
_RECONNECT_REQUIRED = "reconnect_required"

# tool 이름 → 필요한 OAuth scope 매핑
_TOOL_SCOPE_MAP: dict[str, str] = {
    # Gmail
    "search_emails": "https://www.googleapis.com/auth/gmail.modify",
    "get_email": "https://www.googleapis.com/auth/gmail.modify",
    "create_email_draft": "https://www.googleapis.com/auth/gmail.modify",
    "send_email": "https://www.googleapis.com/auth/gmail.modify",
    "reply_email": "https://www.googleapis.com/auth/gmail.modify",
    "trash_email": "https://www.googleapis.com/auth/gmail.modify",
    "batch_trash_emails": "https://www.googleapis.com/auth/gmail.modify",
    # Calendar
    "list_upcoming_events": "https://www.googleapis.com/auth/calendar",
    "search_calendar_events": "https://www.googleapis.com/auth/calendar",
    "list_calendars": "https://www.googleapis.com/auth/calendar",
    "check_free_busy": "https://www.googleapis.com/auth/calendar",
    "get_calendar_event": "https://www.googleapis.com/auth/calendar",
    "create_calendar_event": "https://www.googleapis.com/auth/calendar",
    "update_calendar_event": "https://www.googleapis.com/auth/calendar",
    "delete_calendar_event": "https://www.googleapis.com/auth/calendar",
    # Drive
    "search_files": "https://www.googleapis.com/auth/drive",
    "get_drive_file": "https://www.googleapis.com/auth/drive",
    "read_document_content": "https://www.googleapis.com/auth/drive",
    "list_drive_folder_items": "https://www.googleapis.com/auth/drive",
    "upload_drive_file": "https://www.googleapis.com/auth/drive",
    "download_drive_file": "https://www.googleapis.com/auth/drive",
    "create_drive_file": "https://www.googleapis.com/auth/drive",
    "update_drive_file": "https://www.googleapis.com/auth/drive",
    "delete_drive_file": "https://www.googleapis.com/auth/drive",
    "move_drive_file": "https://www.googleapis.com/auth/drive",
    "create_drive_folder": "https://www.googleapis.com/auth/drive",
    # Docs
    "create_google_doc": "https://www.googleapis.com/auth/documents",
    "get_google_doc": "https://www.googleapis.com/auth/documents",
    "append_to_google_doc": "https://www.googleapis.com/auth/documents",
    "update_google_doc": "https://www.googleapis.com/auth/documents",
    # Sheets
    "create_google_sheet": "https://www.googleapis.com/auth/spreadsheets",
    "get_google_sheet": "https://www.googleapis.com/auth/spreadsheets",
    "update_google_sheet": "https://www.googleapis.com/auth/spreadsheets",
    "append_to_google_sheet": "https://www.googleapis.com/auth/spreadsheets",
    "clear_google_sheet": "https://www.googleapis.com/auth/spreadsheets",
    # Slides
    "create_google_slides": "https://www.googleapis.com/auth/presentations",
    "get_google_slides": "https://www.googleapis.com/auth/presentations",
    "add_slide": "https://www.googleapis.com/auth/presentations",
    "update_slide_text": "https://www.googleapis.com/auth/presentations",
    "delete_slide": "https://www.googleapis.com/auth/presentations",
    # Forms
    "create_google_form": "https://www.googleapis.com/auth/forms.body",
    "get_google_form": "https://www.googleapis.com/auth/forms.body",
    "add_form_question": "https://www.googleapis.com/auth/forms.body",
    "update_form_info": "https://www.googleapis.com/auth/forms.body",
    "get_form_responses": "https://www.googleapis.com/auth/forms.responses.readonly",
}


def _validate_account_id(account_id: str) -> None:
    if not account_id or not all(character.isalnum() or character in "-_" for character in account_id):
        raise ValueError("올바르지 않은 Google 계정 ID입니다.")


def _google_account_key(account_email: str) -> str:
    """이메일을 노출하지 않는 안정적인 Google 계정 식별 키."""
    return hashlib.sha256(account_email.strip().lower().encode("utf-8")).hexdigest()


def _token_document_id(account_email: str) -> str:
    if not account_email:
        raise ValueError("Google 계정 이메일이 없는 토큰은 저장할 수 없습니다.")
    return f"{_TOKEN_ES_KEY_PREFIX}{_google_account_key(account_email)}"


async def get_granted_scopes(account_id: str | None = None) -> set[str]:
    """현재 access token에 실제로 부여된 scope 목록을 반환한다.

    OAuth 요청 scope와 실제 승인 scope는 다를 수 있으므로, ES에는 Google
    tokeninfo로 확인한 ``granted_scopes``만 권한 판정용으로 사용한다.
    """
    account_id = account_id or await get_active_account_id()
    if not account_id:
        return set()
    token_data = await _load_token_from_es(account_id)
    if not token_data:
        return set()

    granted_scopes = token_data.get("granted_scopes")
    if isinstance(granted_scopes, list):
        return set(granted_scopes)
    return set()


# ── 토큰 저장/로드 (ES) ──────────────────────────────────────────────────


async def _save_token_to_es(account_id: str, token_data: dict) -> None:
    """OAuth2 토큰과 Kibana 조회용 비민감 권한 메타데이터를 ES에 저장한다."""
    _validate_account_id(account_id)
    account_email = token_data.get("account_email", "")
    document_id = _token_document_id(account_email)
    es = get_es()
    try:
        await es.index(
            index=SETTINGS_INDEX, id=document_id,
            document={
                "key": document_id,
                "value": token_data,
                # value는 인덱싱하지 않아 token을 보호한다. 아래 두 필드만 Kibana
                # 필터/집계용으로 노출한다.
                "google_granted_scopes": token_data.get("granted_scopes", []),
                "google_access_token_expires_at": token_data.get("expiry"),
                "google_account_key": _google_account_key(account_email),
                "google_account_slot_id": account_id,
            },
            refresh=True,
        )
    finally:
        await es.close()


async def _load_token_from_es(account_id: str) -> dict | None:
    """ES에서 OAuth2 토큰을 로드한다."""
    _validate_account_id(account_id)
    es = get_es()
    try:
        result = await es.search(
            index=SETTINGS_INDEX,
            size=1,
            query={"term": {"google_account_slot_id": account_id}},
            source=["value"],
        )
        hits = result.get("hits", {}).get("hits", [])
        if hits:
            return hits[0]["_source"].get("value")
    finally:
        await es.close()
    return None


async def _mark_reconnect_required(account_id: str) -> None:
    """갱신 불가 토큰을 재연결 필요 상태로 표시한다."""
    token_data = await _load_token_from_es(account_id)
    if not token_data:
        return
    token_data["auth_status"] = _RECONNECT_REQUIRED
    await _save_token_to_es(account_id, token_data)


async def _get_token_granted_scopes(access_token: str) -> set[str] | None:
    """Google access token으로 실제 승인된 OAuth scope를 조회한다.

    tokeninfo는 access token 자체를 검증하므로 클라이언트가 요청했던 scope나
    UI 상태가 아니라 현재 토큰의 권한을 기준으로 도구를 제한할 수 있다.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(_TOKEN_INFO_URL, params={"access_token": access_token})
        if response.is_error:
            logger.warning("[google] access token scope 조회 실패: HTTP %s", response.status_code)
            return None
        scope_value = response.json().get("scope", "")
        if not isinstance(scope_value, str):
            return None
        return set(scope_value.split())
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("[google] access token scope 조회 실패: %s", e)
        return None


# ── OAuth2 자격증명 관리 ──────────────────────────────────────────────────


def _select_active_account(config: dict | None) -> dict | None:
    if not config:
        return None
    accounts = config.get("accounts")
    if not isinstance(accounts, list):
        return None
    active_id = config.get("active_account_id")
    return next(
        (account for account in accounts if account.get("id") == active_id),
        accounts[0] if accounts else None,
    )


def _get_google_config() -> dict | None:
    """MCP config에서 google_workspace 서버의 config를 동기로 가져온다.
    (startup / auth 시점에만 호출 — 이벤트 루프 밖에서도 쓸 수 있도록 동기 ES 접근.)

    enabled는 채팅 MCP 도구 노출 여부일 뿐이다. 직접 Google Workspace UI와
    알림 수집도 이 설정을 사용하므로 비활성 서버의 계정 설정도 반환한다.
    """
    # 비동기 함수를 호출해야 하므로 loop에서 실행
    loop = asyncio.get_event_loop()
    if loop.is_running():
        with concurrent.futures.ThreadPoolExecutor() as pool:
            servers = pool.submit(asyncio.run, list_servers()).result()
    else:
        servers = loop.run_until_complete(list_servers())
    for s in servers:
        if s.get("type") == "google_workspace":
            return _select_active_account(s.get("config") or {})
    return None


async def _get_google_config_async() -> dict | None:
    for s in await list_servers():
        if s.get("type") == "google_workspace":
            return _select_active_account(s.get("config") or {})
    return None


async def get_active_account_id() -> str | None:
    account = await _get_google_config_async()
    return account.get("id") if account else None


def _parse_client_credentials(gauth_json: str | dict) -> tuple[str, str, str]:
    """gauth_json에서 client_id, client_secret, redirect_uri 추출."""
    data = json.loads(gauth_json) if isinstance(gauth_json, str) else gauth_json
    inner = data.get("installed") or data.get("web") or data
    client_id = inner.get("client_id", "")
    client_secret = inner.get("client_secret", "")
    redirect_uris = inner.get("redirect_uris", [])
    redirect_uri = redirect_uris[0] if redirect_uris else "http://localhost"
    return client_id, client_secret, redirect_uri


async def get_credentials(force_refresh: bool = False, account_id: str | None = None):
    """유효한 google.oauth2.credentials.Credentials를 반환한다.
    토큰이 만료됐거나 강제 갱신이 요청되면 refresh 후 ES에 저장.
    """
    account_id = account_id or await get_active_account_id()
    if not account_id:
        return None
    token_data = await _load_token_from_es(account_id)
    if not token_data:
        return None
    if token_data.get("auth_status") == _RECONNECT_REQUIRED and not force_refresh:
        return None

    expiry = _parse_expiry(token_data.get("expiry"))
    creds = Credentials(
        token=token_data.get("token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=token_data.get("client_id"),
        client_secret=token_data.get("client_secret"),
        scopes=token_data.get("scopes", SCOPES),
        expiry=expiry,
    )
    # 기존 저장 토큰에 expiry가 없으면 한 번 refresh해서 만료 시각을 보완한다.
    if force_refresh or creds.expired or expiry is None:
        if not creds.refresh_token:
            await _mark_reconnect_required(account_id)
            return None
        try:
            # google-auth의 refresh는 동기 HTTP 호출이다. async 이벤트 루프에서 직접
            # 실행하면 갱신이 끝날 때까지 다른 로컬 API까지 모두 멈추므로 스레드로 넘긴다.
            await asyncio.to_thread(creds.refresh, Request())
            granted_scopes = await _get_token_granted_scopes(creds.token)
            # 새 access token을 검증하지 못하면 이전 권한을 추정하지 않는다.
            refreshed_token_data = _creds_to_dict(creds, granted_scopes or set())
            refreshed_token_data["account_email"] = token_data["account_email"]
            await _save_token_to_es(account_id, refreshed_token_data)
        except Exception as e:
            logger.warning("[google] access token 갱신 실패 — 재연결 필요: %s", e)
            await _mark_reconnect_required(account_id)
            return None

    return creds


def _parse_expiry(value: object) -> datetime | None:
    """ES에 저장한 ISO 8601 만료 시각을 Credentials용 datetime으로 복원한다."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        logger.warning("[google] 저장된 token expiry 형식이 올바르지 않습니다.")
        return None


def _creds_to_dict(creds, granted_scopes: set[str] | None = None) -> dict:
    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes) if creds.scopes else SCOPES,
        # Kibana에서 date 필드로 인식할 수 있는 ISO 8601 UTC 시각이다.
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }
    if granted_scopes is not None:
        token_data["granted_scopes"] = sorted(granted_scopes)
    return token_data


OAUTH_REDIRECT_URI = "http://localhost:8000/api/mcp/google/oauth-redirect"

# OAuth state별 임시 인증 정보. 콜백 완료 또는 앱 재시작 시 폐기된다.
_pending_oauth_flows: dict[str, dict] = {}


def _build_flow(gauth_json: str | dict):
    """OAuth2 Flow 객체를 생성한다."""
    client_id, client_secret, _ = _parse_client_credentials(gauth_json)
    return Flow.from_client_config(
        {
            "installed": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [OAUTH_REDIRECT_URI],
            }
        },
        scopes=SCOPES,
        redirect_uri=OAUTH_REDIRECT_URI,
    )


async def start_oauth_flow(account_id: str, gauth_json: str | dict) -> str:
    """OAuth2 인증 URL을 생성해 반환한다."""
    flow = _build_flow(gauth_json)
    auth_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
    )
    _pending_oauth_flows[state] = {
        "account_id": account_id,
        "gauth_json": gauth_json,
        "code_verifier": flow.code_verifier,
    }
    return auth_url


async def exchange_oauth_code(code: str, state: str) -> bool:
    """인증 코드를 토큰으로 교환하고 ES에 저장한다."""
    pending = _pending_oauth_flows.pop(state, None)
    if not pending:
        raise ValueError("만료되었거나 올바르지 않은 OAuth 요청입니다.")
    flow = _build_flow(pending["gauth_json"])
    flow.code_verifier = pending["code_verifier"]
    flow.fetch_token(code=code)
    creds = flow.credentials
    granted_scopes = await _get_token_granted_scopes(creds.token)
    if granted_scopes is None:
        # access token 검증이 실패하면 안전하게 권한 없는 상태로 저장한다.
        granted_scopes = set()
    token_data = _creds_to_dict(creds, granted_scopes)
    try:
        gmail_service = await asyncio.to_thread(
            build, "gmail", "v1", credentials=creds, cache_discovery=False
        )
        profile = await asyncio.to_thread(
            gmail_service.users().getProfile(userId="me").execute
        )
        account_email = profile.get("emailAddress", "").strip()
        if not account_email:
            raise RuntimeError("Google 계정 이메일 응답이 비어 있습니다.")
        token_data["account_email"] = account_email
    except Exception as exc:
        raise RuntimeError("연결된 Google 계정 이메일을 확인할 수 없습니다.") from exc
    await _save_token_to_es(pending["account_id"], token_data)
    logger.info("[google] OAuth 토큰 및 승인 scope %d개 저장 완료", len(granted_scopes))
    return True


async def check_auth_status(account_id: str | None = None) -> bool:
    """인증 상태 확인 — 유효한 토큰이 있는지."""
    creds = await get_credentials(account_id=account_id)
    return creds is not None and creds.valid


async def get_auth_status() -> dict:
    """UI용 Google 연결 상태.

    MCP 활성화 여부는 도구 노출만 제어하며 저장된 OAuth 연결 상태와는 무관하다.
    따라서 비활성화된 Google Workspace 설정의 계정도 상태 응답에 포함한다.

    초기 설정 중에는 UI가 이 엔드포인트를 조회하는 시점보다 Elasticsearch
    설치/기동이 늦을 수 있다. 그 경우는 인증되지 않은 상태로 응답하고,
    Elasticsearch가 준비된 뒤 다음 조회에서 실제 상태를 반환한다.
    """
    try:
        config = None
        for server in await list_servers():
            if server.get("type") == "google_workspace":
                config = server.get("config") or {}
                break
        accounts = config.get("accounts", []) if config else []
        statuses = []
        for account in accounts:
            account_id = account.get("id")
            if not account_id:
                continue
            token_data = await _load_token_from_es(account_id)
            authenticated = await check_auth_status(account_id)
            statuses.append({
                "id": account_id,
                "email": token_data.get("account_email", "") if token_data else "",
                "authenticated": authenticated,
                "reconnect_required": not authenticated and bool(token_data),
            })
        active_id = config.get("active_account_id") if config else None
        authenticated = any(
            status["id"] == active_id and status["authenticated"] for status in statuses
        )
    except ElasticsearchConnectionError as exc:
        logger.debug("[google] Elasticsearch 준비 전 인증 상태 조회: %s", exc)
        return {
            "authenticated": False,
            "reconnect_required": False,
            "accounts": [],
        }
    return {
        "authenticated": authenticated,
        "reconnect_required": any(status["reconnect_required"] for status in statuses),
        "accounts": statuses,
    }


async def revoke_token(account_id: str) -> None:
    """OAuth 토큰을 ES에서 삭제한다 (연결 해제)."""
    _validate_account_id(account_id)
    es = get_es()
    try:
        await es.delete_by_query(
            index=SETTINGS_INDEX,
            query={"term": {"google_account_slot_id": account_id}},
            conflicts="proceed",
            refresh=True,
        )
    finally:
        await es.close()
    logger.info("[google] OAuth 토큰 삭제 완료 (연결 해제)")


async def revoke_all_tokens() -> None:
    """Google Workspace 연동에 속한 모든 계정 토큰을 삭제한다."""
    es = get_es()
    try:
        result = await es.delete_by_query(
            index=SETTINGS_INDEX,
            query={"prefix": {"key": "google_workspace_token"}},
            conflicts="proceed",
            refresh=True,
        )
    finally:
        await es.close()
    logger.info(
        "[google] Google Workspace OAuth 토큰 전체 삭제 완료: %d개",
        result.get("deleted", 0),
    )


# ── Google API 서비스 빌더 ─────────────────────────────────────────────


async def _build_service(
    service_name: str,
    version: str,
    force_refresh: bool = False,
    account_id: str | None = None,
):
    """google API 서비스 객체를 빌드한다."""
    creds = await get_credentials(force_refresh=force_refresh, account_id=account_id)
    if not creds:
        raise RuntimeError("Google 인증이 필요합니다. 설정에서 연결해주세요.")
    # googleapiclient.discovery.build()는 동기 I/O를 수행할 수 있으므로
    # 이벤트 루프에서 직접 호출하지 않는다. 백그라운드 알람 수집 중에도
    # 다른 FastAPI 요청이 지연되지 않도록 작업 스레드에서 생성한다.
    return await asyncio.to_thread(
        build,
        service_name,
        version,
        credentials=creds,
        cache_discovery=False,
    )
