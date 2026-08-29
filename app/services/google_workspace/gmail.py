"""Gmail API 도구."""
import base64
import html
import json
import mimetypes
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from email.utils import parseaddr
from pathlib import Path

from config import INSTALL_DIR
from logger import get_logger
from .auth import _build_service, _get_google_config_async

logger = get_logger(__name__)
GMAIL_TRASH_LABEL_ID = "TRASH"

# Keep mail-list responses small while retaining enough MIME metadata to identify
# attachments.  The nested parts cover the multipart structures Gmail commonly
# uses (mixed > alternative > related) without requesting message body data.
_MAIL_THREAD_SUMMARY_FIELDS = (
    "id,snippet,messages(id,threadId,labelIds,internalDate,snippet,"
    "payload(headers(name,value),"
    "parts(filename,mimeType,body(attachmentId),headers(name,value),"
    "parts(filename,mimeType,body(attachmentId),headers(name,value),"
    "parts(filename,mimeType,body(attachmentId),headers(name,value),"
    "parts(filename,mimeType,body(attachmentId),headers(name,value)))))))"
)

# 첨부파일 검색 경로 (INSTALL_DIR 기준)
_INSTALL_DIR = INSTALL_DIR
_ATTACHMENT_DIRS = [
    _INSTALL_DIR / "uploads" / "files",
    _INSTALL_DIR / "uploads" / "images",
]


def _metadata_headers(message: dict) -> dict[str, str]:
    return {
        header.get("name", "").strip().lower(): header.get("value", "")
        for header in message.get("payload", {}).get("headers", [])
        if header.get("name")
    }


def _decode_mail_snippet(value: str) -> str:
    """Decode HTML entities returned in Gmail list snippets for plain-text UI rendering."""
    return html.unescape(value or "")


def _walk_mime_parts(part: dict):
    yield part
    for child in part.get("parts", []):
        yield from _walk_mime_parts(child)


def _message_has_attachments(message: dict) -> bool:
    """Return whether a message has a downloadable, non-inline attachment."""
    for part in _walk_mime_parts(message.get("payload", {})):
        filename = part.get("filename", "")
        attachment_id = part.get("body", {}).get("attachmentId")
        headers = {
            header.get("name", "").lower(): header.get("value", "")
            for header in part.get("headers", [])
        }
        is_inline_image = (
            part.get("mimeType", "").startswith("image/")
            and (
                headers.get("content-disposition", "").lower().startswith("inline")
                or bool(headers.get("content-id"))
            )
        )
        if filename and attachment_id and not is_inline_image:
            return True
    return False


def _get_mail_thread_summary(service, thread_id: str):
    return service.users().threads().get(
        userId="me",
        id=thread_id,
        format="full",
        fields=_MAIL_THREAD_SUMMARY_FIELDS,
    )


def list_mail_messages_sync(
    service,
    label: str = "INBOX",
    query: str = "",
    page_token: str = "",
    max_results: int = 30,
) -> dict:
    """Fetch Gmail summaries and their metadata in one batch request."""
    effective_query = query.strip()
    result = service.users().messages().list(
        userId="me",
        labelIds=[label] if label else None,
        q=effective_query or None,
        maxResults=max_results,
        **({"pageToken": page_token} if page_token else {}),
    ).execute()
    summaries = result.get("messages", [])
    metadata_by_id: dict[str, dict] = {}

    def collect_metadata(
        request_id: str,
        response: dict | None,
        exception: Exception | None,
    ) -> None:
        if exception is None and response:
            metadata_by_id[request_id] = response

    if summaries:
        try:
            batch = service.new_batch_http_request(callback=collect_metadata)
            for summary in summaries:
                message_id = summary["id"]
                batch.add(
                    service.users().messages().get(
                        userId="me",
                        id=message_id,
                        format="metadata",
                        metadataHeaders=["Subject", "From", "Date"],
                    ),
                    request_id=message_id,
                )
            batch.execute()
        except Exception:
            for summary in summaries:
                message_id = summary["id"]
                metadata_by_id[message_id] = service.users().messages().get(
                    userId="me",
                    id=message_id,
                    format="metadata",
                    metadataHeaders=["Subject", "From", "Date"],
                ).execute()

    messages = []
    for summary in summaries:
        message = metadata_by_id.get(summary["id"])
        if not message:
            continue
        headers = _metadata_headers(message)
        internal_date = message.get("internalDate")
        received_at = (
            datetime.fromtimestamp(int(internal_date) / 1000, timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
            if internal_date
            else headers.get("date", "")
        )
        messages.append({
            "id": message["id"],
            "threadId": message.get("threadId"),
            "from": headers.get("from", ""),
            "subject": headers.get("subject", ""),
            "date": headers.get("date", ""),
            "receivedAt": received_at,
            "snippet": _decode_mail_snippet(message.get("snippet", "")),
            "isUnread": "UNREAD" in message.get("labelIds", []),
            "isStarred": "STARRED" in message.get("labelIds", []),
        })

    return {
        "messages": messages,
        "nextPageToken": result.get("nextPageToken"),
    }


def _format_mail_threads(
    result: dict,
    threads_by_id: dict[str, dict],
    account_email: str,
    label: str,
) -> dict:
    summaries = result.get("threads", [])
    messages = []
    for summary in summaries:
        thread = threads_by_id.get(summary["id"])
        all_thread_messages = thread.get("messages", []) if thread else []
        thread_messages = [
            message
            for message in all_thread_messages
            if (
                GMAIL_TRASH_LABEL_ID in message.get("labelIds", [])
                if label == GMAIL_TRASH_LABEL_ID
                else GMAIL_TRASH_LABEL_ID not in message.get("labelIds", [])
            )
        ]
        if not thread_messages:
            continue
        latest_message = thread_messages[-1]
        action_message = next(
            (
                message
                for message in reversed(thread_messages)
                if not label or label in message.get("labelIds", [])
            ),
            latest_message,
        )
        thread_headers = [_metadata_headers(message) for message in thread_messages]
        latest_headers = thread_headers[-1]
        thread_subject = next(
            (headers["subject"].strip() for headers in thread_headers if headers.get("subject", "").strip()),
            "",
        )
        participants = []
        seen_participants = set()
        for headers in thread_headers:
            name, email = parseaddr(headers.get("from", ""))
            participant_key = email.strip().lower() or name.strip().lower()
            if not participant_key or participant_key in seen_participants:
                continue
            seen_participants.add(participant_key)
            participants.append({
                "name": name or email,
                "email": email,
                "isMe": bool(account_email and email.strip().lower() == account_email),
            })
        internal_date = latest_message.get("internalDate")
        received_at = (
            datetime.fromtimestamp(int(internal_date) / 1000, timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
            if internal_date
            else latest_headers.get("date", "")
        )
        messages.append({
            "id": action_message["id"],
            "threadId": thread["id"],
            "from": latest_headers.get("from", ""),
            "participants": participants,
            "messageCount": len(thread_messages),
            "subject": thread_subject,
            "date": latest_headers.get("date", ""),
            "receivedAt": received_at,
            "snippet": _decode_mail_snippet(
                latest_message.get("snippet", thread.get("snippet", ""))
            ),
            "isUnread": any(
                "UNREAD" in message.get("labelIds", [])
                for message in thread_messages
            ),
            "isStarred": any(
                "STARRED" in message.get("labelIds", [])
                for message in thread_messages
            ),
            "hasAttachments": any(
                _message_has_attachments(message)
                for message in thread_messages
            ),
            "labelIds": list(dict.fromkeys(
                label_id
                for message in thread_messages
                for label_id in message.get("labelIds", [])
            )),
        })

    return {
        "messages": messages,
        "nextPageToken": result.get("nextPageToken"),
    }


def list_mail_threads_sync(
    service,
    label: str = "INBOX",
    query: str = "",
    page_token: str = "",
    max_results: int = 30,
) -> dict:
    """Fetch Gmail conversations with summaries based on each thread's latest message."""
    effective_query = query.strip()
    result = service.users().threads().list(
        userId="me",
        labelIds=[label] if label else None,
        q=effective_query or None,
        maxResults=max_results,
        **({"pageToken": page_token} if page_token else {}),
    ).execute()
    summaries = result.get("threads", [])
    threads_by_id: dict[str, dict] = {}
    profile: dict = {}

    def collect_thread(
        request_id: str,
        response: dict | None,
        exception: Exception | None,
    ) -> None:
        if exception is None and response and request_id == "profile":
            profile.update(response)
        elif exception is None and response:
            threads_by_id[request_id] = response

    try:
        batch = service.new_batch_http_request(callback=collect_thread)
        if summaries:
            for summary in summaries:
                thread_id = summary["id"]
                batch.add(
                    _get_mail_thread_summary(service, thread_id),
                    request_id=thread_id,
                )
        batch.add(service.users().getProfile(userId="me"), request_id="profile")
        batch.execute()
    except Exception:
        for summary in summaries:
            thread_id = summary["id"]
            threads_by_id[thread_id] = _get_mail_thread_summary(service, thread_id).execute()
        profile.update(service.users().getProfile(userId="me").execute())

    account_email = (
        profile.get("emailAddress", "")
        .strip()
        .lower()
    )
    return _format_mail_threads(result, threads_by_id, account_email, label)


def load_mail_workspace_sync(
    service,
    label: str = "INBOX",
    query: str = "",
    max_results: int = 30,
) -> dict:
    """Load first-page threads and labels in two dependency-ordered batch requests."""
    effective_query = query.strip()
    labels: list[dict] = []
    thread_result: dict = {}

    def collect_list(
        request_id: str,
        response: dict | None,
        exception: Exception | None,
    ) -> None:
        if exception is not None or not response:
            return
        if request_id == "labels":
            labels.extend(response.get("labels", []))
        elif request_id == "threads":
            thread_result.update(response)

    try:
        list_batch = service.new_batch_http_request(callback=collect_list)
        list_batch.add(
            service.users().labels().list(userId="me"),
            request_id="labels",
        )
        list_batch.add(
            service.users().threads().list(
                userId="me",
                labelIds=[label] if label else None,
                q=effective_query or None,
                maxResults=max_results,
            ),
            request_id="threads",
        )
        list_batch.execute()
    except Exception:
        labels.extend(service.users().labels().list(userId="me").execute().get("labels", []))
        thread_result.update(service.users().threads().list(
            userId="me",
            labelIds=[label] if label else None,
            q=effective_query or None,
            maxResults=max_results,
        ).execute())

    summaries = thread_result.get("threads", [])
    unread_label_ids = {
        item["id"]
        for item in labels
        if item["id"] in {"INBOX", "SPAM"} or item.get("type", "user") == "user"
    }
    threads_by_id: dict[str, dict] = {}
    unread_counts: dict[str, int] = {}
    profile: dict = {}

    def collect_detail(
        request_id: str,
        response: dict | None,
        exception: Exception | None,
    ) -> None:
        if exception is not None or not response:
            return
        request_type, _, resource_id = request_id.partition(":")
        if request_type == "thread":
            threads_by_id[resource_id] = response
        elif request_type == "label":
            unread_counts[resource_id] = response.get("messagesUnread", 0)
        elif request_type == "profile":
            profile.update(response)

    try:
        batch = service.new_batch_http_request(callback=collect_detail)
        for summary in summaries:
            thread_id = summary["id"]
            batch.add(
                _get_mail_thread_summary(service, thread_id),
                request_id=f"thread:{thread_id}",
            )
        for label_id in unread_label_ids:
            batch.add(
                service.users().labels().get(userId="me", id=label_id),
                request_id=f"label:{label_id}",
            )
        batch.add(
            service.users().getProfile(userId="me"),
            request_id="profile:me",
        )
        batch.execute()
    except Exception:
        for summary in summaries:
            thread_id = summary["id"]
            threads_by_id[thread_id] = _get_mail_thread_summary(service, thread_id).execute()
        for label_id in unread_label_ids:
            label_detail = service.users().labels().get(userId="me", id=label_id).execute()
            unread_counts[label_id] = label_detail.get("messagesUnread", 0)
        profile.update(service.users().getProfile(userId="me").execute())

    mail_result = _format_mail_threads(
        thread_result,
        threads_by_id,
        profile.get("emailAddress", "").strip().lower(),
        label,
    )
    return {
        **mail_result,
        "labels": [
            {
                "id": item["id"],
                "name": item["name"],
                "type": item.get("type", "user"),
                "unreadCount": unread_counts.get(item["id"], 0),
            }
            for item in labels
        ],
    }


def _resolve_attachment_path(filename: str) -> Path | None:
    """파일명으로 첨부파일 경로를 찾는다. uploads → images 순서로 탐색.
    정확한 파일명 매칭을 먼저 시도하고, 없으면 uid_ 접두사가 붙은 파일도 탐색한다.
    """
    for d in _ATTACHMENT_DIRS:
        # 정확한 파일명 매칭
        path = d / filename
        if path.is_file():
            return path
    # uid_원본파일명 패턴으로 저장된 파일 탐색 (예: 4ff64703_전성종_프리랜서.pdf)
    for d in _ATTACHMENT_DIRS:
        if not d.is_dir():
            continue
        for f in d.iterdir():
            # uid(8자)_ 접두사 제거 후 원본 파일명과 비교
            if f.is_file() and len(f.name) > 9 and f.name[8] == "_" and f.name[9:] == filename:
                return f
    return None


def _build_message_with_attachments(body: str, attachment_filenames: list[str]) -> MIMEMultipart | MIMEText:
    """본문 + 첨부파일로 MIME 메시지를 구성한다. 첨부파일이 없으면 MIMEText 반환."""
    # 실제로 존재하는 파일만 필터
    resolved: list[tuple[str, Path]] = []
    for fn in attachment_filenames:
        path = _resolve_attachment_path(fn)
        if path:
            resolved.append((fn, path))
        else:
            logger.warning("[gmail] 첨부파일 없음: %s", fn)

    if not resolved:
        return MIMEText(body, "plain", "utf-8")

    msg = MIMEMultipart()
    msg.attach(MIMEText(body, "plain", "utf-8"))

    for original_name, path in resolved:
        content_type, _ = mimetypes.guess_type(str(path))
        if not content_type:
            content_type = "application/octet-stream"
        main_type, sub_type = content_type.split("/", 1)
        with open(path, "rb") as f:
            part = MIMEBase(main_type, sub_type)
            part.set_payload(f.read())
        encoders.encode_base64(part)
        # uid 접두사(8자_) 제거하여 원본 파일명으로 첨부
        display_name = original_name
        if len(display_name) > 9 and display_name[8] == "_":
            display_name = display_name[9:]
        part.add_header("Content-Disposition", "attachment", filename=display_name)
        msg.attach(part)

    return msg


async def search_emails(query: str = "", max_results: int = 10, **_) -> str:
    service = await _build_service("gmail", "v1")

    results = service.users().messages().list(
        userId="me",
        q=query,
        maxResults=max_results
    ).execute()

    messages = results.get("messages", [])

    if not messages:
        return json.dumps({"messages": []}, ensure_ascii=False)

    out = []

    for msg_meta in messages[:max_results]:
        msg = service.users().messages().get(
            userId="me",
            id=msg_meta["id"],
            format="metadata",
            metadataHeaders=["Subject", "From", "Date"],
        ).execute()

        headers = _metadata_headers(msg)

        out.append({
            "message_id": msg["id"],
            "thread_id": msg.get("threadId"),
            "from": headers.get("from", ""),
            "subject": headers.get("subject", ""),
            "date": headers.get("date", ""),
            "snippet": _decode_mail_snippet(msg.get("snippet", ""))
        })

    return json.dumps(
        {"messages": out},
        ensure_ascii=False,
        indent=2
    )


async def get_email(message_id: str = "", **_) -> str:
    if not message_id:
        return "message_id를 지정해주세요."
    service = await _build_service("gmail", "v1")
    msg = service.users().messages().get(userId="me", id=message_id, format="full").execute()
    headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
    # 본문 추출
    body = _extract_gmail_body(msg.get("payload", {}))
    return (
        f"From: {headers.get('From', '')}\n"
        f"To: {headers.get('To', '')}\n"
        f"Subject: {headers.get('Subject', '')}\n"
        f"Date: {headers.get('Date', '')}\n\n"
        f"{body}"
    )


def _extract_gmail_body(payload: dict) -> str:
    """Gmail payload에서 텍스트 본문 추출."""
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    for part in payload.get("parts", []):
        result = _extract_gmail_body(part)
        if result:
            return result
    return ""


async def create_email_draft(to: str = "", subject: str = "", body: str = "",
                              attachments: str = "", **_) -> str:
    """이메일 초안을 생성한다. attachments는 쉼표 구분 파일명."""
    conf = await _get_google_config_async()
    mail_mode = (conf or {}).get("mail_mode", "draft_only")
    if mail_mode == "readonly":
        return "이메일 쓰기 권한이 '읽기 전용'으로 설정되어 있습니다."
    service = await _build_service("gmail", "v1")
    att_list = [f.strip() for f in attachments.split(",") if f.strip()] if attachments else []
    message = _build_message_with_attachments(body, att_list)
    message["to"] = to
    message["subject"] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
    draft = service.users().drafts().create(userId="me", body={"message": {"raw": raw}}).execute()
    att_info = f" (첨부파일 {len(att_list)}개)" if att_list else ""
    return f"초안이 생성되었습니다.{att_info} (Draft ID: {draft['id']})"


async def send_email(to: str = "", subject: str = "", body: str = "",
                      attachments: str = "", **_) -> str:
    """이메일을 발송한다. attachments는 쉼표 구분 파일명."""
    conf = await _get_google_config_async()
    mail_mode = (conf or {}).get("mail_mode", "draft_only")
    if mail_mode != "send":
        return "이메일 발송이 허용되지 않았습니다. 설정에서 '발송 허용'으로 변경해주세요."
    service = await _build_service("gmail", "v1")
    att_list = [f.strip() for f in attachments.split(",") if f.strip()] if attachments else []
    message = _build_message_with_attachments(body, att_list)
    message["to"] = to
    message["subject"] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
    service.users().messages().send(userId="me", body={"raw": raw}).execute()
    att_info = f" (첨부파일 {len(att_list)}개 포함)" if att_list else ""
    return f"이메일이 {to}에게 전송되었습니다.{att_info}"


async def reply_email(message_id: str = "", body: str = "",
                       attachments: str = "", **_) -> str:
    """이메일에 답장한다. attachments는 쉼표 구분 파일명."""
    if not message_id:
        return "message_id를 지정해주세요."
    conf = await _get_google_config_async()
    mail_mode = (conf or {}).get("mail_mode", "draft_only")
    if mail_mode != "send":
        return "이메일 발송이 허용되지 않았습니다."
    service = await _build_service("gmail", "v1")
    orig = service.users().messages().get(userId="me", id=message_id, format="metadata",
                                          metadataHeaders=["Subject", "From", "Message-ID"]).execute()
    headers = _metadata_headers(orig)
    att_list = [f.strip() for f in attachments.split(",") if f.strip()] if attachments else []
    message = _build_message_with_attachments(body, att_list)
    # From 헤더가 '"이름" <email>' 형식일 수 있으므로 이메일 주소만 추출
    from_header = headers.get("from", "")
    _, from_email = parseaddr(from_header)
    message["to"] = from_email or from_header
    message["subject"] = f"Re: {headers.get('subject', '')}"
    message["In-Reply-To"] = headers.get("message-id", "")
    message["References"] = headers.get("message-id", "")
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
    service.users().messages().send(
        userId="me", body={"raw": raw, "threadId": orig.get("threadId")}
    ).execute()
    att_info = f" (첨부파일 {len(att_list)}개 포함)" if att_list else ""
    return f"답장이 전송되었습니다.{att_info}"


async def trash_email(message_id: str = "", **_) -> str:
    """이메일을 휴지통으로 이동한다."""
    if not message_id:
        return "message_id를 지정해주세요."
    service = await _build_service("gmail", "v1")
    service.users().messages().trash(userId="me", id=message_id).execute()
    return f"이메일이 휴지통으로 이동되었습니다. (ID: {message_id})"


async def batch_trash_emails(query: str = "", max_results: int = 50, **_) -> str:
    """검색 조건에 맞는 이메일을 일괄 휴지통으로 이동한다.
    예: query='is:unread older_than:30d' → 30일 이상 된 안 읽은 메일 삭제
    """
    if not query:
        return "검색 쿼리를 지정해주세요. (예: 'is:unread older_than:30d')"
    service = await _build_service("gmail", "v1")
    results = service.users().messages().list(
        userId="me", q=query, maxResults=max_results
    ).execute()
    messages = results.get("messages", [])
    if not messages:
        return "조건에 맞는 이메일이 없습니다."
    count = 0
    for msg in messages:
        try:
            service.users().messages().trash(userId="me", id=msg["id"]).execute()
            count += 1
        except Exception as e:
            logger.warning("[google] 메일 삭제 실패 %s: %s", msg["id"], e)
    return f"{count}건의 이메일이 휴지통으로 이동되었습니다. (총 {len(messages)}건 중)"
