"""Google Slides API 도구."""
import uuid

from .auth import _build_service


async def create_google_slides(title: str = "", folder_id: str = "", **_) -> str:
    """새 Google Slides 프레젠테이션을 생성한다."""
    if not title:
        return "프레젠테이션 제목을 지정해주세요."
    service = await _build_service("slides", "v1")
    pres = service.presentations().create(body={"title": title}).execute()
    pres_id = pres["presentationId"]
    if folder_id:
        drive = await _build_service("drive", "v3")
        f = drive.files().get(fileId=pres_id, fields="parents").execute()
        prev = ",".join(f.get("parents", []))
        drive.files().update(fileId=pres_id, addParents=folder_id, removeParents=prev).execute()
    link = f"https://docs.google.com/presentation/d/{pres_id}/edit"
    return f"프레젠테이션 생성 완료\nID: {pres_id}\n제목: {title}\n링크: {link}"


async def get_google_slides(presentation_id: str = "", **_) -> str:
    """Google Slides 프레젠테이션 정보와 슬라이드 목록을 읽는다."""
    if not presentation_id:
        return "presentation_id를 지정해주세요."
    service = await _build_service("slides", "v1")
    pres = service.presentations().get(presentationId=presentation_id).execute()
    title = pres.get("title", "")
    slides = pres.get("slides", [])
    parts = [f"제목: {title}", f"슬라이드 수: {len(slides)}", f"ID: {presentation_id}"]
    for i, slide in enumerate(slides):
        texts = []
        for elem in slide.get("pageElements", []):
            shape = elem.get("shape", {})
            text_elem = shape.get("text", {})
            for te in text_elem.get("textElements", []):
                tr = te.get("textRun", {})
                if tr.get("content", "").strip():
                    texts.append(tr["content"].strip())
        slide_text = " | ".join(texts) if texts else "(빈 슬라이드)"
        parts.append(f"  슬라이드 {i+1} [{slide.get('objectId', '')}]: {slide_text}")
    return "\n".join(parts)


async def add_slide(presentation_id: str = "", layout: str = "BLANK",
                    title_text: str = "", body_text: str = "", **_) -> str:
    """Google Slides에 새 슬라이드를 추가한다."""
    if not presentation_id:
        return "presentation_id를 지정해주세요."
    service = await _build_service("slides", "v1")
    slide_id = f"slide_{uuid.uuid4().hex[:8]}"
    requests = [{"createSlide": {
        "objectId": slide_id,
        "slideLayoutReference": {"predefinedLayout": layout},
    }}]
    # 텍스트 삽입은 슬라이드 생성 후 별도 요청
    service.presentations().batchUpdate(
        presentationId=presentation_id, body={"requests": requests}
    ).execute()

    # 제목/본문 텍스트 삽입
    if title_text or body_text:
        slide = None
        pres = service.presentations().get(presentationId=presentation_id).execute()
        for s in pres.get("slides", []):
            if s.get("objectId") == slide_id:
                slide = s
                break
        if slide:
            text_requests = []
            for elem in slide.get("pageElements", []):
                shape = elem.get("shape", {})
                ph = shape.get("placeholder", {})
                ph_type = ph.get("type", "")
                obj_id = elem.get("objectId", "")
                if ph_type in ("TITLE", "CENTERED_TITLE") and title_text:
                    text_requests.append({"insertText": {
                        "objectId": obj_id, "text": title_text,
                        "insertionIndex": 0,
                    }})
                elif ph_type in ("BODY", "SUBTITLE") and body_text:
                    text_requests.append({"insertText": {
                        "objectId": obj_id, "text": body_text,
                        "insertionIndex": 0,
                    }})
            if text_requests:
                service.presentations().batchUpdate(
                    presentationId=presentation_id, body={"requests": text_requests}
                ).execute()

    return f"슬라이드 추가 완료 (ID: {slide_id})"


async def update_slide_text(presentation_id: str = "", find: str = "",
                             replace: str = "", **_) -> str:
    """Google Slides에서 텍스트를 찾아 바꾼다."""
    if not presentation_id or not find:
        return "presentation_id와 find를 지정해주세요."
    service = await _build_service("slides", "v1")
    result = service.presentations().batchUpdate(
        presentationId=presentation_id,
        body={"requests": [{"replaceAllText": {
            "containsText": {"text": find, "matchCase": True},
            "replaceText": replace or "",
        }}]}
    ).execute()
    count = result.get("replies", [{}])[0].get("replaceAllText", {}).get("occurrencesChanged", 0)
    return f"'{find}' → '{replace}' 치환 완료 ({count}건)"


async def delete_slide(presentation_id: str = "", slide_id: str = "", **_) -> str:
    """Google Slides에서 슬라이드를 삭제한다."""
    if not presentation_id or not slide_id:
        return "presentation_id와 slide_id를 지정해주세요."
    service = await _build_service("slides", "v1")
    service.presentations().batchUpdate(
        presentationId=presentation_id,
        body={"requests": [{"deleteObject": {"objectId": slide_id}}]}
    ).execute()
    return f"슬라이드 삭제 완료 (ID: {slide_id})"
