"""Tool 정의 및 등록."""
from typing import Any

from logger import get_logger
from .auth import _TOOL_SCOPE_MAP
from .gmail import (
    search_emails, get_email, create_email_draft, send_email,
    reply_email, trash_email, batch_trash_emails,
)
from .calendar import (
    list_upcoming_events, search_calendar_events, list_calendars,
    check_free_busy, get_calendar_event, create_calendar_event,
    update_calendar_event, delete_calendar_event,
)
from .drive import (
    search_drive_files, get_drive_file, read_document_content,
    list_drive_folder_items, upload_drive_file, download_drive_file,
    create_drive_file, update_drive_file,
    delete_drive_file, move_drive_file, create_drive_folder,
)
from .docs import (
    create_google_doc, get_google_doc, append_to_google_doc, update_google_doc,
)
from .sheets import (
    create_google_sheet, get_google_sheet, update_google_sheet,
    append_to_google_sheet, clear_google_sheet,
)
from .slides import (
    create_google_slides, get_google_slides, add_slide,
    update_slide_text, delete_slide,
)
from .forms import (
    create_google_form, get_google_form, add_form_question,
    get_form_responses, update_form_info,
)

logger = get_logger(__name__)

# ── Tool 등록 ──────────────────────────────────────────────────────────
_TOOL_DEFS: list[tuple[str, str, dict, Any]] = [
    # (name, description, parameters_schema, handler)

    # Gmail
    ("search_emails",
     "Gmail 이메일 검색. 보낸 사람, 제목, 키워드, 날짜 조건으로 이메일 목록을 찾을 때 사용합니다. 결과의 message_id로 get_email 또는 reply_email을 호출할 수 있습니다.",
     {
         "type": "object",
         "properties": {
             "query": {
                 "type": "string",
                 "description": "Gmail 검색 조건(Gmail query syntax). 주요 연산자: is:read(읽은 메일), is:unread(안 읽은 메일), is:sent(보낸 메일), in:inbox(받은편지함), from:, to:, subject:, has:attachment, newer_than:7d, older_than:30d. 사용자가 '읽은 메일'이면 is:read, '안 읽은 메일'이면 is:unread, '메일 전체/모든 메일'처럼 읽음 여부를 구분하지 않으면 is:read/is:unread를 붙이지 않는다. 조합 예: 'is:read -from:me'(읽은 수신 메일), 'in:inbox'(받은편지함 전체), 'from:user@example.com'(특정 발신자 전체)."
             },
             "max_results": {
                 "type": "integer",
                 "description": "반환할 이메일 개수 (기본 10)",
                 "default": 10
             },
         },
         "required": ["query"],
     }, search_emails),

    ("get_email", "Gmail 이메일 상세 조회. search_emails에서 받은 message_id로 메일 본문과 상세 정보를 확인할 때 사용합니다.", {
        "type": "object",
        "properties": {
            "message_id": {"type": "string", "description": "search_emails 결과의 message_id"},
        },
        "required": ["message_id"],
    }, get_email),

    ("create_email_draft", "Gmail 이메일 초안 생성. 실제 발송하지 않고 검토용 초안을 만듭니다.", {
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "수신자 이메일"},
            "subject": {"type": "string", "description": "제목"},
            "body": {"type": "string", "description": "본문"},
            "attachments": {"type": "string", "description": "첨부파일명 (쉼표 구분). 사용자가 업로드한 파일명을 그대로 전달합니다. 첨부 없으면 생략."},
        },
        "required": ["to", "subject", "body"],
    }, create_email_draft),

    ("send_email", "Gmail 이메일 실제 발송. 사용자가 전송을 요청한 경우만 사용합니다.", {
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "수신자 이메일"},
            "subject": {"type": "string", "description": "제목"},
            "body": {"type": "string", "description": "본문"},
            "attachments": {"type": "string", "description": "첨부파일명 (쉼표 구분). 사용자가 업로드한 파일명을 그대로 전달합니다. 첨부 없으면 생략."},
        },
        "required": ["to", "subject", "body"],
    }, send_email),

    ("reply_email", "Gmail 이메일 답장. message_id와 답장 내용을 사용합니다.", {
        "type": "object",
        "properties": {
            "message_id": {"type": "string",
                           "description": "Gmail API message.id 값만 입력하세요. 설명, 괄호, 문장 없이 ID 문자열만 전달합니다."},
            "body": {"type": "string", "description": "답장 본문"},
            "attachments": {"type": "string", "description": "첨부파일명 (쉼표 구분). 사용자가 업로드한 파일명을 그대로 전달합니다. 첨부 없으면 생략."},
        },
        "required": ["message_id", "body"],
    }, reply_email),

    ("trash_email", "Gmail 이메일을 휴지통으로 이동 (삭제)", {
        "type": "object",
        "properties": {
            "message_id": {"type": "string", "description": "메시지 ID"},
        },
        "required": ["message_id"],
    }, trash_email),

    ("batch_trash_emails", "Gmail 검색 조건에 맞는 이메일 일괄 삭제 (휴지통 이동)", {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Gmail 검색 쿼리 (예: 'is:unread older_than:30d')"},
            "max_results": {"type": "integer", "description": "최대 처리 건수 (기본 50)", "default": 50},
        },
        "required": ["query"],
    }, batch_trash_emails),

    # Calendar
    ("list_upcoming_events", "Google Calendar 다가오는 일정 조회", {
        "type": "object",
        "properties": {
            "max_results": {"type": "integer", "description": "최대 결과 수", "default": 10},
            "calendar_id": {"type": "string", "description": "캘린더 ID (기본: primary)", "default": "primary"},
        },
    }, list_upcoming_events),

    ("search_calendar_events", "Google Calendar 일정 검색", {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "검색어"},
            "max_results": {"type": "integer", "description": "최대 결과 수", "default": 10},
            "calendar_id": {"type": "string", "description": "캘린더 ID", "default": "primary"},
            "time_min": {"type": "string", "description": "검색 시작 시간 (ISO 8601)"},
            "time_max": {"type": "string", "description": "검색 종료 시간 (ISO 8601)"},
        },
    }, search_calendar_events),

    ("list_calendars", "Google Calendar 목록 조회", {
        "type": "object", "properties": {},
    }, list_calendars),

    ("check_free_busy", "Google Calendar 빈 시간 확인", {
        "type": "object",
        "properties": {
            "time_min": {"type": "string", "description": "시작 시간 (ISO 8601)"},
            "time_max": {"type": "string", "description": "종료 시간 (ISO 8601)"},
            "calendar_ids": {"type": "string", "description": "캘린더 ID (쉼표 구분)", "default": "primary"},
        },
        "required": ["time_min", "time_max"],
    }, check_free_busy),

    ("get_calendar_event", "Google Calendar 일정 상세 조회", {
        "type": "object",
        "properties": {
            "event_id": {"type": "string", "description": "이벤트 ID"},
            "calendar_id": {"type": "string", "description": "캘린더 ID", "default": "primary"},
        },
        "required": ["event_id"],
    }, get_calendar_event),

    ("create_calendar_event", "Google Calendar 일정 생성", {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "일정 제목"},
            "start": {"type": "string", "description": "시작 시간 (ISO 8601 또는 날짜)"},
            "end": {"type": "string", "description": "종료 시간 (ISO 8601 또는 날짜)"},
            "description": {"type": "string", "description": "설명"},
            "location": {"type": "string", "description": "장소"},
            "calendar_id": {"type": "string", "description": "캘린더 ID", "default": "primary"},
            "timezone": {"type": "string", "description": "타임존", "default": "Asia/Seoul"},
        },
        "required": ["summary", "start", "end"],
    }, create_calendar_event),

    ("update_calendar_event", "Google Calendar 일정 수정", {
        "type": "object",
        "properties": {
            "event_id": {"type": "string", "description": "이벤트 ID"},
            "calendar_id": {"type": "string", "description": "캘린더 ID", "default": "primary"},
            "summary": {"type": "string", "description": "제목"},
            "start": {"type": "string", "description": "시작 시간"},
            "end": {"type": "string", "description": "종료 시간"},
            "description": {"type": "string", "description": "설명"},
            "location": {"type": "string", "description": "장소"},
            "timezone": {"type": "string", "description": "타임존", "default": "Asia/Seoul"},
        },
        "required": ["event_id"],
    }, update_calendar_event),

    ("delete_calendar_event", "Google Calendar 일정 삭제", {
        "type": "object",
        "properties": {
            "event_id": {"type": "string", "description": "이벤트 ID"},
            "calendar_id": {"type": "string", "description": "캘린더 ID", "default": "primary"},
        },
        "required": ["event_id"],
    }, delete_calendar_event),

    # Drive
    ("search_files", "Google Drive 파일 검색", {
        "type": "object",
        "properties": {
            "query": {"type": "string",
                      "description": "파일명 또는 검색 키워드. 필요하면 Google Drive 검색 조건(name contains, mimeType 등)을 직접 입력할 수 있음"},
            "max_results": {"type": "integer", "description": "최대 결과 수", "default": 10},
        },
    }, search_drive_files),

    ("get_drive_file", "Google Drive 파일 상세 조회", {
        "type": "object",
        "properties": {
            "file_id": {"type": "string", "description": "파일 ID"},
        },
        "required": ["file_id"],
    }, get_drive_file),

    ("read_document_content", "Google Drive 문서 내용 읽기 (Docs/Sheets)", {
        "type": "object",
        "properties": {
            "file_id": {"type": "string", "description": "파일 ID"},
        },
        "required": ["file_id"],
    }, read_document_content),

    ("list_drive_folder_items", "Google Drive 폴더 내용 목록", {
        "type": "object",
        "properties": {
            "folder_id": {"type": "string", "description": "폴더 ID (기본: root)", "default": "root"},
            "max_results": {"type": "integer", "description": "최대 결과 수", "default": 20},
        },
    }, list_drive_folder_items),

    ("upload_drive_file", "로컬 업로드 파일을 Google Drive에 업로드", {
        "type": "object",
        "properties": {
            "attachments": {"type": "string", "description": "업로드할 파일명 (쉼표 구분, saved_name 사용)"},
            "folder_id": {"type": "string", "description": "업로드할 폴더 ID (생략 시 루트)"},
            "sharing": {"type": "string", "description": "공유 설정: private(비공개), anyone_view(링크 보기), anyone_edit(링크 편집)", "default": "private", "enum": ["private", "anyone_view", "anyone_edit"]},
        },
        "required": ["attachments"],
    }, upload_drive_file),

    ("download_drive_file", "Google Drive 파일을 사용자의 다운로드 폴더에 저장", {
        "type": "object",
        "properties": {
            "file_id": {"type": "string", "description": "다운로드할 파일 ID"},
        },
        "required": ["file_id"],
    }, download_drive_file),

    ("create_drive_file", "Google Drive에 새 텍스트 파일 생성", {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "파일 이름 (예: 'report.txt')"},
            "content": {"type": "string", "description": "파일 내용"},
            "mime_type": {"type": "string", "description": "MIME 타입 (기본: text/plain)", "default": "text/plain"},
            "folder_id": {"type": "string", "description": "생성할 폴더 ID (생략 시 루트)"},
        },
        "required": ["name"],
    }, create_drive_file),

    ("update_drive_file", "Google Drive 파일 내용 업데이트", {
        "type": "object",
        "properties": {
            "file_id": {"type": "string", "description": "파일 ID"},
            "content": {"type": "string", "description": "새 파일 내용"},
        },
        "required": ["file_id", "content"],
    }, update_drive_file),

    ("delete_drive_file", "Google Drive 파일을 휴지통으로 이동", {
        "type": "object",
        "properties": {
            "file_id": {"type": "string", "description": "파일 ID"},
        },
        "required": ["file_id"],
    }, delete_drive_file),

    ("move_drive_file", "Google Drive 파일을 다른 폴더로 이동", {
        "type": "object",
        "properties": {
            "file_id": {"type": "string", "description": "파일 ID"},
            "target_folder_id": {"type": "string", "description": "대상 폴더 ID"},
        },
        "required": ["file_id", "target_folder_id"],
    }, move_drive_file),

    ("create_drive_folder", "Google Drive에 새 폴더 생성", {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "폴더 이름"},
            "parent_folder_id": {"type": "string", "description": "부모 폴더 ID (생략 시 루트)"},
        },
        "required": ["name"],
    }, create_drive_folder),

    # Google Docs
    ("create_google_doc", "새 Google Docs 문서 생성", {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "문서 제목"},
            "content": {"type": "string", "description": "초기 본문 내용"},
            "folder_id": {"type": "string", "description": "생성할 폴더 ID (생략 시 루트)"},
        },
        "required": ["title"],
    }, create_google_doc),

    ("get_google_doc", "Google Docs 문서 내용 읽기", {
        "type": "object",
        "properties": {
            "document_id": {"type": "string", "description": "문서 ID"},
        },
        "required": ["document_id"],
    }, get_google_doc),

    ("append_to_google_doc", "Google Docs 문서 끝에 텍스트 추가", {
        "type": "object",
        "properties": {
            "document_id": {"type": "string", "description": "문서 ID"},
            "text": {"type": "string", "description": "추가할 텍스트"},
        },
        "required": ["document_id", "text"],
    }, append_to_google_doc),

    ("update_google_doc", "Google Docs 문서에서 텍스트 찾아 바꾸기", {
        "type": "object",
        "properties": {
            "document_id": {"type": "string", "description": "문서 ID"},
            "find": {"type": "string", "description": "찾을 텍스트"},
            "replace": {"type": "string", "description": "바꿀 텍스트"},
        },
        "required": ["document_id", "find"],
    }, update_google_doc),

    # Google Sheets
    ("create_google_sheet", "새 Google Sheets 스프레드시트 생성", {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "스프레드시트 제목"},
            "sheet_names": {"type": "string", "description": "시트 이름들 (쉼표 구분, 생략 시 기본 시트)"},
            "folder_id": {"type": "string", "description": "생성할 폴더 ID (생략 시 루트)"},
        },
        "required": ["title"],
    }, create_google_sheet),

    ("get_google_sheet", "Google Sheets 데이터 읽기. range 지정 시 셀 데이터, 미지정 시 시트 정보 반환", {
        "type": "object",
        "properties": {
            "spreadsheet_id": {"type": "string", "description": "스프레드시트 ID"},
            "range": {"type": "string", "description": "셀 범위 (예: 'Sheet1!A1:D10'). 생략 시 시트 목록 반환"},
        },
        "required": ["spreadsheet_id"],
    }, get_google_sheet),

    ("update_google_sheet", "Google Sheets 셀 데이터 업데이트", {
        "type": "object",
        "properties": {
            "spreadsheet_id": {"type": "string", "description": "스프레드시트 ID"},
            "range": {"type": "string", "description": "셀 범위 (예: 'Sheet1!A1:B2')"},
            "values": {"type": "string", "description": "JSON 2차원 배열 (예: [[\"이름\",\"나이\"],[\"홍길동\",30]])"},
        },
        "required": ["spreadsheet_id", "range", "values"],
    }, update_google_sheet),

    ("append_to_google_sheet", "Google Sheets에 행 추가", {
        "type": "object",
        "properties": {
            "spreadsheet_id": {"type": "string", "description": "스프레드시트 ID"},
            "range": {"type": "string", "description": "추가할 범위 (예: 'Sheet1!A:D')"},
            "values": {"type": "string", "description": "JSON 2차원 배열 (예: [[\"데이터1\",\"데이터2\"]])"},
        },
        "required": ["spreadsheet_id", "range", "values"],
    }, append_to_google_sheet),

    ("clear_google_sheet", "Google Sheets 범위 데이터 삭제", {
        "type": "object",
        "properties": {
            "spreadsheet_id": {"type": "string", "description": "스프레드시트 ID"},
            "range": {"type": "string", "description": "삭제할 범위 (예: 'Sheet1!A1:Z100')"},
        },
        "required": ["spreadsheet_id", "range"],
    }, clear_google_sheet),

    # Google Slides
    ("create_google_slides", "새 Google Slides 프레젠테이션 생성", {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "프레젠테이션 제목"},
            "folder_id": {"type": "string", "description": "생성할 폴더 ID (생략 시 루트)"},
        },
        "required": ["title"],
    }, create_google_slides),

    ("get_google_slides", "Google Slides 프레젠테이션 정보 및 슬라이드 내용 읽기", {
        "type": "object",
        "properties": {
            "presentation_id": {"type": "string", "description": "프레젠테이션 ID"},
        },
        "required": ["presentation_id"],
    }, get_google_slides),

    ("add_slide", "Google Slides에 새 슬라이드 추가", {
        "type": "object",
        "properties": {
            "presentation_id": {"type": "string", "description": "프레젠테이션 ID"},
            "layout": {"type": "string", "description": "레이아웃 (BLANK, TITLE, TITLE_AND_BODY 등)", "default": "BLANK"},
            "title_text": {"type": "string", "description": "제목 텍스트"},
            "body_text": {"type": "string", "description": "본문 텍스트"},
        },
        "required": ["presentation_id"],
    }, add_slide),

    ("update_slide_text", "Google Slides에서 텍스트 찾아 바꾸기", {
        "type": "object",
        "properties": {
            "presentation_id": {"type": "string", "description": "프레젠테이션 ID"},
            "find": {"type": "string", "description": "찾을 텍스트"},
            "replace": {"type": "string", "description": "바꿀 텍스트"},
        },
        "required": ["presentation_id", "find"],
    }, update_slide_text),

    ("delete_slide", "Google Slides에서 슬라이드 삭제", {
        "type": "object",
        "properties": {
            "presentation_id": {"type": "string", "description": "프레젠테이션 ID"},
            "slide_id": {"type": "string", "description": "삭제할 슬라이드 objectId"},
        },
        "required": ["presentation_id", "slide_id"],
    }, delete_slide),

    # Google Forms
    ("create_google_form", "새 Google Forms 설문지 생성", {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "설문지 제목"},
            "document_title": {"type": "string", "description": "파일 이름 (생략 시 title과 동일)"},
        },
        "required": ["title"],
    }, create_google_form),

    ("get_google_form", "Google Forms 설문지 정보 및 질문 읽기", {
        "type": "object",
        "properties": {
            "form_id": {"type": "string", "description": "설문지 ID"},
        },
        "required": ["form_id"],
    }, get_google_form),

    ("add_form_question", "Google Forms에 질문 추가", {
        "type": "object",
        "properties": {
            "form_id": {"type": "string", "description": "설문지 ID"},
            "title": {"type": "string", "description": "질문 제목"},
            "question_type": {"type": "string", "description": "유형: TEXT, PARAGRAPH, RADIO, CHECKBOX, DROP_DOWN, SCALE", "default": "TEXT"},
            "options": {"type": "string", "description": "선택지 (쉼표 구분, RADIO/CHECKBOX/DROP_DOWN에 필요)"},
            "required": {"type": "boolean", "description": "필수 여부", "default": False},
        },
        "required": ["form_id", "title"],
    }, add_form_question),

    ("get_form_responses", "Google Forms 설문 응답 조회", {
        "type": "object",
        "properties": {
            "form_id": {"type": "string", "description": "설문지 ID"},
            "max_results": {"type": "integer", "description": "최대 결과 수", "default": 50},
        },
        "required": ["form_id"],
    }, get_form_responses),

    ("update_form_info", "Google Forms 설문지 제목/설명 수정", {
        "type": "object",
        "properties": {
            "form_id": {"type": "string", "description": "설문지 ID"},
            "title": {"type": "string", "description": "새 제목"},
            "description": {"type": "string", "description": "새 설명"},
        },
        "required": ["form_id"],
    }, update_form_info),
]


def register_google_workspace_tools(mgr, granted_scopes: set[str] | None = None) -> None:
    """MCPManager에 Google Workspace internal tool들을 등록한다.
    granted_scopes가 주어지면, 해당 scope에 매칭되는 tool만 등록한다.
    """
    registered = 0
    for name, desc, params, handler in _TOOL_DEFS:
        if granted_scopes is not None:
            required_scope = _TOOL_SCOPE_MAP.get(name)
            if required_scope and required_scope not in granted_scopes:
                continue
        mgr.register_internal_tool(
            name, desc, params, handler,
            server_type="google_workspace",
        )
        registered += 1
    logger.info(
        "[google] Registered %d/%d Google Workspace internal tools (scope filtered)",
        registered,
        len(_TOOL_DEFS),
    )
