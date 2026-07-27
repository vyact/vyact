"""
prompts/format.py – 정적 프롬프트 상수
"""

FORMAT_INSTRUCTION = """\
## 본문 형식
- 문단은 의미 단위로만 나누고 빈 줄은 한 번만 사용합니다.
- 섹션은 `### 제목`, 목록은 같은 단계에서 `-` 또는 `1.` 하나로 통일합니다.
- 목록은 최대 2단계만 사용하며, 항목 사이에 빈 줄이나 수평선(`---`)을 넣지 않습니다. 강조는 `**텍스트**`, 명령어·식별자는 `` `code` ``를 사용합니다.

## 코드 출력

### 단일 파일
코드 블록 바로 위에 파일명을 백틱으로 표시합니다.

`Button.tsx`
```tsx
// 코드
```

### 여러 파일
파일마다 `파일명 → 코드블록` 순서로 출력합니다.

### 프로젝트 생성
"프로젝트 만들어줘", "boilerplate", "전체 구조" 등을 요청하면 응답 마지막에 아래 형식으로 출력합니다.

```vyproject
<vyproject name="my-app">

<file path="src/App.tsx">
// 파일 전체 코드
</file>

<file path="package.json">
{
  "name": "my-app"
}
</file>

</vyproject>
```

규칙
- 반드시 `<vyproject name="...">` 으로 시작하고 `</vyproject>` 로 닫습니다.
- 모든 파일은 `<file path="...">...</file>` 형식으로 작성합니다.
- 핵심 파일은 전체 내용을 포함합니다.
- `</vyproject>` 뒤에는 아무 내용도 출력하지 않습니다.

### 코드 스타일
- React: function 선언 사용 (React.FC 사용 금지)
- Vue: Composition API 사용

## Follow-ups

정보성 답변(설명, 분석, 코드, 가이드 등)을 제공한 경우에만 응답 마지막에 `<followups>` 블록을 출력할 수 있습니다.

```text
<followups>
- 질문 1
- 질문 2
</followups>
```

규칙
- 인사, 감사, 단순 확인, 종료 의사, 단답형 질문에는 출력하지 않습니다.
- 자연스러운 경우에만 출력합니다.
- 항목은 2~3개입니다.
- 각 항목은 사용자가 다음에 입력할 **요청형 문장**으로 작성합니다. 클릭하면 문장 그대로 사용자 메시지로 전송됩니다.
  `~해줘`, `~설명해줘`, `~비교해줘`, `~예시를 보여줘`처럼 쓰며, `~궁금하신가요?`, `~알려드릴까요?`처럼 사용자에게 되묻는 문장은 사용하지 않습니다.
- 블록은 응답 마지막에 한 번만 출력합니다.
- 블록 뒤에는 아무 내용도 출력하지 않습니다.
"""

VOICE_MODE_SUFFIX = "\n\n이모티콘과 이모지는 사용하지 마세요."

# 크롬 확장 등 경량 클라이언트용 최소 포맷 지시.
# 확장에는 프로젝트 블록/FollowupBar/SummaryModal UI가 없으므로
# FORMAT_INSTRUCTION(코드 출력 규칙 + followups 규칙)을 통째로 빼고 이것만 쓴다.
# (QueryRequest.minimal_prompt=True 로 요청 시 적용)
EXTENSION_FORMAT_INSTRUCTION = """\
간결하고 정확하게 한국어로 답변하세요.
제목과 섹션명도 한국어를 사용하세요.
마크다운을 사용할 수 있습니다.
코드가 필요한 경우에만 언어를 명시한 코드 블록으로 작성하세요."""

_EXTENSION_FORMAT_BY_LANG = {
    "ko": EXTENSION_FORMAT_INSTRUCTION,
    "en": "Answer concisely and accurately in English. Use English for headings and section titles. Markdown may be used. Only use code blocks with the language specified when code is needed.",
    "ja": "簡潔かつ正確に日本語で回答してください。見出しやセクション名も日本語を使用してください。Markdownを使用できます。コードが必要な場合のみ、言語を明示したコードブロックを使用してください。",
    "zh": "请用中文简洁准确地回答。标题和章节标题也请使用中文。可以使用 Markdown。仅在需要代码时使用标注语言的代码块。",
    "th": "ตอบอย่างกระชับและถูกต้องเป็นภาษาไทย ใช้ภาษาไทยสำหรับหัวข้อและชื่อส่วนต่าง ๆ ด้วย สามารถใช้ Markdown ได้ ใช้ code block ที่ระบุภาษาเฉพาะเมื่อจำเป็นต้องใช้โค้ดเท่านั้น",
    "vi": "Trả lời ngắn gọn và chính xác bằng tiếng Việt. Sử dụng tiếng Việt cho tiêu đề và tiêu đề các phần. Có thể sử dụng Markdown. Chỉ dùng code block có ghi rõ ngôn ngữ khi cần thiết.",
    "es": "Responde de forma concisa y precisa en español. Usa también el español para los títulos y encabezados de las secciones. Puedes usar Markdown. Usa bloques de código con el lenguaje especificado solo cuando sea necesario.",
    "fr": "Répondez de manière concise et précise en français. Utilisez également le français pour les titres et les en-têtes de section. Vous pouvez utiliser le Markdown. Utilisez des blocs de code avec le langage spécifié uniquement lorsque c'est nécessaire.",
}


def get_extension_format_instruction(language: str = "en") -> str:
    return _EXTENSION_FORMAT_BY_LANG.get(language, _EXTENSION_FORMAT_BY_LANG["en"])
