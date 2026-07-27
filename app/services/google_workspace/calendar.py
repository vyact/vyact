"""Google Calendar API 도구."""
from datetime import datetime, timezone
from typing import Any

from .auth import _build_service


async def list_upcoming_events(max_results: int = 10, calendar_id: str = "primary", **_) -> str:
    service = await _build_service("calendar", "v3")
    now = datetime.now(timezone.utc).isoformat()
    results = service.events().list(
        calendarId=calendar_id, timeMin=now, maxResults=max_results,
        singleEvents=True, orderBy="startTime",
    ).execute()
    events = results.get("items", [])
    if not events:
        return "다가오는 일정이 없습니다."
    return "\n---\n".join(_format_event(e) for e in events)


async def search_calendar_events(query: str = "", max_results: int = 10,
                                 calendar_id: str = "primary",
                                 time_min: str = "", time_max: str = "", **_) -> str:
    service = await _build_service("calendar", "v3")
    kwargs: dict[str, Any] = {
        "calendarId": calendar_id, "q": query, "maxResults": max_results,
        "singleEvents": True, "orderBy": "startTime",
    }
    if time_min:
        kwargs["timeMin"] = time_min
    if time_max:
        kwargs["timeMax"] = time_max
    results = service.events().list(**kwargs).execute()
    events = results.get("items", [])
    if not events:
        return "검색 결과가 없습니다."
    return "\n---\n".join(_format_event(e) for e in events)


async def list_calendars(**_) -> str:
    service = await _build_service("calendar", "v3")
    results = service.calendarList().list().execute()
    cals = results.get("items", [])
    return "\n".join(
        f"- {c.get('summary', '')} (ID: {c['id']}, primary: {c.get('primary', False)})"
        for c in cals
    )


async def check_free_busy(time_min: str = "", time_max: str = "",
                          calendar_ids: str = "primary", **_) -> str:
    service = await _build_service("calendar", "v3")
    ids = [c.strip() for c in calendar_ids.split(",") if c.strip()]
    body = {
        "timeMin": time_min, "timeMax": time_max,
        "items": [{"id": cid} for cid in ids],
    }
    result = service.freebusy().query(body=body).execute()
    out = []
    for cal_id, info in result.get("calendars", {}).items():
        busy = info.get("busy", [])
        if busy:
            slots = ", ".join(f"{b['start']} ~ {b['end']}" for b in busy)
            out.append(f"{cal_id}: 바쁜 시간 — {slots}")
        else:
            out.append(f"{cal_id}: 해당 기간 비어 있음")
    return "\n".join(out) or "결과 없음"


async def get_calendar_event(event_id: str = "", calendar_id: str = "primary", **_) -> str:
    if not event_id:
        return "event_id를 지정해주세요."
    service = await _build_service("calendar", "v3")
    event = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
    return _format_event(event)


async def create_calendar_event(summary: str = "", start: str = "", end: str = "",
                                description: str = "", location: str = "",
                                calendar_id: str = "primary",
                                timezone: str = "Asia/Seoul", **_) -> str:
    service = await _build_service("calendar", "v3")
    event_body: dict[str, Any] = {"summary": summary}
    if description:
        event_body["description"] = description
    if location:
        event_body["location"] = location
    # 종일 일정 vs 시간 지정
    if "T" in start:
        event_body["start"] = {"dateTime": start, "timeZone": timezone}
        event_body["end"] = {"dateTime": end, "timeZone": timezone}
    else:
        event_body["start"] = {"date": start}
        event_body["end"] = {"date": end}
    event = service.events().insert(calendarId=calendar_id, body=event_body).execute()
    return f"일정이 생성되었습니다.\n{_format_event(event)}"


async def update_calendar_event(event_id: str = "", calendar_id: str = "primary",
                                summary: str = "", start: str = "", end: str = "",
                                description: str = "", location: str = "",
                                timezone: str = "Asia/Seoul", **_) -> str:
    if not event_id:
        return "event_id를 지정해주세요."
    service = await _build_service("calendar", "v3")
    event = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
    if summary:
        event["summary"] = summary
    if description:
        event["description"] = description
    if location:
        event["location"] = location
    if start:
        if "T" in start:
            event["start"] = {"dateTime": start, "timeZone": timezone}
        else:
            event["start"] = {"date": start}
    if end:
        if "T" in end:
            event["end"] = {"dateTime": end, "timeZone": timezone}
        else:
            event["end"] = {"date": end}
    updated = service.events().update(calendarId=calendar_id, eventId=event_id, body=event).execute()
    return f"일정이 수정되었습니다.\n{_format_event(updated)}"


async def delete_calendar_event(event_id: str = "", calendar_id: str = "primary", **_) -> str:
    if not event_id:
        return "event_id를 지정해주세요."
    service = await _build_service("calendar", "v3")
    service.events().delete(calendarId=calendar_id, eventId=event_id).execute()
    return f"일정이 삭제되었습니다. (ID: {event_id})"


def _format_event(event: dict) -> str:
    start = event.get("start", {})
    end = event.get("end", {})
    start_str = start.get("dateTime") or start.get("date", "")
    end_str = end.get("dateTime") or end.get("date", "")
    parts = [
        f"ID: {event.get('id', '')}",
        f"제목: {event.get('summary', '')}",
        f"시작: {start_str}",
        f"종료: {end_str}",
    ]
    if event.get("location"):
        parts.append(f"장소: {event['location']}")
    if event.get("description"):
        parts.append(f"설명: {event['description']}")
    return "\n".join(parts)
