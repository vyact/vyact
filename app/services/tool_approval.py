"""Interactive approval gate for state-changing tool calls."""
import asyncio
import uuid
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Awaitable, Callable


ApprovalEmitter = Callable[[dict], Awaitable[None]]
APPROVAL_MODES = {"always_confirm", "risky_only", "trusted"}

READ_ONLY_TOOLS = {
    "code_list_directory", "code_read_file", "code_read_files", "code_find_files",
    "code_grep_search", "code_list_tasks", "code_git_status", "code_git_diff",
    "get_email", "list_upcoming_events", "search_calendar_events", "list_calendars",
    "check_free_busy", "get_calendar_event", "search_files", "get_drive_file",
    "read_document_content", "list_drive_folder_items", "get_google_doc",
    "get_google_sheet", "get_google_slides", "get_google_form", "get_form_responses",
    "browser_search", "browser_open", "browser_read", "browser_inspect",
    "browser_scroll", "browser_wait", "browser_back", "browser_status", "browser_close",
}
SENSITIVE_TOOLS = {
    "send_email", "reply_email", "create_calendar_event", "update_calendar_event",
    "upload_drive_file", "download_drive_file", "move_drive_file",
    "browser_click", "browser_type",
}
DESTRUCTIVE_TOOLS = {
    "code_move_file", "code_delete_file", "trash_email", "batch_trash_emails",
    "delete_calendar_event", "delete_drive_file", "clear_google_sheet", "delete_slide",
}


@dataclass(frozen=True)
class ApprovalContext:
    mode: str = "risky_only"
    conversation_id: str = ""
    project_id: str = ""
    interactive: bool = False


@dataclass
class PendingApproval:
    future: asyncio.Future[bool]
    tool_name: str
    arguments: dict


current_approval_context: ContextVar[ApprovalContext] = ContextVar(
    "current_approval_context", default=ApprovalContext(),
)
_pending_approvals: dict[str, PendingApproval] = {}

_REJECTION_RESPONSES = {
    "ko": "`{tool}` 실행 승인이 거부되어 요청한 작업을 수행하지 않았습니다.",
    "en": "Execution of `{tool}` was rejected, so the requested action was not performed.",
    "ja": "`{tool}` の実行承認が拒否されたため、要求された操作は実行されませんでした。",
    "zh": "`{tool}` 的执行审批已被拒绝，因此未执行请求的操作。",
    "es": "Se rechazó la ejecución de `{tool}`, por lo que no se realizó la acción solicitada.",
    "fr": "L’exécution de `{tool}` a été refusée ; l’action demandée n’a donc pas été effectuée.",
    "vi": "Việc thực thi `{tool}` đã bị từ chối nên thao tác được yêu cầu không được thực hiện.",
    "th": "การอนุมัติให้เรียกใช้ `{tool}` ถูกปฏิเสธ จึงไม่ได้ดำเนินการตามที่ร้องขอ",
}


def _base_tool_name(tool_name: str) -> str:
    return tool_name.split("__", 1)[-1]


async def get_tool_rejection_response(tool_name: str) -> str:
    """Return a deterministic, localized final response for a rejected tool call."""
    try:
        from routers.deps import load_ui_language_async
        language = (await load_ui_language_async() or "ko").split("-", 1)[0].lower()
    except Exception:
        language = "ko"
    template = _REJECTION_RESPONSES.get(language, _REJECTION_RESPONSES["en"])
    return template.format(tool=_base_tool_name(tool_name))


def get_tool_risk(tool_name: str) -> str:
    name = _base_tool_name(tool_name)
    if name in READ_ONLY_TOOLS or name.startswith(("get_", "list_", "search_", "read_", "check_")):
        return "read"
    if name in DESTRUCTIVE_TOOLS or name.startswith(("delete_", "trash_", "clear_")):
        return "destructive"
    if name in SENSITIVE_TOOLS or name.startswith(("send_", "reply_", "share_", "publish_")):
        return "sensitive"
    # MCP 도구는 서버마다 이름이 달라 사전에 모두 분류할 수 없다. 알 수 없는
    # 외부 도구는 보수적으로 민감 작업으로 취급하고, 자체 코드 도구만 일반 쓰기로 둔다.
    return "sensitive" if "__" in tool_name else "write"


def requires_approval(tool_name: str, mode: str) -> bool:
    risk = get_tool_risk(tool_name)
    normalized_mode = mode if mode in APPROVAL_MODES else "risky_only"
    if normalized_mode == "always_confirm":
        return risk != "read"
    if normalized_mode == "trusted":
        return risk == "destructive"
    return risk in {"sensitive", "destructive"}


async def await_tool_approval(tool_name: str, arguments: dict, emit: ApprovalEmitter) -> bool:
    context = current_approval_context.get()
    if not context.interactive or not requires_approval(tool_name, context.mode):
        return True
    approval_id = str(uuid.uuid4())
    future = asyncio.get_running_loop().create_future()
    _pending_approvals[approval_id] = PendingApproval(future, tool_name, arguments)
    await emit({
        "phase": "approval_required", "approval_id": approval_id,
        "name": tool_name, "args": arguments, "risk": get_tool_risk(tool_name),
        "conversation_id": context.conversation_id, "project_id": context.project_id,
    })
    try:
        return await asyncio.wait_for(future, timeout=300)
    except asyncio.TimeoutError:
        return False
    finally:
        _pending_approvals.pop(approval_id, None)


def resolve_tool_approval(approval_id: str, approved: bool) -> bool:
    pending = _pending_approvals.get(approval_id)
    if not pending or pending.future.done():
        return False
    pending.future.set_result(approved)
    return True
