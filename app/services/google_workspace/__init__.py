"""
services/google_workspace — Google Workspace 직접 API 호출 (Gmail/Calendar/Drive)

기존 npx mcp-google-workspace (stdio MCP)를 대체한다.
OAuth2 토큰은 ES에 저장/복원하며, google-api-python-client로 직접 호출한다.

register_google_workspace_tools(mgr) 를 main.py에서 호출해
internal tool로 등록한다.
"""
from .auth import (
    get_auth_status,
    get_granted_scopes,
    get_credentials,
    start_oauth_flow,
    exchange_oauth_code,
    check_auth_status,
    revoke_token,
    revoke_all_tokens,
)
from .tools import register_google_workspace_tools

__all__ = [
    "register_google_workspace_tools",
    "get_auth_status",
    "get_granted_scopes",
    "start_oauth_flow",
    "exchange_oauth_code",
    "check_auth_status",
    "revoke_token",
    "revoke_all_tokens",
    "get_credentials",
]
