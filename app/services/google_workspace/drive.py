"""Google Drive API 도구."""
import mimetypes
from pathlib import Path
from typing import Any

from logger import get_logger

try:
    from googleapiclient.http import MediaFileUpload, MediaInMemoryUpload
except ImportError:
    MediaFileUpload = None  # type: ignore
    MediaInMemoryUpload = None  # type: ignore

from .auth import _build_service
from .gmail import _resolve_attachment_path

logger = get_logger(__name__)


async def search_drive_files(query: str = "", max_results: int = 10, **_) -> str:
    service = await _build_service("drive", "v3")

    q = None

    if query:
        # 사용자가 Drive API query 문법을 직접 전달한 경우 그대로 사용
        drive_query_keywords = [
            "name contains",
            "name =",
            "mimeType",
            "trashed",
            "fullText contains",
            "parents in",
        ]

        if any(keyword in query for keyword in drive_query_keywords):
            q = query
        else:
            # 일반 검색어는 파일명 contains 검색으로 처리
            escaped_query = query.replace("'", "\\'")
            q = f"name contains '{escaped_query}'"

    results = service.files().list(
        q=q,
        pageSize=max_results,
        fields="files(id,name,mimeType,modifiedTime,size)",
    ).execute()

    files = results.get("files", [])

    if not files:
        return "검색 결과가 없습니다."

    return "\n---\n".join(
        f"ID: {f['id']}\n"
        f"이름: {f['name']}\n"
        f"타입: {f.get('mimeType', '')}\n"
        f"수정일: {f.get('modifiedTime', '')}\n"
        f"크기: {f.get('size', 'N/A')}"
        for f in files
    )


async def get_drive_file(file_id: str = "", **_) -> str:
    if not file_id:
        return "file_id를 지정해주세요."
    service = await _build_service("drive", "v3")
    f = service.files().get(
        fileId=file_id, fields="id,name,mimeType,modifiedTime,size,webViewLink,owners"
    ).execute()
    owners = ", ".join(o.get("displayName", "") for o in f.get("owners", []))
    return (
        f"ID: {f['id']}\n이름: {f['name']}\n타입: {f.get('mimeType', '')}\n"
        f"수정일: {f.get('modifiedTime', '')}\n크기: {f.get('size', 'N/A')}\n"
        f"소유자: {owners}\n링크: {f.get('webViewLink', '')}"
    )


async def read_document_content(file_id: str = "", **_) -> str:
    if not file_id:
        return "file_id를 지정해주세요."
    service = await _build_service("drive", "v3")
    # Google Docs → 텍스트로 export
    f = service.files().get(fileId=file_id, fields="mimeType").execute()
    mime = f.get("mimeType", "")
    if mime == "application/vnd.google-apps.document":
        content = service.files().export(fileId=file_id, mimeType="text/plain").execute()
        return content.decode("utf-8") if isinstance(content, bytes) else str(content)
    elif mime == "application/vnd.google-apps.spreadsheet":
        content = service.files().export(fileId=file_id, mimeType="text/csv").execute()
        return content.decode("utf-8") if isinstance(content, bytes) else str(content)
    else:
        return f"이 파일 타입({mime})은 텍스트로 읽을 수 없습니다. Google Docs/Sheets만 지원됩니다."


async def list_drive_folder_items(folder_id: str = "root", max_results: int = 20, **_) -> str:
    service = await _build_service("drive", "v3")
    results = service.files().list(
        q=f"'{folder_id}' in parents and trashed = false",
        pageSize=max_results, fields="files(id,name,mimeType,modifiedTime)",
    ).execute()
    files = results.get("files", [])
    if not files:
        return "폴더가 비어 있습니다."
    return "\n".join(
        f"- {f['name']} ({f.get('mimeType', '')}) [ID: {f['id']}]"
        for f in files
    )


async def upload_drive_file(attachments: str = "", folder_id: str = "",
                            sharing: str = "private", **_) -> str:
    """로컬 업로드 파일을 Google Drive에 업로드한다.
    attachments: 쉼표 구분 파일명 (saved_name)
    sharing: private(기본) | anyone_view | anyone_edit
    """
    if not attachments:
        return "업로드할 파일명을 attachments에 지정해주세요."
    service = await _build_service("drive", "v3")
    filenames = [f.strip() for f in attachments.split(",") if f.strip()]
    results = []
    for fn in filenames:
        path = _resolve_attachment_path(fn)
        if not path:
            results.append(f"❌ {fn}: 파일을 찾을 수 없습니다.")
            continue
        # uid 접두사 제거하여 원본 파일명 사용
        display_name = path.name
        if len(display_name) > 9 and display_name[8] == "_":
            display_name = display_name[9:]
        content_type, _ = mimetypes.guess_type(str(path))
        if not content_type:
            content_type = "application/octet-stream"
        metadata: dict[str, Any] = {"name": display_name}
        if folder_id:
            metadata["parents"] = [folder_id]
        media = MediaFileUpload(str(path), mimetype=content_type, resumable=False)
        f = service.files().create(body=metadata, media_body=media,
                                   fields="id,name,webViewLink").execute()
        file_id = f["id"]
        # 공유 설정
        if sharing in ("anyone_view", "anyone_edit"):
            role = "reader" if sharing == "anyone_view" else "writer"
            service.permissions().create(
                fileId=file_id,
                body={"type": "anyone", "role": role},
            ).execute()
        link = f.get("webViewLink", "")
        sharing_label = {"private": "비공개", "anyone_view": "링크 보기 가능", "anyone_edit": "링크 편집 가능"}.get(sharing, sharing)
        results.append(f"✅ {display_name}\n   ID: {file_id}\n   링크: {link}\n   공유: {sharing_label}")
        logger.info("[drive] 업로드 완료: %s → %s (%s)", fn, file_id, sharing_label)
    return "\n---\n".join(results)


async def download_drive_file(file_id: str = "", **_) -> str:
    """Google Drive 파일을 사용자의 다운로드 폴더에 저장한다."""
    if not file_id:
        return "file_id를 지정해주세요."
    service = await _build_service("drive", "v3")
    # 파일 메타데이터 조회
    meta = service.files().get(fileId=file_id, fields="id,name,mimeType").execute()
    name = meta.get("name", "download")
    mime = meta.get("mimeType", "")
    downloads_dir = Path.home() / "Downloads"
    downloads_dir.mkdir(parents=True, exist_ok=True)

    # Google Workspace 문서는 export 필요
    export_map = {
        "application/vnd.google-apps.document": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
        "application/vnd.google-apps.spreadsheet": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
        "application/vnd.google-apps.presentation": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
    }
    if mime in export_map:
        export_mime, ext = export_map[mime]
        content = service.files().export(fileId=file_id, mimeType=export_mime).execute()
        if not name.endswith(ext):
            name += ext
    else:
        from io import BytesIO
        from googleapiclient.http import MediaIoBaseDownload
        fh = BytesIO()
        request = service.files().get_media(fileId=file_id)
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        content = fh.getvalue()

    # 파일명 충돌 방지
    save_path = downloads_dir / name
    if save_path.exists():
        stem = save_path.stem
        suffix = save_path.suffix
        i = 1
        while save_path.exists():
            save_path = downloads_dir / f"{stem} ({i}){suffix}"
            i += 1
    save_path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
    logger.info("[drive] 다운로드 완료: %s → %s", file_id, save_path)
    return f"다운로드 완료\n파일: {save_path.name}\n위치: {save_path}"


async def create_drive_file(name: str = "", content: str = "", mime_type: str = "text/plain",
                            folder_id: str = "", **_) -> str:
    """Drive에 새 파일을 생성한다."""
    if not name:
        return "파일 이름을 지정해주세요."
    service = await _build_service("drive", "v3")
    metadata: dict[str, Any] = {"name": name}
    if folder_id:
        metadata["parents"] = [folder_id]
    media = MediaInMemoryUpload(content.encode("utf-8"), mimetype=mime_type, resumable=False)
    f = service.files().create(body=metadata, media_body=media, fields="id,name,webViewLink").execute()
    return f"파일 생성 완료\nID: {f['id']}\n이름: {f['name']}\n링크: {f.get('webViewLink', '')}"


async def update_drive_file(file_id: str = "", content: str = "", **_) -> str:
    """Drive 파일의 내용을 업데이트한다."""
    if not file_id:
        return "file_id를 지정해주세요."
    service = await _build_service("drive", "v3")
    media = MediaInMemoryUpload(content.encode("utf-8"), mimetype="text/plain", resumable=False)
    f = service.files().update(fileId=file_id, media_body=media, fields="id,name").execute()
    return f"파일 업데이트 완료 — {f['name']} (ID: {f['id']})"


async def delete_drive_file(file_id: str = "", **_) -> str:
    """Drive 파일을 휴지통으로 이동한다."""
    if not file_id:
        return "file_id를 지정해주세요."
    service = await _build_service("drive", "v3")
    service.files().update(fileId=file_id, body={"trashed": True}).execute()
    return f"파일이 휴지통으로 이동되었습니다. (ID: {file_id})"


async def move_drive_file(file_id: str = "", target_folder_id: str = "", **_) -> str:
    """Drive 파일을 다른 폴더로 이동한다."""
    if not file_id or not target_folder_id:
        return "file_id와 target_folder_id를 지정해주세요."
    service = await _build_service("drive", "v3")
    f = service.files().get(fileId=file_id, fields="parents").execute()
    prev_parents = ",".join(f.get("parents", []))
    f = service.files().update(
        fileId=file_id, addParents=target_folder_id, removeParents=prev_parents,
        fields="id,name,parents",
    ).execute()
    return f"파일 이동 완료 — {f['name']} (ID: {f['id']})"


async def create_drive_folder(name: str = "", parent_folder_id: str = "", **_) -> str:
    """Drive에 새 폴더를 생성한다."""
    if not name:
        return "폴더 이름을 지정해주세요."
    service = await _build_service("drive", "v3")
    metadata: dict[str, Any] = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    if parent_folder_id:
        metadata["parents"] = [parent_folder_id]
    f = service.files().create(body=metadata, fields="id,name,webViewLink").execute()
    return f"폴더 생성 완료\nID: {f['id']}\n이름: {f['name']}\n링크: {f.get('webViewLink', '')}"
