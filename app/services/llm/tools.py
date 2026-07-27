"""
services/llm/tools.py — MCP tool을 provider별 스키마로 변환 + tool 사용 지시문

mcp_manager.get_ollama_tools()가 반환하는 통일 형식
  {"type":"function","function":{"name","description","parameters"}}
을 각 provider(function-calling)의 스키마로 변환한다.

- OpenAI : tools=[{type:function, function:{name,description,parameters}}]  (통일형과 동일)
- Gemini : tools=[{functionDeclarations:[{name,description,parameters}]}]
- Claude : tools=[{name,description,input_schema}]
"""
from .config import logger


async def build_tool_directive(tool_names: list[str]) -> str:
    """작은/일반 모델이 tool을 확실히 호출하도록 유도하는 system 지시문.

    ollama 경로의 _resolve_tool_calls와 동일한 문구를 공통으로 쓴다.
    GitHub tool이 있으면 사용자 username을 주입해 '내 저장소' 요청을 지원한다.

    이 directive는 system 메시지 맨 끝, user 메시지 바로 앞에 붙는다. 작은 모델일수록
    프롬프트 앞쪽보다 이 위치의 지시를 더 강하게 따르는 경향이 있어서, 켜진 MCP
    서버들의 사용자 지정 프롬프트(get_active_mcp_prompt)를 여기에도 다시 이어붙인다.
    build_system_message가 이미 맨 앞에 주입했더라도, 프로필/포맷 규칙 같은 긴
    텍스트에 묻혀 무시되는 걸 방지하기 위함이다.
    """
    directive = (
        "\n\n[중요 — 도구 사용 규칙]\n"
        "너는 아래 도구(tool)로 실시간 데이터를 직접 조회할 수 있다. "
        "사용자가 파일, GitHub 저장소/이슈/PR, 날씨, 경제·무역 지표, 관광 정보, "
        "미국 주식 등 도구로 얻을 수 있는 정보를 요청하면, 반드시 해당 도구를 호출해서 "
        "실제 데이터를 가져와라. '접근 권한이 없다'거나 'API로 조회하는 방법'을 설명하지 "
        "마라 — 네가 직접 도구를 호출하면 된다.\n"
        f"사용 가능한 도구: {', '.join(tool_names)}"
    )
    # @로 특정 MCP를 고른 경우에는 일반적인 '필요할 때 사용'보다 강하게 유도한다.
    # 단, 도구와 무관한 질문까지 억지로 호출하지 않도록 조건부 표현은 유지한다.
    selected_server_ids = None
    try:
        from services.mcp_client import mcp_manager
        selected_server_ids = mcp_manager.get_request_scope_server_ids()
        if mcp_manager.has_request_scope():
            directive += (
                "\n\n[사용자가 명시적으로 선택한 MCP]\n"
                "사용자는 이 요청에서 위 MCP 도구를 직접 선택했다. 질문과 조금이라도 관련이 있거나 "
                "도구로 사실을 확인·조회·작업할 수 있다면, 답변 전에 해당 도구를 적극적으로 호출해라. "
                "도구 결과를 근거로 답하고, 일반 지식만으로 추측해 끝내지 마라. "
                "단, 질문과 명백히 무관한 경우에는 불필요한 호출을 하지 않아도 된다."
            )
    except Exception as _scope_error:
        logger.debug("[tools] 선택 MCP 지시 확인 실패: %s", _scope_error)
    if any(n.startswith("github_") for n in tool_names):
        try:
            from services.mcp_config import get_github_username
            gh_user = await get_github_username()
            if gh_user:
                directive += (
                    f"\n사용자의 GitHub 아이디는 '{gh_user}'다. "
                    f"'내 저장소', '내 프로젝트', '내 레포', '내 XX 저장소' 같은 요청에서 "
                    f"owner는 항상 '{gh_user}'로 간주해라. "
                    f"예: '내 vyact 저장소' → owner='{gh_user}', repo='vyact'. "
                    f"저장소명이나 소유자를 사용자에게 되묻지 말고 바로 tool을 호출해라."
                    f"\n코드 수정·PR 요청 시: get_file_contents → create_branch → "
                    f"create_or_update_file → create_pull_request 순서로 tool을 호출해라."
                )
        except Exception as _ge:
            logger.debug("[tools] github username 주입 실패: %s", _ge)

    # 코드 분석 폴더가 설정돼 있으면 코드 도구 사용 지시 추가
    if any(n.startswith("code_") for n in tool_names):
        try:
            from services.code_tools import current_code_folder
            folder = current_code_folder.get()
            if folder:
                import os
                folder_name = os.path.basename(folder.rstrip("/"))
                directive += (
                    f"\n\n[코드 분석 모드 — 반드시 tool로 직접 수정]\n"
                    f"사용자가 '{folder_name}' 폴더를 첨부했다. "
                    f"코드 관련 질문이면 code_list_directory, code_read_file, code_grep_search로 "
                    f"코드를 탐색해라. "
                    f"수정 요청이면 반드시 code_edit_file tool을 호출해서 실제 파일을 직접 수정해라. "
                    f"절대로 수정된 코드를 텍스트로만 보여주고 끝내지 마라. "
                    f"code_read_file로 먼저 해당 부분을 읽고, code_edit_file의 old_string/new_string으로 정확히 교체해라. "
                    f"old_string은 들여쓰기(공백/탭)까지 파일 원본과 정확히 일치해야 한다. "
                    f"code_read_file 출력의 줄번호 뒤 '|' 다음이 실제 내용이니, 그 들여쓰기를 그대로 복사해라. "
                    f"edit 실패 시 code_read_file로 해당 줄을 다시 읽어 들여쓰기를 확인하고 재시도해라. "
                    f"같은 edit을 2회 이상 반복 실패하면 멈추고 사용자에게 상황을 알려라. "
                    f"새 파일은 code_create_file로 생성해라. "
                    f"수정 뒤에는 code_git_diff로 변경 내용을 확인하고, 가능하면 code_run_check으로 test/lint/typecheck를 실행해라. "
                    f"파일 이동과 삭제는 위험 작업이다. 절대로 즉시 실행하지 말고, 먼저 영향과 대상 경로를 설명한 뒤 "
                    f"사용자에게 정확한 확인 문구(MOVE 원본 -> 대상 또는 DELETE 상대경로)를 다음 메시지로 받으면 실행해라. "
                    f"path 인자는 항상 폴더 기준 상대경로를 사용해라."
                )
        except Exception:
            pass

    try:
        from services.mcp_config import get_active_mcp_prompt
        extra = await get_active_mcp_prompt(selected_server_ids)
        if extra:
            directive += f"\n\n{extra}"
    except Exception as _pe:
        logger.debug("[tools] MCP 프롬프트 재주입 실패: %s", _pe)

    return directive


def to_openai_tools(unified: list[dict]) -> list[dict]:
    """통일형 → OpenAI tools (형식이 사실상 동일하지만 안전하게 재구성)."""
    out = []
    for t in unified:
        fn = t.get("function", {})
        out.append({
            "type": "function",
            "function": {
                "name": fn.get("name"),
                "description": fn.get("description", ""),
                "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
            },
        })
    return out


def to_gemini_tools(unified: list[dict]) -> list[dict]:
    """통일형 → Gemini tools[{functionDeclarations:[...]}].

    Gemini는 parameters의 JSON Schema에서 지원하지 않는 키가 있으면 400을 낸다.
    안전하게 type/properties/required/description/items/enum만 남긴다.
    """
    decls = []
    for t in unified:
        fn = t.get("function", {})
        decls.append({
            "name": fn.get("name"),
            "description": fn.get("description", ""),
            "parameters": _sanitize_gemini_schema(fn.get("parameters") or {"type": "object", "properties": {}}),
        })
    return [{"functionDeclarations": decls}]


def _sanitize_gemini_schema(schema: dict) -> dict:
    """Gemini functionDeclarations가 받아들이는 키만 남긴 JSON Schema로 정제."""
    if not isinstance(schema, dict):
        return {"type": "object", "properties": {}}
    allowed = {"type", "description", "enum", "properties", "required", "items", "nullable"}
    out: dict = {}
    for k, v in schema.items():
        if k not in allowed:
            continue
        if k == "properties" and isinstance(v, dict):
            out[k] = {pk: _sanitize_gemini_schema(pv) for pk, pv in v.items()}
        elif k == "items" and isinstance(v, dict):
            out[k] = _sanitize_gemini_schema(v)
        else:
            out[k] = v
    if out.get("type") == "object" and "properties" not in out:
        out["properties"] = {}
    return out


def to_claude_tools(unified: list[dict]) -> list[dict]:
    """통일형 → Claude tools[{name,description,input_schema}]."""
    out = []
    for t in unified:
        fn = t.get("function", {})
        out.append({
            "name": fn.get("name"),
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters") or {"type": "object", "properties": {}},
        })
    return out
