"""
services/llm/helpers.py — 메시지 조립 보조 함수

이미지 base64 로딩, mime 판별, RAG context 주입, provider별 히스토리 변환.
"""
import base64
from pathlib import Path

from .config import IMAGES_DIR
from services.runtime_settings import get_runtime_settings


def _approx_tokens(text: str) -> int:
    if not text:
        return 0
    return int(len(text) / get_runtime_settings()["history_chars_per_token"]) + 1


def select_history_by_budget(
        conversation_history: list,
        budget: int | None = None,
) -> list:
    """대화 히스토리에서 최근 것부터 토큰 예산까지 담아 반환.

    규칙:
    - user/assistant 이면서 content 있고 error 아닌 메시지만 대상.
    - 마지막이 user면(= 이번에 보낼 현재 질문) 히스토리에서 제외.
    - 최근(뒤)부터 역순으로 담되, 메시지 '중간'을 자르지 않는다
      (부분 절단 금지 — 통째로 포함하거나 통째로 제외).
    - 다음 메시지를 넣으면 예산을 넘더라도, 그 메시지 1개까지는 포함하고 중단한다
      (경계에서 맥락이 뚝 끊기지 않도록 초과 1개 허용).
    - 가장 최근 메시지 하나가 예산보다 커도 통째로 포함(부분 절단 없음).
    반환 순서는 원래(오래된→최신) 순서를 유지한다.
    """
    budget = get_runtime_settings()["history_token_budget"] if budget is None else budget
    valid = [m for m in conversation_history
             if m.get("role") in ("user", "assistant", "tool")
             and not m.get("isError")
             and (m.get("content") or m.get("tool_calls"))]
    if valid and valid[-1].get("role") == "user":
        valid = valid[:-1]

    selected: list = []
    used = 0
    # 최근부터 역순으로
    for m in reversed(valid):
        t = _approx_tokens(m.get("content", ""))
        if selected and used + t > budget:
            # 이미 뭔가 담았고 이 메시지를 넣으면 예산 초과
            # → 이 메시지 하나까지는 포함하고 중단(초과 1개 허용)
            selected.append(m)
            break
        selected.append(m)
        used += t
    selected.reverse()  # 오래된→최신 순서 복원
    return selected


def image_attachment_path(attachment: dict) -> Path:
    return Path(attachment["path"]) if attachment.get("path") else IMAGES_DIR / attachment["filename"]


def load_images_b64(attachments: list) -> list[str]:
    result = []
    for att in attachments:
        if att.get("type") == "image":
            path = image_attachment_path(att)
            if path.exists():
                result.append(base64.b64encode(path.read_bytes()).decode("utf-8"))
    return result


def mime_type(filename: str) -> str:
    ext = filename.split(".")[-1].lower()
    return f"image/{ext}" if ext in ("jpeg", "jpg", "png", "gif", "webp") else "image/jpeg"


def inject_rag_context(content: str, rag_context: list) -> str:
    """rag_context를 user 메시지 content에 조용히 주입

    zip 파일 출처(source가 'zip:'으로 시작)는 주입 제외.
    zip 내용은 ES에 인덱싱돼 있으므로 file_id 경로로 검색하면 되고,
    히스토리 재주입 시 통째로 꽂으면 후속 질문마다 수만 토큰이 낭비된다.
    """
    if not rag_context:
        return content
    parts = [
        f"[{r['source']}]\n{r['data']}"
        for r in rag_context
        if r.get("data")
           and not (r.get("source", "")).startswith("zip:")
           and not (r.get("source", "")).startswith("첨부:")
           and r.get("source") != "첨부파일"
    ]
    if not parts:
        return content
    return content + "\n\n[참고 데이터]\n" + "\n\n".join(parts)


def history_for_ollama(history_messages: list, valid_history: list) -> list:
    """Ollama용 history: user 메시지에 이미지 포함"""
    result = []
    hi = 0
    for msg in history_messages:
        # tool 관련 메시지는 Ollama 형식으로 전달
        if msg["role"] == "assistant" and msg.get("tool_calls"):
            ollama_tcs = [{"function": {"name": tc["name"], "arguments": tc.get("args", {})}}
                          for tc in msg["tool_calls"]]
            result.append({"role": "assistant", "content": msg.get("content", ""), "tool_calls": ollama_tcs})
            continue
        if msg["role"] == "tool":
            result.append({"role": "tool", "content": msg["content"]})
            continue
        entry: dict = {"role": msg["role"], "content": msg["content"]}
        if msg["role"] == "user" and hi < len(valid_history):
            atts = valid_history[hi].get("attachments", [])
            imgs = load_images_b64(atts)
            if imgs:
                entry["images"] = imgs
            entry["content"] = inject_rag_context(entry["content"], valid_history[hi].get("rag_context", []))
        if msg["role"] == "user":
            hi += 1
        result.append(entry)
    return result


def history_for_openai(history_messages: list, valid_history: list) -> list:
    """OpenAI용 history: user 메시지에 image_url content blocks 포함"""
    result = []
    hi = 0
    for msg in history_messages:
        # tool 관련 메시지는 그대로 전달
        if msg["role"] == "tool":
            result.append(msg)
            continue
        if msg["role"] == "assistant" and msg.get("tool_calls"):
            result.append(msg)
            continue
        if msg["role"] == "user" and hi < len(valid_history):
            atts = valid_history[hi].get("attachments", [])
            imgs = load_images_b64(atts)
            rag = valid_history[hi].get("rag_context", [])
            text = inject_rag_context(msg["content"], rag)
            if imgs:
                content: list = [{"type": "text", "text": text}]
                for b64 in imgs:
                    content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
                result.append({"role": "user", "content": content})
                hi += 1
                continue
            hi += 1
            result.append({"role": "user", "content": text})
            continue
        result.append({"role": msg["role"], "content": msg["content"]})
    return result


def history_for_gemini(history_messages: list, valid_history: list) -> list:
    """Gemini용 history: user 메시지에 inline_data parts 포함"""
    result = []
    hi = 0
    for msg in history_messages:
        # tool 관련 메시지는 Gemini 형식으로 변환
        if msg["role"] == "assistant" and msg.get("tool_calls"):
            fcalls = [{"functionCall": {"name": tc["name"], "args": tc.get("args", {})}}
                      for tc in msg["tool_calls"]]
            result.append({"role": "model", "parts": fcalls})
            continue
        if msg["role"] == "tool":
            result.append({"role": "user", "parts": [{"functionResponse": {
                "name": msg.get("name", ""), "response": {"result": msg["content"]}}}]})
            continue
        role = "user" if msg["role"] == "user" else "model"
        if msg["role"] == "user" and hi < len(valid_history):
            atts = valid_history[hi].get("attachments", [])
            rag = valid_history[hi].get("rag_context", [])
            parts: list = [{"text": inject_rag_context(msg["content"], rag)}]
            for att in atts:
                if att.get("type") == "image":
                    path = IMAGES_DIR / att["filename"]
                    if path.exists():
                        parts.append({"inline_data": {"mime_type": mime_type(att["filename"]),
                                                      "data": base64.b64encode(path.read_bytes()).decode()}})
            result.append({"role": role, "parts": parts})
            hi += 1
            continue
        result.append({"role": role, "parts": [{"text": msg["content"]}]})
    return result


def history_for_claude(history_messages: list, valid_history: list) -> list:
    """Claude용 history: user 메시지에 image blocks 포함"""
    result = []
    hi = 0
    for msg in history_messages:
        # tool 관련 메시지는 Claude 형식으로 변환
        if msg["role"] == "assistant" and msg.get("tool_calls"):
            content_blocks = []
            if msg.get("content"):
                content_blocks.append({"type": "text", "text": msg["content"]})
            for i, tc in enumerate(msg["tool_calls"]):
                content_blocks.append({"type": "tool_use", "id": f"hist_{i}",
                                       "name": tc["name"], "input": tc.get("args", {})})
            result.append({"role": "assistant", "content": content_blocks})
            continue
        if msg["role"] == "tool":
            result.append({"role": "user", "content": [{"type": "tool_result",
                           "tool_use_id": f"hist_{0}", "content": msg["content"]}]})
            continue
        if msg["role"] == "user" and hi < len(valid_history):
            atts = valid_history[hi].get("attachments", [])
            img_blocks = []
            for att in atts:
                if att.get("type") == "image":
                    path = IMAGES_DIR / att["filename"]
                    if path.exists():
                        img_blocks.append({"type": "image",
                                           "source": {"type": "base64",
                                                      "media_type": mime_type(att["filename"]),
                                                      "data": base64.b64encode(path.read_bytes()).decode()}})
            rag = valid_history[hi].get("rag_context", [])
            text = inject_rag_context(msg["content"], rag)
            if img_blocks:
                content: list = [{"type": "text", "text": text}] + img_blocks
                result.append({"role": "user", "content": content})
            else:
                result.append({"role": "user", "content": text})
            hi += 1
            continue
        result.append({"role": msg["role"], "content": msg["content"]})
    return result
