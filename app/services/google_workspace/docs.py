"""Google Docs API 도구."""
from .auth import _build_service


async def create_google_doc(title: str = "", content: str = "", folder_id: str = "", **_) -> str:
    """새 Google Docs 문서를 생성한다."""
    if not title:
        return "문서 제목을 지정해주세요."
    docs = await _build_service("docs", "v1")
    doc = docs.documents().create(body={"title": title}).execute()
    doc_id = doc["documentId"]

    # 내용이 있으면 삽입
    if content:
        docs.documents().batchUpdate(documentId=doc_id, body={
            "requests": [{"insertText": {"location": {"index": 1}, "text": content}}]
        }).execute()

    # 폴더 지정 시 이동
    if folder_id:
        drive = await _build_service("drive", "v3")
        f = drive.files().get(fileId=doc_id, fields="parents").execute()
        prev = ",".join(f.get("parents", []))
        drive.files().update(fileId=doc_id, addParents=folder_id, removeParents=prev).execute()

    link = f"https://docs.google.com/document/d/{doc_id}/edit"
    return f"문서 생성 완료\nID: {doc_id}\n제목: {title}\n링크: {link}"


async def get_google_doc(document_id: str = "", **_) -> str:
    """Google Docs 문서의 내용을 읽는다."""
    if not document_id:
        return "document_id를 지정해주세요."
    docs = await _build_service("docs", "v1")
    doc = docs.documents().get(documentId=document_id).execute()
    title = doc.get("title", "")
    # 본문 텍스트 추출
    text_parts: list[str] = []
    for elem in doc.get("body", {}).get("content", []):
        para = elem.get("paragraph")
        if para:
            for e in para.get("elements", []):
                tr = e.get("textRun")
                if tr:
                    text_parts.append(tr.get("content", ""))
    return f"제목: {title}\n\n{''.join(text_parts)}"


async def append_to_google_doc(document_id: str = "", text: str = "", **_) -> str:
    """Google Docs 문서 끝에 텍스트를 추가한다."""
    if not document_id or not text:
        return "document_id와 text를 지정해주세요."
    docs = await _build_service("docs", "v1")
    # 문서 끝 인덱스 가져오기
    doc = docs.documents().get(documentId=document_id).execute()
    end_index = doc["body"]["content"][-1]["endIndex"] - 1
    docs.documents().batchUpdate(documentId=document_id, body={
        "requests": [{"insertText": {"location": {"index": end_index}, "text": text}}]
    }).execute()
    return f"텍스트가 문서 끝에 추가되었습니다. (ID: {document_id})"


async def update_google_doc(document_id: str = "", find: str = "", replace: str = "", **_) -> str:
    """Google Docs 문서에서 텍스트를 찾아 바꾼다."""
    if not document_id or not find:
        return "document_id와 find를 지정해주세요."
    docs = await _build_service("docs", "v1")
    result = docs.documents().batchUpdate(documentId=document_id, body={
        "requests": [{
            "replaceAllText": {
                "containsText": {"text": find, "matchCase": True},
                "replaceText": replace,
            }
        }]
    }).execute()
    count = result.get("replies", [{}])[0].get("replaceAllText", {}).get("occurrencesChanged", 0)
    return f"'{find}' → '{replace}' 치환 완료 ({count}건)"
