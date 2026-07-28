"""
routers/project.py – LLM이 생성한 프로젝트 파일들을 zip으로 반환
POST /api/project/download
  body: { "project_name": "my-app", "files": [{"path": "...", "content": "..."}] }
  response: application/zip
"""

import io
import re
import zipfile
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


@router.get("/projects")
async def list_projects():
    from services.db import PROJECTS_INDEX, get_es
    es = get_es()
    try:
        result = await es.search(index=PROJECTS_INDEX, body={"query": {"match_all": {}}, "sort": [{"updated_at": "desc"}], "size": 100})
        return {"projects": [hit["_source"] for hit in result["hits"]["hits"]]}
    except Exception:
        return {"projects": []}
    finally:
        await es.close()


@router.post("/projects")
async def create_project(body: dict):
    from services.db import PROJECTS_INDEX, get_es
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="프로젝트 이름을 입력하세요.")
    folder_paths = body.get("folder_paths", [])
    if not isinstance(folder_paths, list):
        raise HTTPException(status_code=400, detail="폴더 목록이 올바르지 않습니다.")
    project = {
        "id": str(uuid.uuid4()), "name": name,
        "color": str(body.get("color", "#f5f5f5")),
        "folder_paths": list(dict.fromkeys(str(path).strip() for path in folder_paths if str(path).strip())),
        "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    es = get_es()
    try:
        await es.index(index=PROJECTS_INDEX, id=project["id"], document=project, refresh=True)
        return project
    finally:
        await es.close()


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, body: dict):
    """프로젝트 이름과 프로젝트 지침을 수정한다."""
    from services.db import PROJECTS_INDEX, get_es
    updates = {key: str(body[key]).strip() for key in ("name", "project_prompt", "color") if key in body}
    if "folder_paths" in body:
        folder_paths = body["folder_paths"]
        if not isinstance(folder_paths, list):
            raise HTTPException(status_code=400, detail="폴더 목록이 올바르지 않습니다.")
        updates["folder_paths"] = list(dict.fromkeys(str(path).strip() for path in folder_paths if str(path).strip()))
    if "name" in updates and not updates["name"]:
        raise HTTPException(status_code=400, detail="프로젝트 이름을 입력하세요.")
    if not updates:
        raise HTTPException(status_code=400, detail="수정할 항목이 없습니다.")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    es = get_es()
    try:
        await es.update(index=PROJECTS_INDEX, id=project_id, doc=updates, refresh=True)
        result = await es.get(index=PROJECTS_INDEX, id=project_id)
        return result["_source"]
    finally:
        await es.close()


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    from services.db import HIST_INDEX, PROJECTS_INDEX, get_es
    es = get_es()
    try:
        await es.delete_by_query(index=HIST_INDEX, body={"query": {"term": {"project_id.keyword": project_id}}}, refresh=True)
        await es.delete(index=PROJECTS_INDEX, id=project_id, ignore=[404], refresh=True)
        return {"ok": True}
    finally:
        await es.close()


class ProjectFile(BaseModel):
    path: str
    content: str


class ProjectDownloadRequest(BaseModel):
    project_name: str = "my-project"
    files: list[ProjectFile]


def parse_xml_project(raw: str) -> dict | None:
    """
    xml:project 블록 파싱
    <project name="..."> <file path="...">내용</file> ... </project>
    """
    # project name 추출
    name_m = re.search(r'<project\s+name=["\']([^"\']+)["\']', raw)
    project_name = name_m.group(1) if name_m else "my-project"

    # 각 file 블록 추출
    file_re = re.compile(r'<file\s+path=["\']([^"\']+)["\']>([\s\S]*?)</file>', re.IGNORECASE)
    files = []
    for m in file_re.finditer(raw):
        path = m.group(1).strip()
        content = m.group(2)
        # 앞뒤 개행 1개씩 제거 (태그 바로 뒤/앞 개행)
        if content.startswith('\n'):
            content = content[1:]
        if content.endswith('\n'):
            content = content[:-1]
        files.append({"path": path, "content": content})

    if not files:
        return None
    return {"project_name": project_name, "files": files}


@router.post("/project/download")
async def download_project(request: Request):
    body = await request.json()

    # xml:project 포맷 (raw 필드) 또는 기존 JSON 포맷 모두 지원
    if "raw" in body:
        data = parse_xml_project(body["raw"])
        if not data:
            raise HTTPException(status_code=400, detail="xml:project 파싱 실패")
        project_name = data["project_name"]
        files = data["files"]
    else:
        # 기존 JSON 포맷 호환
        project_name = body.get("project_name", "my-project")
        files = body.get("files", [])
        if not files:
            raise HTTPException(status_code=400, detail="files가 비어 있습니다.")

    # 프로젝트명 sanitize
    safe_name = project_name.replace("..", "").replace("/", "").replace("\\", "").strip() or "my-project"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            safe_path = f["path"].lstrip("/").replace("..", "")
            zf.writestr(f"{safe_name}/{safe_path}", f["content"])
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.zip"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )
