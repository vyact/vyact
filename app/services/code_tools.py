"""
services/code_tools.py — 코드 분석 tool (폴더 첨부 시 활성화)

사용자가 채팅에 폴더를 첨부하면, LLM이 해당 폴더 내 파일을 탐색·읽기·수정·검색할 수 있도록
내부 tool을 등록한다. 폴더 경로는 요청별 ContextVar로 관리된다.
"""
import fnmatch
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from collections import Counter
from contextvars import ContextVar
from pathlib import Path

from logger import get_logger

logger = get_logger(__name__)

# 요청별 폴더 경로
current_code_folder: ContextVar[str] = ContextVar("current_code_folder", default="")
# 프로젝트에 등록된 폴더 식별자 → 절대 경로. 모든 코드 도구 호출은 folder_id를 요구한다.
current_code_folders: ContextVar[dict[str, str]] = ContextVar("current_code_folders", default={})
# 삭제/이동은 이 요청의 사용자 원문에 명시적인 확인 문구가 있어야만 실행한다.
current_code_question: ContextVar[str] = ContextVar("current_code_question", default="")
current_code_change_snapshots: ContextVar[dict[tuple[str, str], bytes | None] | None] = ContextVar(
    "current_code_change_snapshots", default=None
)
_code_change_undo_registry: dict[str, dict] = {}
MAX_UNDO_REGISTRY_ENTRIES = 100

# 읽기 제한
MAX_READ_BYTES = 100_000  # 100KB
MAX_GREP_RESULTS = 50
MAX_FIND_RESULTS = 300
MAX_MULTI_READ_FILES = 10
MAX_PATCH_BYTES = 100_000
MAX_TASK_CONFIG_DEPTH = 4
PROJECT_MANIFEST_MAX_DEPTH = 3
PROJECT_MANIFEST_MAX_ENTRIES = 300
PROJECT_MANIFEST_MAX_CHARS = 12_000
PROJECT_MANIFEST_CACHE_TTL_SECONDS = 30
_project_manifest_cache: dict[tuple[str, ...], tuple[float, str]] = {}

# 무시할 디렉토리
IGNORE_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build",
    ".next", ".nuxt", ".cache", ".idea", ".vscode", "coverage", ".pytest_cache",
    "egg-info", ".tox", ".mypy_cache",
}


def build_code_folder_map(folder_paths: list[str]) -> dict[str, str]:
    """Map project folders to stable, human-readable and collision-free IDs."""
    normalized_paths = [str(path).strip() for path in folder_paths if str(path).strip()]
    folder_names = [Path(path).name or "root" for path in normalized_paths]
    name_counts = Counter(folder_names)
    reserved_unique_names = {
        name for name, count in name_counts.items() if count == 1
    }
    used_ids: set[str] = set()
    duplicate_indexes: dict[str, int] = {}
    folders: dict[str, str] = {}

    for folder_name, path in zip(folder_names, normalized_paths):
        if name_counts[folder_name] == 1:
            folder_id = folder_name
        else:
            next_index = duplicate_indexes.get(folder_name, 0) + 1
            folder_id = f"{folder_name}_{next_index}"
            while folder_id in reserved_unique_names or folder_id in used_ids:
                next_index += 1
                folder_id = f"{folder_name}_{next_index}"
            duplicate_indexes[folder_name] = next_index
        used_ids.add(folder_id)
        folders[folder_id] = path

    return folders


def build_project_manifest(folder_paths: list[str]) -> str:
    """Build a bounded, language-independent source tree for project context."""
    folders = build_code_folder_map(folder_paths)
    if not folders:
        return ""
    resolved_folders = tuple(
        (folder_id, str(Path(path).resolve()))
        for folder_id, path in folders.items()
    )

    cache_key = tuple(f"{folder_id}\0{path}" for folder_id, path in resolved_folders)
    cached = _project_manifest_cache.get(cache_key)
    now = time.monotonic()
    if cached and now - cached[0] < PROJECT_MANIFEST_CACHE_TTL_SECONDS:
        return cached[1]

    lines: list[str] = []
    entry_count = 0
    truncated = False

    def walk(directory: Path, root_directory: Path, depth: int, prefix: str) -> None:
        nonlocal entry_count, truncated
        if depth > PROJECT_MANIFEST_MAX_DEPTH or truncated:
            return
        try:
            entries = sorted(directory.iterdir(), key=lambda entry: (not entry.is_dir(), entry.name.casefold()))
        except (OSError, PermissionError):
            return
        for entry in entries:
            if entry_count >= PROJECT_MANIFEST_MAX_ENTRIES:
                truncated = True
                return
            try:
                is_directory = entry.is_dir()
            except OSError:
                continue
            if is_directory and entry.name in IGNORE_DIRS:
                continue
            if entry.name == ".git":
                continue
            line = f"{prefix}{entry.name}{'/' if is_directory else ''}"
            if sum(len(item) + 1 for item in lines) + len(line) > PROJECT_MANIFEST_MAX_CHARS:
                truncated = True
                return
            lines.append(line)
            entry_count += 1
            if is_directory:
                try:
                    stays_in_root = not entry.is_symlink() and entry.resolve().is_relative_to(root_directory)
                except OSError:
                    stays_in_root = False
                if stays_in_root:
                    walk(entry, root_directory, depth + 1, prefix + "  ")

    for folder_id, path in resolved_folders:
        root = Path(path)
        lines.append(f"{folder_id}/")
        if root.is_dir():
            resolved_root = root.resolve()
            walk(resolved_root, resolved_root, 1, "  ")
        else:
            lines.append("  (unavailable)")

    if truncated:
        lines.append("... (manifest truncated)")
    manifest = "\n".join(lines)
    _project_manifest_cache[cache_key] = (now, manifest)
    return manifest

FOLDER_ID_PROPERTY = {
    "type": "string",
    "description": "작업할 프로젝트 소스 폴더 ID. 시스템 프롬프트의 [프로젝트 소스 폴더] 목록에서 선택해야 한다.",
}


def begin_code_change_tracking() -> None:
    """Start a request-local transaction log for code mutation tools."""
    current_code_change_snapshots.set({})


def _record_file_before_change(folder_id: str, relative_path: str) -> None:
    snapshots = current_code_change_snapshots.get()
    folder = current_code_folders.get().get(folder_id)
    if snapshots is None or not folder:
        return
    target = _safe_path(folder, relative_path)
    key = (folder_id, relative_path)
    if not target or key in snapshots:
        return
    try:
        snapshots[key] = target.read_bytes() if target.is_file() else None
    except OSError:
        return


def finalize_code_change_tracking() -> dict | None:
    """Create the UI summary and a guarded, server-side undo transaction."""
    snapshots = current_code_change_snapshots.get()
    if not snapshots:
        return None
    files: list[dict] = []
    undo_files: list[dict] = []
    total_additions = 0
    total_deletions = 0
    folders = current_code_folders.get()
    for (folder_id, relative_path), before_bytes in snapshots.items():
        folder = folders.get(folder_id)
        target = _safe_path(folder, relative_path) if folder else None
        if not target:
            continue
        try:
            after_bytes = target.read_bytes() if target.is_file() else None
        except OSError:
            after_bytes = None
        if before_bytes == after_bytes:
            continue
        before_text = (before_bytes or b"").decode("utf-8", errors="replace")
        after_text = (after_bytes or b"").decode("utf-8", errors="replace")
        diff_lines = list(difflib.unified_diff(
            before_text.splitlines(), after_text.splitlines(),
            fromfile=relative_path, tofile=relative_path, lineterm="",
        ))
        additions = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
        deletions = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))
        total_additions += additions
        total_deletions += deletions
        files.append({
            "folderId": folder_id, "path": relative_path,
            "status": "added" if before_bytes is None else "deleted" if after_bytes is None else "modified",
            "additions": additions, "deletions": deletions, "diff": "\n".join(diff_lines),
        })
        undo_files.append({
            "folder_id": folder_id, "folder": folder, "path": relative_path,
            "before": before_bytes, "after": after_bytes,
        })
    if not files:
        return None
    undo_token = uuid.uuid4().hex
    _code_change_undo_registry[undo_token] = {"files": undo_files, "undone_files": []}
    while len(_code_change_undo_registry) > MAX_UNDO_REGISTRY_ENTRIES:
        _code_change_undo_registry.pop(next(iter(_code_change_undo_registry)))
    return {"files": files, "additions": total_additions, "deletions": total_deletions, "undoToken": undo_token}


def undo_code_changes(
        undo_token: str, folder_id: str | None = None, relative_path: str | None = None,
) -> dict:
    """Undo a whole transaction or one file if its post-change state still matches."""
    transaction = _code_change_undo_registry.get(undo_token)
    if not transaction:
        return {"ok": False, "reason": "not_found"}
    if (folder_id is None) != (relative_path is None):
        return {"ok": False, "reason": "invalid_target"}
    selected_files = transaction["files"]
    if folder_id is not None and relative_path is not None:
        selected_files = [
            item for item in transaction["files"]
            if item["folder_id"] == folder_id and item["path"] == relative_path
        ]
        if not selected_files:
            return {"ok": False, "reason": "not_found"}
    for item in selected_files:
        target = _safe_path(item["folder"], item["path"])
        if not target:
            return {"ok": False, "reason": "conflict", "path": item["path"]}
        current = target.read_bytes() if target.is_file() else None
        if current != item["after"]:
            return {"ok": False, "reason": "conflict", "path": item["path"]}
    for item in selected_files:
        target = _safe_path(item["folder"], item["path"])
        before = item["before"]
        if before is None:
            if target and target.is_file():
                target.unlink()
        elif target:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(before)
    selected_ids = {id(item) for item in selected_files}
    transaction.setdefault("undone_files", []).extend({
        "folderId": item["folder_id"], "path": item["path"]
    } for item in selected_files)
    transaction["files"] = [item for item in transaction["files"] if id(item) not in selected_ids]
    complete = not transaction["files"]
    _project_manifest_cache.clear()
    return {
        "ok": True,
        "complete": complete,
        "files": [{"folderId": item["folder_id"], "path": item["path"]} for item in selected_files],
    }


def get_code_changes_undo_status(undo_token: str) -> dict:
    """Return persisted in-process undo state for history cards."""
    transaction = _code_change_undo_registry.get(undo_token)
    if not transaction:
        return {"available": False, "complete": False, "undoneFiles": []}
    return {
        "available": bool(transaction["files"]),
        "complete": not transaction["files"],
        "undoneFiles": list(transaction.get("undone_files", [])),
    }


def _safe_path(folder: str, rel: str) -> Path | None:
    """폴더 밖으로 나가지 않도록 경로 검증."""
    base = Path(folder).resolve()
    target = (base / rel).resolve()
    if not target.is_relative_to(base):
        return None
    return target


def _resolve_folder(folder_id: str) -> tuple[str | None, str | None]:
    folder = current_code_folders.get().get(folder_id)
    if not folder:
        return None, f"[오류] 허용되지 않았거나 누락된 folder_id입니다: {folder_id}"
    return folder, None


def _confirmation_received(action: str, *paths: str) -> bool:
    """모델의 인자만으로는 파괴적 작업을 승인할 수 없도록 사용자 원문을 검증한다."""
    expected = f"{action} {' -> '.join(paths)}"
    # "DELETE foo 하지 마"처럼 문장에 포함된 경우는 승인으로 보지 않는다.
    return re.search(rf"(?im)^\s*{re.escape(expected)}\s*$", current_code_question.get()) is not None


def _run_command(command: list[str], folder: str, timeout: int = 60) -> str:
    """고정된 명령 배열만 실행하고 출력 길이를 제한한다."""
    executable = shutil.which(command[0])
    if not executable:
        return f"[오류] 실행 명령을 찾을 수 없습니다: {command[0]}"
    resolved_command = [executable, *command[1:]]
    try:
        result = subprocess.run(
            resolved_command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            cwd=folder,
        )
    except subprocess.TimeoutExpired:
        return f"[오류] 검사 시간 초과 ({timeout}초)"
    except FileNotFoundError:
        return f"[오류] 실행 명령을 찾을 수 없습니다: {command[0]}"
    output = (result.stdout + result.stderr).strip()
    if len(output) > 12_000:
        output = output[:12_000] + "\n...(출력 생략)"
    prefix = "✅ 성공" if result.returncode == 0 else f"❌ 실패 (exit {result.returncode})"
    return f"{prefix}: {' '.join(command)}\n{output or '(출력 없음)'}"


async def _list_directory(folder_id: str, path: str = ".", max_depth: int = 3) -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error

    target = _safe_path(folder, path)
    if not target or not target.is_dir():
        return f"[오류] 디렉토리를 찾을 수 없습니다: {path}"

    lines = []
    base = Path(folder).resolve()

    def _walk(p: Path, depth: int, prefix: str = ""):
        if depth > max_depth:
            return
        try:
            entries = sorted(p.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return

        for entry in entries:
            if entry.name.startswith(".") and entry.name in (".git",):
                continue
            if entry.is_dir() and entry.name in IGNORE_DIRS:
                continue

            rel = entry.relative_to(base)
            if entry.is_dir():
                lines.append(f"{prefix}📁 {entry.name}/")
                _walk(entry, depth + 1, prefix + "  ")
            else:
                size = entry.stat().st_size
                if size < 1024:
                    size_str = f"{size}B"
                elif size < 1024 * 1024:
                    size_str = f"{size // 1024}KB"
                else:
                    size_str = f"{size // (1024 * 1024)}MB"
                lines.append(f"{prefix}📄 {entry.name} ({size_str})")

    _walk(target, 0)
    if not lines:
        return f"{path} 디렉토리가 비어 있습니다."
    return "\n".join(lines[:500])


async def _read_file(folder_id: str, path: str, offset: int = 0, limit: int = 1200) -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error

    target = _safe_path(folder, path)
    if not target or not target.is_file():
        return f"[오류] 파일을 찾을 수 없습니다: {path}"

    if target.stat().st_size > MAX_READ_BYTES * 10:
        return f"[오류] 파일이 너무 큽니다 ({target.stat().st_size} bytes). offset/limit으로 부분 읽기해주세요."

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"[오류] 파일 읽기 실패: {e}"

    lines = content.split("\n")
    total = len(lines)
    selected = lines[offset:offset + limit]
    numbered = [f"{i + offset + 1:4d} | {line}" for i, line in enumerate(selected)]
    header = f"파일: {path} (전체 {total}줄, {offset + 1}~{offset + len(selected)}줄 표시)"
    return header + "\n" + "\n".join(numbered)


async def _read_files(folder_id: str, paths: list[str], limit_per_file: int = 500) -> str:
    if not isinstance(paths, list) or not paths:
        return "[오류] 읽을 파일 경로가 필요합니다."
    if len(paths) > MAX_MULTI_READ_FILES:
        return f"[오류] 한 번에 최대 {MAX_MULTI_READ_FILES}개 파일을 읽을 수 있습니다."
    outputs = []
    for path in paths:
        output = await _read_file(folder_id, str(path), 0, limit_per_file)
        outputs.append(output)
    combined = "\n\n---\n\n".join(outputs)
    return combined[:50_000] + ("\n...(출력 생략)" if len(combined) > 50_000 else "")


async def _find_files(folder_id: str, pattern: str = "*", path: str = ".") -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error
    target = _safe_path(folder, path)
    if not target or not target.is_dir():
        return f"[오류] 디렉토리를 찾을 수 없습니다: {path}"
    base = Path(folder).resolve()
    matches: list[str] = []
    for root, directory_names, file_names in os.walk(target):
        directory_names[:] = sorted(name for name in directory_names if name not in IGNORE_DIRS)
        root_path = Path(root)
        for file_name in sorted(file_names):
            relative_path = (root_path / file_name).relative_to(base).as_posix()
            if fnmatch.fnmatch(file_name, pattern) or fnmatch.fnmatch(relative_path, pattern):
                matches.append(relative_path)
                if len(matches) >= MAX_FIND_RESULTS:
                    return "\n".join(matches) + f"\n... (상위 {MAX_FIND_RESULTS}개만 표시)"
    return "\n".join(matches) if matches else f"'{pattern}' 파일 검색 결과 없음"


def _try_indent_correction(
    content: str, old_string: str, new_string: str
) -> tuple[str, str, str] | None:
    """old_string의 들여쓰기가 파일과 다를 때 자동 보정을 시도한다.

    old_string의 각 줄을 strip한 뒤, 파일에서 동일한 strip 내용이
    연속으로 나타나는 블록을 찾는다. 정확히 1곳이면 보정 성공.

    반환: (content, corrected_old, corrected_new) 또는 None
    """
    old_lines = old_string.split("\n")
    # 빈 줄만 있으면 보정 불가
    stripped_old = [l.strip() for l in old_lines]
    non_empty = [s for s in stripped_old if s]
    if not non_empty:
        return None

    content_lines = content.split("\n")
    matches: list[int] = []  # 매칭 시작 줄 인덱스

    for i in range(len(content_lines) - len(old_lines) + 1):
        match = True
        for j, old_stripped in enumerate(stripped_old):
            file_stripped = content_lines[i + j].strip()
            if old_stripped != file_stripped:
                match = False
                break
        if match:
            matches.append(i)

    if len(matches) != 1:
        return None  # 0곳 또는 2곳 이상 — 보정 불가

    start = matches[0]
    # 실제 파일의 원본 블록
    actual_old = "\n".join(content_lines[start:start + len(old_lines)])

    # new_string 들여쓰기 보정:
    # old_string 첫 번째 비빈 줄의 들여쓰기 차이를 계산하여 new_string에 적용
    old_indent = 0
    actual_indent = 0
    for k, ol in enumerate(old_lines):
        if ol.strip():
            old_indent = len(ol) - len(ol.lstrip())
            actual_indent = len(content_lines[start + k]) - len(content_lines[start + k].lstrip())
            break

    indent_diff = actual_indent - old_indent
    if indent_diff == 0:
        return None  # 들여쓰기 차이 없음 — 다른 이유로 매칭 실패

    # new_string의 각 줄에 들여쓰기 차이를 적용
    new_lines = new_string.split("\n")
    corrected_new_lines = []
    for line in new_lines:
        if not line.strip():
            corrected_new_lines.append(line)
        elif indent_diff > 0:
            corrected_new_lines.append(" " * indent_diff + line)
        else:
            # 들여쓰기 줄이기 — 앞에서 빼되 내용까지 침범하지 않음
            remove = min(-indent_diff, len(line) - len(line.lstrip()))
            corrected_new_lines.append(line[remove:])
    corrected_new = "\n".join(corrected_new_lines)

    return content, actual_old, corrected_new


async def _edit_file(folder_id: str, path: str, old_string: str, new_string: str) -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error

    target = _safe_path(folder, path)
    if not target or not target.is_file():
        return f"[오류] 파일을 찾을 수 없습니다: {path}"

    try:
        content = target.read_text(encoding="utf-8")
    except Exception as e:
        return f"[오류] 파일 읽기 실패: {e}"

    count = content.count(old_string)
    if count == 0:
        # ── 들여쓰기 자동 보정 폴백 ──
        # old_string을 각 줄 strip한 뒤 파일에서 연속 매칭되는 블록을 찾는다.
        # 찾으면 실제 파일의 원본(들여쓰기 포함)으로 교체하고,
        # new_string도 같은 들여쓰기로 보정한다.
        corrected = _try_indent_correction(content, old_string, new_string)
        if corrected is not None:
            content, old_string, new_string = corrected
            count = 1
            logger.info("[code_edit] %s 들여쓰기 자동 보정으로 매칭 성공", path)
        else:
            # 자동 보정도 실패 — 유사 위치 힌트 제공
            hint = ""
            stripped = old_string.strip()
            if stripped:
                first_line = stripped.split("\n")[0][:80]
                for i, line in enumerate(content.split("\n"), 1):
                    if first_line in line:
                        indent = len(line) - len(line.lstrip())
                        hint = (f" 힌트: {i}줄에 유사한 내용 발견 (들여쓰기={indent}칸). "
                                f"code_read_file로 해당 줄을 읽고 정확한 들여쓰기로 다시 시도하세요.")
                        break
            msg = f"[오류] old_string을 찾을 수 없습니다.{hint}"
            logger.warning("[code_edit] %s 수정 실패: %s (old_string 첫줄: %r)", path, msg, old_string.split("\n")[0][:100])
            return msg
    if count > 1:
        msg = f"[오류] old_string이 {count}곳에서 발견됩니다. 더 구체적인 문자열을 사용해주세요."
        logger.warning("[code_edit] %s 수정 실패: %s", path, msg)
        return msg

    new_content = content.replace(old_string, new_string, 1)
    _record_file_before_change(folder_id, path)
    try:
        target.write_text(new_content, encoding="utf-8")
    except Exception as e:
        return f"[오류] 파일 쓰기 실패: {e}"

    return f"✅ {path} 수정 완료 (1곳 변경)"


async def _create_file(folder_id: str, path: str, content: str = "") -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error

    target = _safe_path(folder, path)
    if not target:
        return f"[오류] 잘못된 경로: {path}"
    if target.exists():
        return f"[오류] 파일이 이미 존재합니다. 기존 파일은 code_edit_file 또는 code_apply_patch로 수정하세요: {path}"

    _record_file_before_change(folder_id, path)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    except Exception as e:
        return f"[오류] 파일 생성 실패: {e}"

    _project_manifest_cache.clear()
    return f"✅ {path} 생성 완료 ({len(content.split(chr(10)))}줄)"


async def _apply_patch(folder_id: str, patch: str) -> str:
    """Apply a validated unified diff atomically enough to avoid partial patch failures."""
    folder, error = _resolve_folder(folder_id)
    if error:
        return error
    if not patch.strip() or len(patch.encode("utf-8")) > MAX_PATCH_BYTES:
        return f"[오류] patch는 비어 있을 수 없고 최대 {MAX_PATCH_BYTES}바이트여야 합니다."

    base = Path(folder).resolve()
    old_paths = re.findall(r"^---\s+([^\t\n ]+)", patch, re.MULTILINE)
    new_paths = re.findall(r"^\+\+\+\s+([^\t\n ]+)", patch, re.MULTILINE)
    if not new_paths or len(old_paths) != len(new_paths):
        return "[오류] 올바른 unified diff 헤더(---/+++)가 필요합니다."
    for old_path, new_path in zip(old_paths, new_paths):
        if new_path == "/dev/null":
            return "[오류] patch를 통한 파일 삭제는 지원하지 않습니다. code_delete_file을 사용하세요."
        for candidate in (old_path, new_path):
            if candidate == "/dev/null":
                continue
            if candidate.startswith(("/", "a/", "b/")) or ".." in Path(candidate).parts:
                return "[오류] patch 경로는 a/ 또는 b/ 접두사 없는 등록 폴더 기준 상대경로여야 합니다."
            target = (base / candidate).resolve()
            if not target.is_relative_to(base):
                return f"[오류] 등록 폴더 밖의 경로는 수정할 수 없습니다: {candidate}"

    for relative_path in dict.fromkeys(path for path in old_paths + new_paths if path != "/dev/null"):
        _record_file_before_change(folder_id, relative_path)

    git_executable = shutil.which("git")
    if not git_executable:
        return "[오류] patch 적용에 필요한 Git 실행 파일을 찾을 수 없습니다."
    check_command = [git_executable, "apply", "--check", "--recount", "--whitespace=nowarn", "-p0", "-"]
    apply_command = [git_executable, "apply", "--recount", "--whitespace=nowarn", "-p0", "-"]
    try:
        dry_run = subprocess.run(
            check_command,
            input=patch,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            cwd=str(base),
        )
        if dry_run.returncode != 0:
            return f"[오류] patch 사전 검증 실패:\n{(dry_run.stdout + dry_run.stderr).strip()[:12_000]}"
        applied = subprocess.run(
            apply_command,
            input=patch,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            cwd=str(base),
        )
        output = (applied.stdout + applied.stderr).strip()
        if applied.returncode != 0:
            return f"[오류] patch 적용 실패:\n{output[:12_000]}"
        _project_manifest_cache.clear()
        return f"✅ patch 적용 완료\n{output[:12_000]}"
    except (OSError, subprocess.TimeoutExpired) as exc:
        return f"[오류] patch 실행 실패: {exc}"


async def _grep_search(folder_id: str, pattern: str, path: str = ".", include: str = "") -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error

    target = _safe_path(folder, path)
    if not target or not target.exists():
        return f"[오류] 경로를 찾을 수 없습니다: {path}"

    try:
        search_pattern = re.compile(pattern)
    except re.error as exc:
        return f"[오류] 잘못된 검색 정규식입니다: {exc}"

    base = Path(folder).resolve()
    search_targets: list[Path] = []
    if target.is_file():
        search_targets.append(target)
    elif target.is_dir():
        for root, directory_names, file_names in os.walk(target):
            directory_names[:] = sorted(name for name in directory_names if name not in IGNORE_DIRS)
            root_path = Path(root)
            for file_name in sorted(file_names):
                file_path = root_path / file_name
                relative_path = file_path.relative_to(base).as_posix()
                if include and not (
                    fnmatch.fnmatch(file_name, include) or fnmatch.fnmatch(relative_path, include)
                ):
                    continue
                search_targets.append(file_path)

    matches: list[str] = []
    total_matches = 0
    for file_path in search_targets:
        try:
            if file_path.stat().st_size > MAX_READ_BYTES * 10:
                continue
            content = file_path.read_text(encoding="utf-8", errors="replace")
        except (OSError, UnicodeError):
            continue
        relative_path = file_path.relative_to(base).as_posix()
        for line_number, line in enumerate(content.splitlines(), 1):
            if not search_pattern.search(line):
                continue
            total_matches += 1
            if len(matches) < MAX_GREP_RESULTS:
                matches.append(f"{relative_path}:{line_number}:{line}")

    if not matches:
        return f"'{pattern}' 검색 결과 없음"

    header = f"'{pattern}' 검색 결과 ({total_matches}건"
    if total_matches > MAX_GREP_RESULTS:
        header += f", 상위 {MAX_GREP_RESULTS}건 표시"
    header += ")"
    return header + "\n" + "\n".join(matches)


def _discover_project_tasks(folder: str) -> list[dict[str, str]]:
    base = Path(folder).resolve()
    tasks: list[dict[str, str]] = []
    for root, directory_names, file_names in os.walk(base):
        root_path = Path(root)
        try:
            depth = len(root_path.relative_to(base).parts)
        except ValueError:
            continue
        if depth >= MAX_TASK_CONFIG_DEPTH:
            directory_names[:] = []
        else:
            directory_names[:] = sorted(name for name in directory_names if name not in IGNORE_DIRS)
        working_directory = root_path.relative_to(base).as_posix() or "."
        if "package.json" in file_names:
            try:
                scripts = json.loads((root_path / "package.json").read_text(encoding="utf-8")).get("scripts", {})
            except (OSError, json.JSONDecodeError):
                scripts = {}
            if isinstance(scripts, dict):
                tasks.extend({
                    "working_directory": working_directory,
                    "task": str(name),
                    "command": f"npm run {name}",
                } for name in sorted(scripts))
        has_python_config = "pyproject.toml" in file_names or "pytest.ini" in file_names
        if has_python_config:
            tasks.append({"working_directory": working_directory, "task": "python:test", "command": "pytest"})
            if "pyproject.toml" in file_names:
                tasks.extend([
                    {"working_directory": working_directory, "task": "python:lint", "command": "ruff check ."},
                    {"working_directory": working_directory, "task": "python:typecheck", "command": "mypy ."},
                    {"working_directory": working_directory, "task": "python:compile", "command": "python -m compileall -q ."},
                ])
    return tasks


async def _list_tasks(folder_id: str) -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error
    tasks = _discover_project_tasks(folder)
    if not tasks:
        return "실행 가능한 프로젝트 작업을 찾지 못했습니다."
    return "\n".join(
        f"- working_directory={task['working_directory']} | task={task['task']} | {task['command']}"
        for task in tasks
    )


async def _run_task(folder_id: str, working_directory: str, task: str) -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error
    target = _safe_path(folder, working_directory)
    if not target or not target.is_dir():
        return f"[오류] 작업 디렉토리를 찾을 수 없습니다: {working_directory}"
    normalized_directory = target.relative_to(Path(folder).resolve()).as_posix() or "."
    discovered = _discover_project_tasks(folder)
    selected = next((item for item in discovered if item["working_directory"] == normalized_directory and item["task"] == task), None)
    if not selected:
        return "[오류] 등록된 프로젝트 설정에서 해당 작업을 찾을 수 없습니다. code_list_tasks로 실행 가능한 작업을 먼저 확인하세요."
    if task.startswith("python:"):
        commands = {
            "python:test": [sys.executable, "-m", "pytest"],
            "python:lint": [sys.executable, "-m", "ruff", "check", "."],
            "python:typecheck": [sys.executable, "-m", "mypy", "."],
            "python:compile": [sys.executable, "-m", "compileall", "-q", "."],
        }
        command = commands[task]
    else:
        command = ["npm", "run", task]
    return _run_command(command, str(target), timeout=120)


async def _run_project_check(folder_id: str, check: str, working_directory: str = ".") -> str:
    """Run a conventional check only when declared by the project configuration."""
    folder, error = _resolve_folder(folder_id)
    if error:
        return error
    target = _safe_path(folder, working_directory)
    if not target or not target.is_dir():
        return f"[오류] 작업 디렉토리를 찾을 수 없습니다: {working_directory}"
    package_json = target / "package.json"
    if not package_json.is_file():
        python_task = f"python:{'compile' if check == 'build' else check}"
        return await _run_task(folder_id, working_directory, python_task)
    try:
        scripts = json.loads(package_json.read_text(encoding="utf-8")).get("scripts", {})
    except Exception as e:
        return f"[오류] package.json을 읽을 수 없습니다: {e}"
    script_name = {"test": "test", "lint": "lint", "typecheck": "typecheck", "build": "build"}.get(check)
    if not script_name:
        return "[오류] check은 test, lint, typecheck, build 중 하나여야 합니다."
    if script_name not in scripts:
        return f"[오류] package.json에 '{script_name}' script가 없습니다."
    return await _run_task(folder_id, working_directory, script_name)


async def _git_status(folder_id: str) -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error
    return _run_command(["git", "status", "--short", "--branch"], folder, timeout=15)


async def _git_diff(folder_id: str, path: str = "") -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error
    command = ["git", "diff", "--stat", "--", path] if path else ["git", "diff", "--stat"]
    stat = _run_command(command, folder, timeout=15)
    detail_command = ["git", "diff", "--", path] if path else ["git", "diff"]
    return stat + "\n\n" + _run_command(detail_command, folder, timeout=15)


async def _move_file(folder_id: str, source: str, destination: str) -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error
    if not _confirmation_received("MOVE", source, destination):
        return f"[확인 필요] 파일 이동은 되돌리기 어려울 수 있습니다. 사용자에게 다음 문구를 입력해 달라고 요청하세요: MOVE {source} -> {destination}"
    src, dest = _safe_path(folder, source), _safe_path(folder, destination)
    if not src or not dest or not src.is_file():
        return "[오류] 원본 파일을 찾을 수 없거나 허용되지 않은 경로입니다."
    if dest.exists():
        return "[오류] 대상 파일이 이미 존재합니다. 덮어쓰지는 지원하지 않습니다."
    _record_file_before_change(folder_id, source)
    _record_file_before_change(folder_id, destination)
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dest)
    except Exception as e:
        return f"[오류] 파일 이동 실패: {e}"
    _project_manifest_cache.clear()
    return f"✅ 파일 이동 완료: {source} → {destination}"


async def _delete_file(folder_id: str, path: str) -> str:
    folder, error = _resolve_folder(folder_id)
    if error:
        return error
    if not _confirmation_received("DELETE", path):
        return f"[확인 필요] 삭제는 복구할 수 없습니다. 사용자에게 다음 문구를 입력해 달라고 요청하세요: DELETE {path}"
    target = _safe_path(folder, path)
    if not target or not target.is_file():
        return "[오류] 파일을 찾을 수 없거나 허용되지 않은 경로입니다."
    _record_file_before_change(folder_id, path)
    try:
        target.unlink()
    except Exception as e:
        return f"[오류] 파일 삭제 실패: {e}"
    _project_manifest_cache.clear()
    return f"✅ 파일 삭제 완료: {path}"


def register_code_tools():
    """MCP 매니저에 코드 분석 tool들을 내부 tool로 등록한다."""
    from services.mcp_client import mcp_manager

    mcp_manager.register_internal_tool(
        name="code_list_directory",
        description="코드 폴더 내 디렉토리 구조를 조회한다. path는 첨부된 폴더 기준 상대경로.",
        parameters={
            "type": "object",
            "properties": {
                "folder_id": FOLDER_ID_PROPERTY,
                "path": {
                    "type": "string",
                    "description": "조회할 디렉토리 상대경로 (기본: '.' = 루트)",
                    "default": ".",
                },
                "max_depth": {
                    "type": "integer",
                    "description": "탐색 깊이 (기본: 3)",
                    "default": 3,
                },
            }, "required": ["folder_id"],
        },
        handler=_list_directory,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_read_file",
        description="코드 폴더 내 파일 내용을 읽는다. 줄번호가 표시된다.",
        parameters={
            "type": "object",
            "properties": {
                "folder_id": FOLDER_ID_PROPERTY,
                "path": {
                    "type": "string",
                    "description": "읽을 파일의 상대경로",
                },
                "offset": {
                    "type": "integer",
                    "description": "시작 줄 번호 (0부터, 기본: 0)",
                    "default": 0,
                },
                "limit": {
                    "type": "integer",
                    "description": "읽을 줄 수 (기본: 1200)",
                    "default": 1200,
                },
            },
            "required": ["folder_id", "path"],
        },
        handler=_read_file,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_read_files",
        description="여러 코드 파일을 한 번에 읽는다. 서로 관련된 파일을 함께 분석할 때 사용한다.",
        parameters={"type": "object", "properties": {
            "folder_id": FOLDER_ID_PROPERTY,
            "paths": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_MULTI_READ_FILES},
            "limit_per_file": {"type": "integer", "default": 500, "minimum": 1, "maximum": 1200},
        }, "required": ["folder_id", "paths"]},
        handler=_read_files,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_find_files",
        description="파일명 또는 등록 폴더 기준 상대경로 glob으로 파일을 찾는다. 예: '*.tsx', 'frontend/src/**/*.ts'.",
        parameters={"type": "object", "properties": {
            "folder_id": FOLDER_ID_PROPERTY,
            "pattern": {"type": "string", "description": "파일명 또는 상대경로 glob"},
            "path": {"type": "string", "default": ".", "description": "검색 시작 디렉토리"},
        }, "required": ["folder_id", "pattern"]},
        handler=_find_files,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_edit_file",
        description=(
            "한 파일의 한두 줄처럼 짧고 고유한 문자열을 수정한다. old_string을 찾아 new_string으로 "
            "교체하며, old_string은 공백과 들여쓰기를 포함해 파일 내 정확히 1곳과 일치해야 한다. "
            "함수·클래스 단위, 여러 블록 또는 여러 파일 변경에는 code_apply_patch를 사용한다. "
            "문자열 불일치로 실패하면 같은 호출을 반복하지 말고 파일을 다시 읽은 뒤 code_apply_patch로 전환한다."
        ),
        parameters={
            "type": "object",
            "properties": {
                "folder_id": FOLDER_ID_PROPERTY,
                "path": {
                    "type": "string",
                    "description": "수정할 파일의 상대경로",
                },
                "old_string": {
                    "type": "string",
                    "description": "찾아서 교체할 기존 문자열 (정확히 일치해야 함)",
                },
                "new_string": {
                    "type": "string",
                    "description": "교체할 새 문자열",
                },
            },
            "required": ["folder_id", "path", "old_string", "new_string"],
        },
        handler=_edit_file,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_create_file",
        description=(
            "코드 폴더 내에 새 파일을 생성한다. 중간 디렉토리는 자동으로 생성된다. "
            "사용자가 파일 내용 없이 생성만 요청한 경우 content를 생략하면 빈 파일을 생성한다."
        ),
        parameters={
            "type": "object",
            "properties": {
                "folder_id": FOLDER_ID_PROPERTY,
                "path": {
                    "type": "string",
                    "description": "생성할 파일의 상대경로",
                },
                "content": {
                    "type": "string",
                    "description": "파일 내용. 생략하면 빈 파일을 생성한다.",
                    "default": "",
                },
            },
            "required": ["folder_id", "path"],
        },
        handler=_create_file,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_apply_patch",
        description=(
            "함수·클래스 단위, 여러 코드 블록 또는 여러 파일의 변경을 unified diff로 적용한다. "
            "a/·b/ 접두사 없는 상대경로를 사용하며, 실제 수정 전에 전체 patch를 사전 검증한다. "
            "code_edit_file이 문자열 불일치나 들여쓰기로 실패한 경우 대상 구간을 다시 읽고 이 도구로 전환한다. "
            "파일 삭제는 지원하지 않는다."
        ),
        parameters={"type": "object", "properties": {
            "folder_id": FOLDER_ID_PROPERTY,
            "patch": {"type": "string", "description": "등록 폴더 기준 상대경로를 사용하는 unified diff"},
        }, "required": ["folder_id", "patch"]},
        handler=_apply_patch,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_grep_search",
        description="코드 폴더 내에서 텍스트/정규식 패턴을 재귀 검색한다. 파일명과 줄번호가 표시된다.",
        parameters={
            "type": "object",
            "properties": {
                "folder_id": FOLDER_ID_PROPERTY,
                "pattern": {
                    "type": "string",
                    "description": "검색할 텍스트 또는 정규식 패턴",
                },
                "path": {
                    "type": "string",
                    "description": "검색 범위 디렉토리 상대경로 (기본: '.' = 전체)",
                    "default": ".",
                },
                "include": {
                    "type": "string",
                    "description": "파일 패턴 필터 (예: '*.py', '*.tsx')",
                    "default": "",
                },
            },
            "required": ["folder_id", "pattern"],
        },
        handler=_grep_search,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_run_check",
        description="지정한 하위 프로젝트에서 등록된 검사(test, lint, typecheck, build)를 실행한다. 임의 명령 실행은 지원하지 않는다.",
        parameters={"type": "object", "properties": {"folder_id": FOLDER_ID_PROPERTY, "check": {"type": "string", "enum": ["test", "lint", "typecheck", "build"]}, "working_directory": {"type": "string", "default": ".", "description": "등록 폴더 내부의 상대 작업 디렉토리"}}, "required": ["folder_id", "check"]},
        handler=_run_project_check,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_list_tasks",
        description="등록 폴더와 하위 프로젝트의 package.json·pyproject.toml을 찾아 안전하게 실행 가능한 작업을 나열한다.",
        parameters={"type": "object", "properties": {"folder_id": FOLDER_ID_PROPERTY}, "required": ["folder_id"]},
        handler=_list_tasks,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_run_task",
        description="code_list_tasks가 발견한 package script 또는 Python 검사 작업만 해당 하위 프로젝트에서 실행한다.",
        parameters={"type": "object", "properties": {
            "folder_id": FOLDER_ID_PROPERTY,
            "working_directory": {"type": "string", "description": "code_list_tasks 결과의 상대 작업 디렉토리"},
            "task": {"type": "string", "description": "code_list_tasks 결과의 task 값"},
        }, "required": ["folder_id", "working_directory", "task"]},
        handler=_run_task,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_git_status",
        description="현재 코드 폴더의 git branch와 변경 파일 상태를 조회한다.",
        parameters={"type": "object", "properties": {"folder_id": FOLDER_ID_PROPERTY}, "required": ["folder_id"]},
        handler=_git_status,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_git_diff",
        description="현재 코드 폴더의 git diff를 조회한다. path를 주면 해당 파일만 조회한다.",
        parameters={"type": "object", "properties": {"folder_id": FOLDER_ID_PROPERTY, "path": {"type": "string", "description": "상대 파일 경로(선택)"}}, "required": ["folder_id"]},
        handler=_git_diff,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_move_file",
        description="파일을 이동한다. 사용자 메시지에 정확히 'MOVE 원본 -> 대상' 확인 문구가 있어야 실행된다. 기존 파일 덮어쓰기는 하지 않는다.",
        parameters={"type": "object", "properties": {"folder_id": FOLDER_ID_PROPERTY, "source": {"type": "string"}, "destination": {"type": "string"}}, "required": ["folder_id", "source", "destination"]},
        handler=_move_file,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_delete_file",
        description="파일을 삭제한다. 사용자 메시지에 정확히 'DELETE 상대경로' 확인 문구가 있어야 실행된다.",
        parameters={"type": "object", "properties": {"folder_id": FOLDER_ID_PROPERTY, "path": {"type": "string"}}, "required": ["folder_id", "path"]},
        handler=_delete_file,
        server_type="code_tools",
    )

    logger.info("[code_tools] 15 code analysis tools registered")
