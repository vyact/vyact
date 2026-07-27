"""
routers/files.py – 일반 파일 업로드 (zip / pdf / docx / txt 등)
첨부된 파일은 ES에 인덱싱하지 않고 context_docs로 LLM에 직접 전달하는 용도.
"""
import shutil
import tempfile
import unicodedata
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from config import INSTALL_DIR
from logger import get_logger
from services.document_parser import PARSERS, parse_file

logger = get_logger(__name__)

router = APIRouter()

FILES_DIR = INSTALL_DIR / "uploads" / "files"
FILES_DIR.mkdir(parents=True, exist_ok=True)

# 텍스트 추출 가능한 확장자 (zip 내부 포함)
TEXT_EXTS = set(PARSERS.keys()) | {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".kt",
    ".go", ".rs", ".c", ".cpp", ".h", ".cs", ".swift",
    ".yaml", ".yml", ".json", ".toml", ".ini", ".env",
    ".sh", ".bat", ".ps1", ".fish", ".zsh", ".sql", ".csv", ".xml",
    ".css", ".scss", ".sass", ".less",
    ".vue", ".svelte", ".astro", ".graphql", ".gql",
    ".properties", ".gradle", ".cmake", ".mk",
    ".tf", ".proto",
    ".rb", ".php", ".lua", ".r",
    ".ex", ".exs",
}

# zip 내부에서 통째로 제외할 디렉토리 (빌드 산출물/의존성/버전관리 등, 확장자와 무관하게 노이즈)
EXCLUDED_ZIP_DIRS = {
    "node_modules", ".git", "dist", "build", "out", "target",
    "__pycache__", ".venv", "venv", ".next", ".nuxt",
    "coverage", ".idea", ".vscode", "__MACOSX",
}

# 파일 하나당 텍스트 최대 길이
MAX_FILE_CHARS = 30_000
# zip 내 파일 최대 개수 (이를 초과하면 프론트에 확인을 먼저 요청)
MAX_ZIP_FILES = 50


def _is_excluded_zip_path(filename: str) -> bool:
    """디렉토리명 기준으로만 제외 판단 (파일명은 __init__.py 등이 있어 검사 대상 아님)"""
    path = Path(filename)
    if path.name.startswith("."):
        return True
    dir_parts = path.parts[:-1]  # 파일명 제외, 상위 디렉토리만 검사
    return any(p in EXCLUDED_ZIP_DIRS for p in dir_parts)


def _extract_text(path: Path) -> str:
    """단일 파일 텍스트 추출. PARSERS 우선, 나머지는 utf-8 읽기."""
    ext = path.suffix.lower()
    if ext in PARSERS:
        try:
            return parse_file(path)
        except Exception as e:
            logger.warning("parse_file 실패 [%s]: %s", path.name, e)
            return ""
    # 코드/설정 파일
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def _list_eligible_zip_members(zip_path: Path) -> list[zipfile.ZipInfo]:
    """제외 디렉토리/확장자 필터만 적용한 대상 파일 목록 (내용은 읽지 않음, 개수 확인용)"""
    with zipfile.ZipFile(zip_path, "r") as zf:
        return [
            m for m in zf.infolist()
            if not m.is_dir()
               and not _is_excluded_zip_path(m.filename)
               and Path(m.filename).suffix.lower() in TEXT_EXTS
        ]


def _process_zip(zip_path: Path, members: list[zipfile.ZipInfo]) -> list[dict]:
    """주어진 zip 멤버 목록에 대해 텍스트 추출 → file_docs 리스트 반환

    내용이 비어있는 파일(__init__.py, .gitkeep 등)도 제외하지 않고 "(빈 파일)" placeholder로
    포함시킨다. 토큰 몇 개 아끼자고 빼면, 컨펌 모달에서 본 개수(_list_eligible_zip_members 기준)와
    실제 LLM에 전달되는 개수가 달라져 혼란을 주고, 프로젝트 구조 파악에도 오히려 방해가 된다.
    빈 파일이 실제로 의미가 있는지 없는지는 LLM이 파일명/경로를 보고 판단하게 둔다.
    """
    file_docs: list[dict] = []
    with tempfile.TemporaryDirectory() as tmp_dir:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp_dir, members=[m.filename for m in members])

        tmp_path = Path(tmp_dir)
        for member in members:
            member_path = tmp_path / member.filename
            if not member_path.exists():
                continue
            text = _extract_text(member_path)
            if not text.strip():
                text = "(빈 파일)"
            else:
                text = text[:MAX_FILE_CHARS]
            file_docs.append({
                "filename": member.filename,
                "content": text,
                "size": member.file_size,
            })
    return file_docs


def _build_zip_response(zip_path: Path, original_name: str, saved_name: str, members: list[zipfile.ZipInfo]) -> dict:
    file_docs = _process_zip(zip_path, members)
    if not file_docs:
        raise HTTPException(400, "zip 내부에서 읽을 수 있는 파일이 없습니다.")
    return {
        "type": "zip",
        "original_name": original_name,
        "saved_name": saved_name,
        "file_count": len(file_docs),
        "files": file_docs,
    }


@router.post("/files/upload")
async def upload_file(file: UploadFile = File(...), skip_parse: bool = False):
    """
    파일 업로드 엔드포인트.
    - zip: 대상 파일이 MAX_ZIP_FILES개를 넘으면 즉시 처리하지 않고 확인 요청(type="zip_confirm_needed")을 반환.
           saved_name은 유지되므로 /files/upload/zip-confirm 으로 재요청하면 재업로드 없이 처리 가능.
    - 기타: 단일 파일 텍스트 추출 결과 반환
    반환값은 프론트에서 attachment로 저장해 /query 요청 시 함께 전송.
    """
    # macOS NFD 자소 분리 방지: 파일명을 NFC로 정규화
    normalized_filename = unicodedata.normalize("NFC", file.filename)
    ext = Path(normalized_filename).suffix.lower()
    uid = str(uuid.uuid4())[:8]
    save_name = f"{uid}_{normalized_filename}"
    save_path = FILES_DIR / save_name

    contents = await file.read()
    save_path.write_bytes(contents)

    if ext == ".zip":
        # zip은 확인 단계가 필요할 수 있어 finally에서 바로 지우지 않음 (아래에서 상황별로 정리)
        eligible = _list_eligible_zip_members(save_path)
        if not eligible:
            save_path.unlink(missing_ok=True)
            raise HTTPException(400, "zip 내부에서 읽을 수 있는 파일이 없습니다.")

        if len(eligible) > MAX_ZIP_FILES:
            # 내용은 아직 읽지 않고 개수만 알려준 뒤 사용자 선택을 기다림 (saved_name 파일은 보존)
            return {
                "type": "zip_confirm_needed",
                "original_name": file.filename,
                "saved_name": save_name,
                "total_eligible": len(eligible),
                "default_limit": MAX_ZIP_FILES,
            }

        try:
            return _build_zip_response(save_path, file.filename, save_name, eligible)
        finally:
            save_path.unlink(missing_ok=True)
    else:
        if skip_parse:
            # 이메일 첨부용: 파싱 없이 파일 저장만
            return {
                "type": "file",
                "original_name": normalized_filename,
                "saved_name": save_name,
                "size": len(contents),
            }
        try:
            if ext not in TEXT_EXTS:
                raise HTTPException(400, f"지원하지 않는 파일 형식: {ext}")
            text = _extract_text(save_path)
            if not text.strip():
                text = "(빈 파일)"
            else:
                text = text[:MAX_FILE_CHARS]
            return {
                "type": "file",
                "original_name": normalized_filename,
                "saved_name": save_name,
                "content": text,
                "size": len(contents),
            }
        finally:
            pass


@router.post("/files/upload/zip-confirm")
async def confirm_zip_upload(saved_name: str, original_name: str, max_files: int):
    """
    zip_confirm_needed 응답을 받은 뒤, 사용자가 선택한 max_files로 실제 처리를 진행.
    재업로드 없이 이미 저장된 saved_name 파일을 그대로 사용한다.
    """
    # 경로 조작 방지: saved_name은 uploads 디렉토리 내 파일명이어야 함
    save_path = FILES_DIR / saved_name
    if save_path.parent != FILES_DIR or not save_path.is_file():
        raise HTTPException(400, "유효하지 않은 saved_name 입니다.")
    if max_files < 1:
        raise HTTPException(400, "max_files는 1 이상이어야 합니다.")

    try:
        eligible = _list_eligible_zip_members(save_path)
        if not eligible:
            raise HTTPException(400, "zip 내부에서 읽을 수 있는 파일이 없습니다.")
        selected = eligible[:max_files]
        return _build_zip_response(save_path, original_name, saved_name, selected)
    finally:
        save_path.unlink(missing_ok=True)