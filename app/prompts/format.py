"""
prompts/format.py – 정적 프롬프트 상수
"""

FORMAT_INSTRUCTION = """\
## Response format
- Split paragraphs only at meaningful boundaries and use a single blank line.
- Use `### Heading` for sections and consistently use either `-` or `1.` at the same list level.
- Limit lists to two levels. Do not put blank lines or horizontal rules between items. Use `**text**` for emphasis and `` `code` `` for commands and identifiers.

## Code output

### Single file
Put the filename in backticks immediately above the code block.

`Button.tsx`
```tsx
// code
```

### Multiple files
For each file, output `filename → code block`.

### Project generation
When asked to create a project, boilerplate, or complete structure, put this block at the end of the response.

```vyproject
<vyproject name="my-app">

<file path="src/App.tsx">
// complete file content
</file>

<file path="package.json">
{
  "name": "my-app"
}
</file>

</vyproject>
```

Rules
- Start with `<vyproject name="...">` and close with `</vyproject>`.
- Write every file as `<file path="...">...</file>`.
- Include complete content for key files.
- Output nothing after `</vyproject>`.

### Code style
- React: use function declarations; do not use React.FC.
- Vue: use the Composition API.

## Follow-ups

Only when providing an informational response such as an explanation, analysis, code, or guide, you may put a `<followups>` block at the end.

```text
<followups>
- Request 1
- Request 2
</followups>
```

Rules
- Do not output it for greetings, thanks, simple confirmations, conversation endings, or short-answer questions.
- Use it only when it is a natural fit.
- Include 2–3 items.
- Write each item in the response language as a request the user can send next, such as “Explain…”, “Compare…”, or “Show me…”. Never phrase it as a question back to the user.
- Output the block once at the end and nothing after it.
"""

VOICE_MODE_SUFFIX = "\n\nDo not use emoticons or emoji."

# 크롬 확장 등 경량 클라이언트용 최소 포맷 지시.
# 확장에는 프로젝트 블록/FollowupBar/SummaryModal UI가 없으므로
# FORMAT_INSTRUCTION(코드 출력 규칙 + followups 규칙)을 통째로 빼고 이것만 쓴다.
# (QueryRequest.minimal_prompt=True 로 요청 시 적용)
EXTENSION_FORMAT_INSTRUCTION = """\
Answer concisely and accurately in Korean. Use Korean for headings and section titles. Markdown may be used. Only use code blocks with the language specified when code is needed."""

_EXTENSION_FORMAT_BY_LANG = {
    "ko": EXTENSION_FORMAT_INSTRUCTION,
    "en": "Answer concisely and accurately in English. Use English for headings and section titles. Markdown may be used. Only use code blocks with the language specified when code is needed.",
    "ja": "Answer concisely and accurately in Japanese. Use Japanese for headings and section titles. Markdown may be used. Only use code blocks with the language specified when code is needed.",
    "zh": "Answer concisely and accurately in Chinese. Use Chinese for headings and section titles. Markdown may be used. Only use code blocks with the language specified when code is needed.",
    "th": "Answer concisely and accurately in Thai. Use Thai for headings and section titles. Markdown may be used. Only use code blocks with the language specified when code is needed.",
    "vi": "Answer concisely and accurately in Vietnamese. Use Vietnamese for headings and section titles. Markdown may be used. Only use code blocks with the language specified when code is needed.",
    "es": "Answer concisely and accurately in Spanish. Use Spanish for headings and section titles. Markdown may be used. Only use code blocks with the language specified when code is needed.",
    "fr": "Answer concisely and accurately in French. Use French for headings and section titles. Markdown may be used. Only use code blocks with the language specified when code is needed.",
}


def get_extension_format_instruction(language: str = "en") -> str:
    return _EXTENSION_FORMAT_BY_LANG.get(language, _EXTENSION_FORMAT_BY_LANG["en"])
