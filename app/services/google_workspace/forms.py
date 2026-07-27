"""Google Forms API 도구."""
from typing import Any

from .auth import _build_service


async def create_google_form(title: str = "", document_title: str = "", **_) -> str:
    """새 Google Forms 설문지를 생성한다."""
    if not title:
        return "설문지 제목을 지정해주세요."
    service = await _build_service("forms", "v1")
    form = service.forms().create(body={
        "info": {"title": title, "documentTitle": document_title or title}
    }).execute()
    form_id = form["formId"]
    link = form.get("responderUri", f"https://docs.google.com/forms/d/{form_id}/viewform")
    edit_link = f"https://docs.google.com/forms/d/{form_id}/edit"
    return f"설문지 생성 완료\nID: {form_id}\n제목: {title}\n응답 링크: {link}\n편집 링크: {edit_link}"


async def get_google_form(form_id: str = "", **_) -> str:
    """Google Forms 설문지 정보를 읽는다."""
    if not form_id:
        return "form_id를 지정해주세요."
    service = await _build_service("forms", "v1")
    form = service.forms().get(formId=form_id).execute()
    title = form.get("info", {}).get("title", "")
    items = form.get("items", [])
    parts = [f"제목: {title}", f"질문 수: {len(items)}", f"ID: {form_id}"]
    for i, item in enumerate(items):
        q = item.get("questionItem", {}).get("question", {})
        item_title = item.get("title", "(제목 없음)")
        q_type = "텍스트"
        if q.get("choiceQuestion"):
            q_type = q["choiceQuestion"].get("type", "RADIO")
            options = [o.get("value", "") for o in q["choiceQuestion"].get("options", [])]
            parts.append(f"  {i+1}. {item_title} [{q_type}]: {', '.join(options)}")
        else:
            parts.append(f"  {i+1}. {item_title} [{q_type}]")
    return "\n".join(parts)


async def add_form_question(form_id: str = "", title: str = "", question_type: str = "TEXT",
                             options: str = "", required: bool = False, **_) -> str:
    """Google Forms에 질문을 추가한다.
    question_type: TEXT, RADIO, CHECKBOX, DROP_DOWN, SCALE
    options: 선택지(쉼표 구분, RADIO/CHECKBOX/DROP_DOWN에 필요)
    """
    if not form_id or not title:
        return "form_id와 title을 지정해주세요."
    service = await _build_service("forms", "v1")

    question: dict[str, Any] = {"required": required}
    if question_type.upper() == "TEXT":
        question["textQuestion"] = {"paragraph": False}
    elif question_type.upper() == "PARAGRAPH":
        question["textQuestion"] = {"paragraph": True}
    elif question_type.upper() in ("RADIO", "CHECKBOX", "DROP_DOWN"):
        opts = [o.strip() for o in options.split(",") if o.strip()]
        if not opts:
            return "선택형 질문에는 options(쉼표 구분)를 지정해주세요."
        question["choiceQuestion"] = {
            "type": question_type.upper(),
            "options": [{"value": o} for o in opts],
        }
    elif question_type.upper() == "SCALE":
        question["scaleQuestion"] = {"low": 1, "high": 5}
    else:
        return f"지원하지 않는 질문 유형: {question_type}"

    # 현재 질문 개수로 index 결정
    form = service.forms().get(formId=form_id).execute()
    idx = len(form.get("items", []))

    service.forms().batchUpdate(formId=form_id, body={
        "requests": [{"createItem": {
            "item": {"title": title, "questionItem": {"question": question}},
            "location": {"index": idx},
        }}]
    }).execute()
    return f"질문 추가 완료: '{title}' ({question_type})"


async def get_form_responses(form_id: str = "", max_results: int = 50, **_) -> str:
    """Google Forms 응답을 조회한다."""
    if not form_id:
        return "form_id를 지정해주세요."
    service = await _build_service("forms", "v1")
    result = service.forms().responses().list(formId=form_id, pageSize=max_results).execute()
    responses = result.get("responses", [])
    if not responses:
        return "응답이 없습니다."

    # 질문 ID → 제목 매핑
    form = service.forms().get(formId=form_id).execute()
    q_map: dict[str, str] = {}
    for item in form.get("items", []):
        q = item.get("questionItem", {}).get("question", {})
        q_id = q.get("questionId", "")
        if q_id:
            q_map[q_id] = item.get("title", q_id)

    parts = [f"총 {len(responses)}건의 응답"]
    for i, resp in enumerate(responses):
        answers = resp.get("answers", {})
        ans_parts = []
        for q_id, ans in answers.items():
            q_title = q_map.get(q_id, q_id)
            text_answers = ans.get("textAnswers", {}).get("answers", [])
            values = [a.get("value", "") for a in text_answers]
            ans_parts.append(f"  {q_title}: {', '.join(values)}")
        submit_time = resp.get("lastSubmittedTime", "")
        parts.append(f"--- 응답 {i+1} ({submit_time}) ---")
        parts.extend(ans_parts)
    return "\n".join(parts)


async def update_form_info(form_id: str = "", title: str = "", description: str = "", **_) -> str:
    """Google Forms 설문지 제목/설명을 수정한다."""
    if not form_id:
        return "form_id를 지정해주세요."
    service = await _build_service("forms", "v1")
    update_mask = []
    info: dict[str, str] = {}
    if title:
        info["title"] = title
        update_mask.append("info.title")
    if description:
        info["description"] = description
        update_mask.append("info.description")
    if not update_mask:
        return "수정할 title 또는 description을 지정해주세요."
    service.forms().batchUpdate(formId=form_id, body={
        "requests": [{"updateFormInfo": {
            "info": info,
            "updateMask": ",".join(update_mask),
        }}]
    }).execute()
    return f"설문지 정보 수정 완료 (ID: {form_id})"
