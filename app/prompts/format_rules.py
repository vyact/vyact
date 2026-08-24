"""
prompts/format_rules.py – 모델별 첨부파일/코드 포맷 스타일 규칙

provider_type(openai/gemini/claude)은 "API를 어떻게 호출하느냐"의 축이고,
포맷 선호(XML vs 마크다운)는 "모델이 어떻게 학습됐느냐"의 축이라 서로 다른 문제다.
Vyact는 같은 provider라도 내부에서 gemma → llama → qwen 등으로 모델이 바뀔 수 있으므로,
provider_type이 아니라 실제 모델명(provider_config["model"])을 기준으로 분기한다.

새 모델을 추가/교체했을 때 이 파일의 리스트만 수정하면 된다.
"""

# 모델명 접두어 매칭을 위해 startswith를 사용한다.
# 여기 등록된 모델만 XML 스타일(<file> 태그 + 코드펜스)을 쓰고, 나머지는 전부 기본값(마크다운).
# Claude는 Anthropic이 XML 태그에 맞춰 튜닝했다고 공식 문서에 명시돼 있어 확실한 근거가 있지만,
# 그 외 모델(gemma, qwen, llama, gpt, gemini 등)은 XML 우위가 검증되지 않았으므로 기본값을 유지한다.
XML_PREFERRED_MODELS = (
    "claude",
)


def get_file_format_style(model: str) -> str:
    """'xml' | 'markdown' 반환. 새 모델의 XML 적합성이 확인되면 이 함수만 수정하면 된다."""
    if not model:
        return "markdown"
    model_lower = model.lower()
    if any(model_lower.startswith(p) for p in XML_PREFERRED_MODELS):
        return "xml"
    return "markdown"
