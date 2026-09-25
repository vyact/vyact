"""Keep code-first chat titles readable when a model title is unavailable."""

import re


_CODE_FENCE = re.compile(r"^\s*(`{3,}|~{3,})([\w+#.-]*)\s*", re.DOTALL)
_FILENAME = re.compile(
    r"\b([\w.-]+\.(?:py|json|ya?ml|tsx?|jsx?|css|scss|html?|java|go|rs|sh|sql|properties|md|txt))\b",
    re.IGNORECASE,
)


def readable_conversation_title(title: str) -> str:
    """Replace a raw leading code fence with a concise code or file label."""
    stripped = title.strip()
    match = _CODE_FENCE.match(stripped)
    if not match:
        return stripped

    language = match.group(2).lower()
    body = stripped[match.end():]
    filename = _FILENAME.search(body[:300])
    if filename:
        return filename.group(1)
    if language == "json" and "manifest_ver" in body:
        return "manifest.json"

    first_line = re.split(r"[\r\n]", body, maxsplit=1)[0].strip(" `~'\" ")
    first_line = re.sub(r"[`~]{3,}.*$", "", first_line).strip()
    first_line = re.sub(r"\s+", " ", first_line)
    if first_line and not first_line.startswith(('{', '[', '<')):
        return first_line[:36] + ("..." if len(first_line) > 36 else "")
    return language.upper() if language else "Code"
