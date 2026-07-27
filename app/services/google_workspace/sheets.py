"""Google Sheets API 도구."""
import json
from typing import Any

from .auth import _build_service


async def create_google_sheet(title: str = "", sheet_names: str = "", folder_id: str = "", **_) -> str:
    """새 Google Sheets 스프레드시트를 생성한다."""
    if not title:
        return "스프레드시트 제목을 지정해주세요."
    service = await _build_service("sheets", "v4")
    body: dict[str, Any] = {"properties": {"title": title}}
    if sheet_names:
        sheets = [s.strip() for s in sheet_names.split(",") if s.strip()]
        body["sheets"] = [{"properties": {"title": s}} for s in sheets]
    ss = service.spreadsheets().create(body=body).execute()
    ss_id = ss["spreadsheetId"]
    if folder_id:
        drive = await _build_service("drive", "v3")
        f = drive.files().get(fileId=ss_id, fields="parents").execute()
        prev = ",".join(f.get("parents", []))
        drive.files().update(fileId=ss_id, addParents=folder_id, removeParents=prev).execute()
    link = f"https://docs.google.com/spreadsheets/d/{ss_id}/edit"
    return f"스프레드시트 생성 완료\nID: {ss_id}\n제목: {title}\n링크: {link}"


async def get_google_sheet(spreadsheet_id: str = "", range: str = "", **_) -> str:
    """Google Sheets 데이터를 읽는다."""
    if not spreadsheet_id:
        return "spreadsheet_id를 지정해주세요."
    service = await _build_service("sheets", "v4")
    if range:
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=range
        ).execute()
        values = result.get("values", [])
        if not values:
            return "데이터가 없습니다."
        return "\n".join("\t".join(str(c) for c in row) for row in values)
    else:
        ss = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        title = ss.get("properties", {}).get("title", "")
        sheets = [s["properties"]["title"] for s in ss.get("sheets", [])]
        return f"제목: {title}\n시트: {', '.join(sheets)}\nID: {spreadsheet_id}"


async def update_google_sheet(spreadsheet_id: str = "", range: str = "",
                               values: str = "", **_) -> str:
    """Google Sheets 셀을 업데이트한다. values는 JSON 2차원 배열 문자열."""
    if not spreadsheet_id or not range:
        return "spreadsheet_id와 range를 지정해주세요."
    service = await _build_service("sheets", "v4")
    try:
        data = json.loads(values) if isinstance(values, str) else values
    except Exception:
        return "values는 JSON 2차원 배열이어야 합니다. 예: [[\"A\",\"B\"],[1,2]]"
    result = service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id, range=range,
        valueInputOption="USER_ENTERED", body={"values": data}
    ).execute()
    return f"업데이트 완료 — {result.get('updatedCells', 0)}개 셀 수정됨"


async def append_to_google_sheet(spreadsheet_id: str = "", range: str = "",
                                  values: str = "", **_) -> str:
    """Google Sheets에 행을 추가한다."""
    if not spreadsheet_id or not range:
        return "spreadsheet_id와 range를 지정해주세요."
    service = await _build_service("sheets", "v4")
    try:
        data = json.loads(values) if isinstance(values, str) else values
    except Exception:
        return "values는 JSON 2차원 배열이어야 합니다."
    result = service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id, range=range,
        valueInputOption="USER_ENTERED", insertDataOption="INSERT_ROWS",
        body={"values": data}
    ).execute()
    updates = result.get("updates", {})
    return f"행 추가 완료 — {updates.get('updatedRows', 0)}행 추가됨"


async def clear_google_sheet(spreadsheet_id: str = "", range: str = "", **_) -> str:
    """Google Sheets 범위의 데이터를 지운다."""
    if not spreadsheet_id or not range:
        return "spreadsheet_id와 range를 지정해주세요."
    service = await _build_service("sheets", "v4")
    service.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id, range=range, body={}
    ).execute()
    return f"범위 '{range}'의 데이터가 삭제되었습니다."
