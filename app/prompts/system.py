"""
prompts/system.py – 시스템 메시지 조합 로직

format_instruction_override / system_prompt 조합 규칙과
오늘 날짜 prefix 주입을 담당합니다.
"""
from datetime import datetime

from .format import FORMAT_INSTRUCTION
from .language import get_language_label, normalize_language_code


def build_system_message(
        system_prompt: str,
        format_instruction_override: str | None,
        user_profile: str = "",
        skill_context: str = "",
        conversation_summary: str = "",
    user_language: str = "",
    isolated: bool = False,
) -> str:
    """
    시스템 메시지를 조합하여 반환합니다.

    우선순위:
    1. format_instruction_override == ""  → system_prompt만 사용 (voice mode 등)
    2. format_instruction_override 값 있음 → override 사용 + system_prompt 추가
    3. system_prompt 있음               → system_prompt만 사용
    4. 둘 다 없음                        → FORMAT_INSTRUCTION 기본값 사용

    켜진 MCP 서버들의 사용자 지정 프롬프트는 여기서 주입하지 않는다.
    (services.llm.tools.build_tool_directive가 user 메시지 바로 앞에서 주입 —
    작은 모델일수록 프롬프트 앞쪽보다 그 위치를 더 강하게 따르기 때문에,
    중간에 묻혀 무시되지 않도록 그쪽 한 곳에서만 처리한다.)
    """
    normalized_language = normalize_language_code(user_language)
    lang_label = get_language_label(normalized_language)
    response_language_instruction = (
        f"[응답 언어]\n사용자 UI 언어는 {lang_label}입니다. "
        f"사용자가 다른 언어를 명시적으로 요청하지 않는 한, 반드시 {lang_label}로 답변하세요. "
        f"제목과 섹션명도 {lang_label}로 작성하세요."
    )

    if isolated:
        return "\n\n".join(part for part in (system_prompt, response_language_instruction) if part)

    if format_instruction_override is not None:
        if format_instruction_override == "":
            # voice mode: system_prompt만, format 규칙 없음
            message = system_prompt
        else:
            message = format_instruction_override
            if system_prompt:
                message += f"\n\n**추가 지시사항:**\n{system_prompt}\n\n---"
    elif system_prompt:
        message = system_prompt
    else:
        message = FORMAT_INSTRUCTION

    # 정적 규칙은 반드시 맨 앞에 둔다. provider의 prefix cache가 이 블록을
    # 요청 간 재사용할 수 있도록, 날짜·프로필·스킬처럼 변하는 정보는 뒤에 붙인다.
    dynamic_context: list[str] = []

    # 오늘 날짜는 변하는 정보이므로 정적 규칙 뒤에 둔다.
    today_str = datetime.now().strftime("%Y년 %m월 %d일")
    dynamic_context.append(f"오늘 날짜: {today_str}")

    # 사용자 UI 언어가 없거나 미지원이면 시스템 기본 언어인 영어를 사용한다.
    # 기본 포맷의 작성 언어만으로는 문서 원문이나 스킬 지침의 언어를 이기지
    # 못할 수 있으므로, 한국어를 포함한 모든 UI 언어를 명시적으로 지시한다.
    # user_profile 주입 (voice mode 제외: format_instruction_override == "" 이면 스킵)
    if user_profile and format_instruction_override != "":
        dynamic_context.append(f"[사용자 정보]\n{user_profile}")

    # 음성 모드도 최근 대화와 함께 문맥을 이어가야 하므로 요약은 제외하지 않는다.
    if conversation_summary:
        dynamic_context.append(
            "[이전 대화 요약]\n"
            "아래는 오래된 대화를 압축한 문맥이다. 최근 대화와 충돌하면 최근 대화를 우선한다.\n"
            f"{conversation_summary}"
        )

    # 질문별로 달라지는 스킬은 대화 요약 뒤에 둔다. 고정 규칙·프로필 prefix의
    # cache 재사용 범위를 넓히고, 현재 질문에 가까운 지시로 모델의 준수도도 높인다.
    if skill_context and format_instruction_override != "":
        dynamic_context.append(f"[스킬 지침]\n{skill_context}")

    # 질문과 가장 가까운 스킬 지침 뒤에 언어 규칙을 둬, 영어 원문을 요약하는
    # 경우에도 UI 언어로 결과를 생성하게 한다.
    dynamic_context.append(response_language_instruction)

    return "\n\n".join([message, *dynamic_context])
