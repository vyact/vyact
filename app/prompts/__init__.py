"""
prompts/ – LLM 프롬프트 템플릿 모음

- format.py       : 코드 출력 형식 등 정적 상수
- format_rules.py : 모델별 첨부파일 포맷 스타일(xml/markdown) 결정 규칙
- system.py       : 시스템 메시지 조합 로직 (날짜 주입, override 처리)
- user.py         : 유저 프롬프트 조합 로직 (image_notice, context_docs 포맷)
"""
from .format import FORMAT_INSTRUCTION, VOICE_MODE_SUFFIX, EXTENSION_FORMAT_INSTRUCTION, get_extension_format_instruction
from .format_rules import get_file_format_style
from .system import build_system_message
from .user import build_user_prompt, build_image_notice

__all__ = [
    "FORMAT_INSTRUCTION",
    "VOICE_MODE_SUFFIX",
    "EXTENSION_FORMAT_INSTRUCTION",
    "get_extension_format_instruction",
    "get_file_format_style",
    "build_system_message",
    "build_user_prompt",
    "build_image_notice",
]