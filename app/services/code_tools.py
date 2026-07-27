"""
services/code_tools.py — 코드 분석 tool (폴더 첨부 시 활성화)

사용자가 채팅에 폴더를 첨부하면, LLM이 해당 폴더 내 파일을 탐색·읽기·수정·검색할 수 있도록
내부 tool을 등록한다. 폴더 경로는 요청별 ContextVar로 관리된다.
"""
import os
import re
import subprocess
from contextvars import ContextVar
from pathlib import Path

from logger import get_logger

logger = get_logger(__name__)

# 요청별 폴더 경로
current_code_folder: ContextVar[str] = ContextVar("current_code_folder", default="")
# 삭제/이동은 이 요청의 사용자 원문에 명시적인 확인 문구가 있어야만 실행한다.
current_code_question: ContextVar[str] = ContextVar("current_code_question", default="")

# 읽기 제한
MAX_READ_BYTES = 100_000  # 100KB
MAX_GREP_RESULTS = 50

# 무시할 디렉토리
IGNORE_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build",
    ".next", ".nuxt", ".cache", ".idea", ".vscode", "coverage", ".pytest_cache",
    "egg-info", ".tox", ".mypy_cache",
}


def _safe_path(folder: str, rel: str) -> Path | None:
    """폴더 밖으로 나가지 않도록 경로 검증."""
    base = Path(folder).resolve()
    target = (base / rel).resolve()
    if not target.is_relative_to(base):
        return None
    return target


def _confirmation_received(action: str, *paths: str) -> bool:
    """모델의 인자만으로는 파괴적 작업을 승인할 수 없도록 사용자 원문을 검증한다."""
    expected = f"{action} {' -> '.join(paths)}"
    # "DELETE foo 하지 마"처럼 문장에 포함된 경우는 승인으로 보지 않는다.
    return re.search(rf"(?im)^\s*{re.escape(expected)}\s*$", current_code_question.get()) is not None


def _run_command(command: list[str], folder: str, timeout: int = 60) -> str:
    """고정된 명령 배열만 실행하고 출력 길이를 제한한다."""
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, cwd=folder)
    except subprocess.TimeoutExpired:
        return f"[오류] 검사 시간 초과 ({timeout}초)"
    except FileNotFoundError:
        return f"[오류] 실행 명령을 찾을 수 없습니다: {command[0]}"
    output = (result.stdout + result.stderr).strip()
    if len(output) > 12_000:
        output = output[:12_000] + "\n...(출력 생략)"
    prefix = "✅ 성공" if result.returncode == 0 else f"❌ 실패 (exit {result.returncode})"
    return f"{prefix}: {' '.join(command)}\n{output or '(출력 없음)'}"


async def _list_directory(path: str = ".", max_depth: int = 3) -> str:
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."

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


async def _read_file(path: str, offset: int = 0, limit: int = 1200) -> str:
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."

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


async def _edit_file(path: str, old_string: str, new_string: str) -> str:
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."

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
    try:
        target.write_text(new_content, encoding="utf-8")
    except Exception as e:
        return f"[오류] 파일 쓰기 실패: {e}"

    return f"✅ {path} 수정 완료 (1곳 변경)"


async def _create_file(path: str, content: str) -> str:
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."

    target = _safe_path(folder, path)
    if not target:
        return f"[오류] 잘못된 경로: {path}"

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    except Exception as e:
        return f"[오류] 파일 생성 실패: {e}"

    return f"✅ {path} 생성 완료 ({len(content.split(chr(10)))}줄)"


async def _grep_search(pattern: str, path: str = ".", include: str = "") -> str:
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."

    target = _safe_path(folder, path)
    if not target or not target.exists():
        return f"[오류] 경로를 찾을 수 없습니다: {path}"

    cmd = ["grep", "-rn", "--color=never"]

    # 무시 디렉토리
    for d in IGNORE_DIRS:
        cmd.extend(["--exclude-dir", d])

    if include:
        cmd.extend(["--include", include])

    cmd.extend([pattern, str(target)])

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=10,
            cwd=str(Path(folder).resolve()),
        )
        output = result.stdout.strip()
    except subprocess.TimeoutExpired:
        return "[오류] 검색 시간 초과 (10초)"
    except Exception as e:
        return f"[오류] 검색 실패: {e}"

    if not output:
        return f"'{pattern}' 검색 결과 없음"

    lines = output.split("\n")
    # 경로를 상대경로로 변환
    base = str(Path(folder).resolve())
    cleaned = []
    for line in lines[:MAX_GREP_RESULTS]:
        cleaned.append(line.replace(base + "/", ""))

    header = f"'{pattern}' 검색 결과 ({len(lines)}건"
    if len(lines) > MAX_GREP_RESULTS:
        header += f", 상위 {MAX_GREP_RESULTS}건 표시"
    header += ")"
    return header + "\n" + "\n".join(cleaned)


async def _run_project_check(check: str) -> str:
    """test/lint/typecheck/build만 허용한다. 임의 shell command는 실행하지 않는다."""
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."
    package_json = Path(folder) / "package.json"
    if not package_json.is_file():
        python_commands = {
            "test": ["pytest"],
            "lint": ["ruff", "check", "."],
            "typecheck": ["mypy", "."],
        }
        command = python_commands.get(check)
        if command and ((Path(folder) / "pyproject.toml").is_file() or (Path(folder) / "pytest.ini").is_file()):
            return _run_command(command, folder)
        return "[오류] 검사 설정을 찾을 수 없습니다. package.json script 또는 pyproject.toml/pytest.ini가 필요합니다."
    try:
        import json
        scripts = json.loads(package_json.read_text(encoding="utf-8")).get("scripts", {})
    except Exception as e:
        return f"[오류] package.json을 읽을 수 없습니다: {e}"
    script_name = {"test": "test", "lint": "lint", "typecheck": "typecheck", "build": "build"}.get(check)
    if not script_name:
        return "[오류] check은 test, lint, typecheck, build 중 하나여야 합니다."
    if script_name not in scripts:
        return f"[오류] package.json에 '{script_name}' script가 없습니다."
    return _run_command(["npm", "run", script_name], folder)


async def _git_status() -> str:
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."
    return _run_command(["git", "status", "--short", "--branch"], folder, timeout=15)


async def _git_diff(path: str = "") -> str:
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."
    command = ["git", "diff", "--stat", "--", path] if path else ["git", "diff", "--stat"]
    stat = _run_command(command, folder, timeout=15)
    detail_command = ["git", "diff", "--", path] if path else ["git", "diff"]
    return stat + "\n\n" + _run_command(detail_command, folder, timeout=15)


async def _move_file(source: str, destination: str) -> str:
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."
    if not _confirmation_received("MOVE", source, destination):
        return f"[확인 필요] 파일 이동은 되돌리기 어려울 수 있습니다. 사용자에게 다음 문구를 입력해 달라고 요청하세요: MOVE {source} -> {destination}"
    src, dest = _safe_path(folder, source), _safe_path(folder, destination)
    if not src or not dest or not src.is_file():
        return "[오류] 원본 파일을 찾을 수 없거나 허용되지 않은 경로입니다."
    if dest.exists():
        return "[오류] 대상 파일이 이미 존재합니다. 덮어쓰지는 지원하지 않습니다."
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dest)
    except Exception as e:
        return f"[오류] 파일 이동 실패: {e}"
    return f"✅ 파일 이동 완료: {source} → {destination}"


async def _delete_file(path: str) -> str:
    folder = current_code_folder.get()
    if not folder:
        return "[오류] 코드 폴더가 설정되지 않았습니다."
    if not _confirmation_received("DELETE", path):
        return f"[확인 필요] 삭제는 복구할 수 없습니다. 사용자에게 다음 문구를 입력해 달라고 요청하세요: DELETE {path}"
    target = _safe_path(folder, path)
    if not target or not target.is_file():
        return "[오류] 파일을 찾을 수 없거나 허용되지 않은 경로입니다."
    try:
        target.unlink()
    except Exception as e:
        return f"[오류] 파일 삭제 실패: {e}"
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
            },
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
            "required": ["path"],
        },
        handler=_read_file,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_edit_file",
        description="코드 폴더 내 파일을 수정한다. old_string을 찾아 new_string으로 교체한다. old_string은 파일 내에 정확히 1곳만 존재해야 한다.",
        parameters={
            "type": "object",
            "properties": {
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
            "required": ["path", "old_string", "new_string"],
        },
        handler=_edit_file,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_create_file",
        description="코드 폴더 내에 새 파일을 생성한다. 중간 디렉토리는 자동으로 생성된다.",
        parameters={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "생성할 파일의 상대경로",
                },
                "content": {
                    "type": "string",
                    "description": "파일 내용",
                },
            },
            "required": ["path", "content"],
        },
        handler=_create_file,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_grep_search",
        description="코드 폴더 내에서 텍스트/정규식 패턴을 검색한다 (grep). 파일명과 줄번호가 표시된다.",
        parameters={
            "type": "object",
            "properties": {
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
            "required": ["pattern"],
        },
        handler=_grep_search,
        server_type="code_tools",
    )

    mcp_manager.register_internal_tool(
        name="code_run_check",
        description="프로젝트의 등록된 검사(test, lint, typecheck, build)를 실행한다. 임의 명령 실행은 지원하지 않는다.",
        parameters={"type": "object", "properties": {"check": {"type": "string", "enum": ["test", "lint", "typecheck", "build"]}}, "required": ["check"]},
        handler=_run_project_check,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_git_status",
        description="현재 코드 폴더의 git branch와 변경 파일 상태를 조회한다.",
        parameters={"type": "object", "properties": {}},
        handler=_git_status,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_git_diff",
        description="현재 코드 폴더의 git diff를 조회한다. path를 주면 해당 파일만 조회한다.",
        parameters={"type": "object", "properties": {"path": {"type": "string", "description": "상대 파일 경로(선택)"}}},
        handler=_git_diff,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_move_file",
        description="파일을 이동한다. 사용자 메시지에 정확히 'MOVE 원본 -> 대상' 확인 문구가 있어야 실행된다. 기존 파일 덮어쓰기는 하지 않는다.",
        parameters={"type": "object", "properties": {"source": {"type": "string"}, "destination": {"type": "string"}}, "required": ["source", "destination"]},
        handler=_move_file,
        server_type="code_tools",
    )
    mcp_manager.register_internal_tool(
        name="code_delete_file",
        description="파일을 삭제한다. 사용자 메시지에 정확히 'DELETE 상대경로' 확인 문구가 있어야 실행된다.",
        parameters={"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
        handler=_delete_file,
        server_type="code_tools",
    )

    logger.info("[code_tools] 10 code analysis tools registered")
