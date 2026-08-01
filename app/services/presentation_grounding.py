"""Source-grounding and post-generation QA helpers for presentations.

The module is deliberately domain-agnostic: it validates evidence excerpts,
numeric/date anchors, output language, repairs, and source notes without
knowing anything about a particular policy, company, or document type.
"""
from __future__ import annotations

import copy
import json
import re
import unicodedata
from typing import Any


MAX_VERIFIED_FACTS = 80
MIN_EVIDENCE_LENGTH = 8
FACT_TOKEN_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])(?:['’]?\d{2,4}(?:[./-]\d{1,2}){0,2}|\d[\d,.]*)"
    r"(?:\s?(?:%|‰|bp|bps|배|원|억원|조원|만명|개사|명|건|일|월|년|분기|반기|"
    r"KRW|USD|EUR|JPY|(?:million|billion|trillion|K|M|B)(?:\s?(?:KRW|USD|EUR|JPY))?|"
    r"percent|points?))?",
    re.IGNORECASE,
)
VISIBLE_TEXT_FIELDS = {
    "presentation_title", "title", "subtitle", "content", "quote",
    "bullets", "stats", "label", "value", "desc", "image_caption",
}
FACT_ID_MARKER_PATTERN = re.compile(r"\s*\[(?:F\d+)(?:\s*,\s*F\d+)*\]\s*", re.IGNORECASE)
LATEX_SYMBOLS = {
    r"\rightarrow": "→",
    r"\to": "→",
    r"\leq": "≤",
    r"\le": "≤",
    r"\geq": "≥",
    r"\ge": "≥",
    r"\pm": "±",
    r"\times": "×",
    r"\div": "÷",
    r"\neq": "≠",
    r"\approx": "≈",
    r"\infty": "∞",
    r"\sum": "Σ",
    r"\prod": "Π",
    r"\int": "∫",
    r"\in": "∈",
    r"\notin": "∉",
    r"\subset": "⊂",
    r"\supset": "⊃",
    r"\cup": "∪",
    r"\cap": "∩",
}
LATEX_NAMED_SYMBOLS = {token[1:]: symbol for token, symbol in LATEX_SYMBOLS.items()}
LATEX_NAMED_SYMBOLS.update({
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε",
    "zeta": "ζ", "eta": "η", "theta": "θ", "iota": "ι", "kappa": "κ",
    "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π", "rho": "ρ",
    "sigma": "σ", "tau": "τ", "upsilon": "υ", "phi": "φ", "chi": "χ",
    "psi": "ψ", "omega": "ω", "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ",
    "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π", "Sigma": "Σ", "Phi": "Φ",
    "Psi": "Ψ", "Omega": "Ω", "cdot": "·", "ldots": "…", "degree": "°",
})
LATEX_TEXT_COMMANDS = {
    "text", "textrm", "textsf", "texttt", "textbf", "textit", "mathrm", "mathbf",
    "mathsf", "mathtt", "mathit", "operatorname", "overline", "underline", "boxed",
}
LATEX_IGNORED_COMMANDS = {
    "left", "right", "big", "Big", "bigg", "Bigg", "displaystyle", "scriptstyle",
    "quad", "qquad", "hspace", "vspace", "phantom",
}
LATEX_OPERATOR_NAMES = {
    "sin", "cos", "tan", "log", "ln", "exp", "lim", "min", "max", "argmin", "argmax",
}
LATEX_RESIDUAL_PATTERN = re.compile(
    r"(?:\$|\\(?:begin|end)\s*\{|\\[A-Za-z]+|\\[()[\]])"
)
NUMBERED_OUTLINE_PATTERN = re.compile(r"(?m)^\s*(\d{1,2})[.)]\s+(.+?)\s*$")
DATE_EXPRESSION_PATTERN = re.compile(
    r"(?<!\d)(?P<year>20\d{2}|['‘’]\d{2})\s*"
    r"(?:[./-]\s*|년\s*)(?P<month>\d{1,2})(?:\s*월)?",
    re.IGNORECASE,
)
YEAR_EXPRESSION_PATTERN = re.compile(r"(?<!\d)(?:20\d{2}|['‘’]\d{2})(?!\d)")
UNIT_ALIASES = {
    "krw": "원",
    "m": "million",
    "b": "billion",
    "k": "thousand",
    "%": "percent",
}


def _normalized_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\s+", "", text).lower()


def parse_json_object(raw: str) -> dict:
    """Parse a JSON object returned by a model, tolerating fences and preambles."""
    value = (raw or "").strip()
    if value.startswith("```"):
        lines = value.splitlines()[1:]
        if lines and lines[-1].strip() == "```":
            lines.pop()
        value = "\n".join(lines).strip()
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as original_error:
        decoder = json.JSONDecoder()
        for position, character in enumerate(value):
            if character != "{":
                continue
            try:
                parsed, _ = decoder.raw_decode(value[position:])
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
        raise original_error
    if not isinstance(parsed, dict):
        raise ValueError("LLM response must be a JSON object")
    return parsed


def validate_evidence_ledger(raw_ledger: dict, context_docs: list[dict]) -> dict:
    """Keep only facts whose quoted evidence is present in the named source."""
    source_map = {f"S{index + 1}": doc for index, doc in enumerate(context_docs)}
    verified: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for candidate in raw_ledger.get("facts") or []:
        if not isinstance(candidate, dict):
            continue
        source_id = str(candidate.get("source_id") or "").upper()
        source = source_map.get(source_id)
        evidence = str(candidate.get("evidence") or "").strip()
        statement = str(candidate.get("statement") or "").strip()
        if not source or not statement or len(evidence) < MIN_EVIDENCE_LENGTH:
            continue
        normalized_evidence = _normalized_text(evidence)
        if normalized_evidence not in _normalized_text(source.get("content")):
            continue
        identity = (source_id, normalized_evidence)
        if identity in seen:
            continue
        seen.add(identity)
        verified.append({
            "id": f"F{len(verified) + 1}",
            "statement": statement,
            "evidence": evidence,
            "source_id": source_id,
            "source_title": source.get("title") or source_id,
        })
        if len(verified) >= MAX_VERIFIED_FACTS:
            break

    return {"facts": verified}


def fact_ledger_prompt_payload(ledger: dict) -> str:
    """Compact, deterministic serialization for a downstream model prompt."""
    return json.dumps(ledger, ensure_ascii=False, separators=(",", ":"))


def extract_numbered_outline(prompt: str) -> list[str]:
    """Extract an explicit user-authored numbered presentation outline."""
    return [match.group(2).strip() for match in NUMBERED_OUTLINE_PATTERN.finditer(prompt or "")]


def _consume_latex_group(text: str, start: int) -> tuple[str, int]:
    if start >= len(text) or text[start] != "{":
        return "", start
    depth = 1
    position = start + 1
    while position < len(text) and depth:
        if text[position] == "{":
            depth += 1
        elif text[position] == "}":
            depth -= 1
        position += 1
    return text[start + 1:position - 1] if depth == 0 else text[start + 1:], position


def _latex_to_plain_text(value: str) -> str:
    """Convert arbitrary LaTeX-ish model output to safe, readable plain text."""
    result: list[str] = []
    position = 0
    while position < len(value):
        character = value[position]
        if character == "$":
            position += 1
            continue
        if character in "^_":
            marker = character
            position += 1
            if position < len(value) and value[position] == "{":
                group, position = _consume_latex_group(value, position)
                result.append(f"{marker}({_latex_to_plain_text(group)})")
            elif position < len(value):
                result.append(f"{marker}({value[position]})")
                position += 1
            continue
        if character == "{":
            group, position = _consume_latex_group(value, position)
            result.append(_latex_to_plain_text(group))
            continue
        if character == "}":
            position += 1
            continue
        if character != "\\":
            result.append("; " if character == "&" else character)
            position += 1
            continue

        position += 1
        if position >= len(value):
            break
        if value[position] in "()[]$":
            position += 1
            continue
        if value[position] == "\\":
            result.append("; ")
            position += 1
            continue
        command_start = position
        while position < len(value) and value[position].isalpha():
            position += 1
        command = value[command_start:position]
        if not command:
            result.append(value[position])
            position += 1
            continue
        if command in {"begin", "end"} and position < len(value) and value[position] == "{":
            _, position = _consume_latex_group(value, position)
            continue
        if command == "frac" and position < len(value) and value[position] == "{":
            numerator, position = _consume_latex_group(value, position)
            if position < len(value) and value[position] == "{":
                denominator, position = _consume_latex_group(value, position)
                result.append(f"({_latex_to_plain_text(numerator)})/({_latex_to_plain_text(denominator)})")
            else:
                result.append(_latex_to_plain_text(numerator))
            continue
        if command == "sqrt":
            if position < len(value) and value[position] == "[":
                closing = value.find("]", position + 1)
                degree = value[position + 1:closing] if closing >= 0 else ""
                position = closing + 1 if closing >= 0 else position
            else:
                degree = ""
            if position < len(value) and value[position] == "{":
                radicand, position = _consume_latex_group(value, position)
                root = "√" if not degree or degree == "2" else f"{degree}√"
                result.append(f"{root}({_latex_to_plain_text(radicand)})")
            continue
        if command in LATEX_TEXT_COMMANDS and position < len(value) and value[position] == "{":
            group, position = _consume_latex_group(value, position)
            result.append(_latex_to_plain_text(group))
            continue
        if command in LATEX_IGNORED_COMMANDS:
            if position < len(value) and value[position] == "{":
                _, position = _consume_latex_group(value, position)
            continue
        if command in LATEX_OPERATOR_NAMES:
            result.append(command)
            continue
        if command in LATEX_NAMED_SYMBOLS:
            result.append(LATEX_NAMED_SYMBOLS[command])
            continue
        if position < len(value) and value[position] == "{":
            group, position = _consume_latex_group(value, position)
            result.append(_latex_to_plain_text(group))
    return "".join(result)


def _sanitize_visible_text(value: str) -> str:
    text = FACT_ID_MARKER_PATTERN.sub(" ", value)
    text = _latex_to_plain_text(text)
    text = re.sub(r"\s*(?:-{1,2}>|⇒)\s*", " → ", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    if LATEX_RESIDUAL_PATTERN.search(text):
        raise ValueError(f"Unsupported LaTeX remained in visible presentation text: {text}")
    return text


def sanitize_presentation_content(page_data: dict) -> dict:
    """Remove model-only markers and normalize common visible math notation."""
    prepared = copy.deepcopy(page_data)

    def sanitize(value: Any, visible: bool = False) -> Any:
        if isinstance(value, str):
            return _sanitize_visible_text(value) if visible else value
        if isinstance(value, list):
            return [sanitize(item, visible) for item in value]
        if isinstance(value, dict):
            return {
                key: sanitize(item, visible or key in VISIBLE_TEXT_FIELDS)
                for key, item in value.items()
            }
        return value

    return sanitize(prepared)


def _page_text(page: dict) -> str:
    values: list[Any] = [page.get("title"), page.get("subtitle"), page.get("content"), page.get("quote")]
    values.extend(page.get("bullets") or [])
    for stat in page.get("stats") or []:
        values.extend([stat.get("value"), stat.get("label"), stat.get("desc")])
    return " ".join(str(value) for value in values if value)


def _fact_tokens(value: str) -> set[str]:
    tokens = set()
    occupied_ranges: list[tuple[int, int]] = []

    def canonical_year(raw_year: str) -> str:
        digits = re.sub(r"\D", "", raw_year)
        return f"20{digits}" if len(digits) == 2 else digits

    for match in DATE_EXPRESSION_PATTERN.finditer(value or ""):
        year = canonical_year(match.group("year"))
        month = int(match.group("month"))
        if 1 <= month <= 12:
            tokens.add(f"@date:{year}-{month:02d}")
            tokens.add(f"@year:{year}")
            occupied_ranges.append(match.span())

    for match in YEAR_EXPRESSION_PATTERN.finditer(value or ""):
        if any(start <= match.start() < end for start, end in occupied_ranges):
            continue
        tokens.add(f"@year:{canonical_year(match.group(0))}")
        occupied_ranges.append(match.span())

    for match in FACT_TOKEN_PATTERN.finditer(value or ""):
        if any(start <= match.start() < end for start, end in occupied_ranges):
            continue
        token = _normalized_text(match.group(0)).strip(".,")
        digits = re.sub(r"\D", "", token)
        if len(digits) >= 2 or any(marker in token for marker in ("%", "원", "krw", "usd", "eur", "년", "월", "일")):
            tokens.add(token)
    return tokens


def _tokens_match(page_token: str, evidence_token: str) -> bool:
    if page_token == evidence_token:
        return True
    page_digits = re.sub(r"\D", "", page_token)
    evidence_digits = re.sub(r"\D", "", evidence_token)
    if not page_digits or page_digits != evidence_digits:
        return False

    def explicit_unit(token: str) -> str:
        unit = re.sub(r"[\d\s,.'‘’/@:-]", "", token)
        currency = ""
        for currency_code in ("krw", "usd", "eur", "jpy"):
            if unit.endswith(currency_code):
                unit = unit[:-len(currency_code)]
                currency = UNIT_ALIASES.get(currency_code, currency_code)
                break
        return UNIT_ALIASES.get(unit, unit) + currency

    page_unit = explicit_unit(page_token)
    evidence_unit = explicit_unit(evidence_token)
    # A source unit may be omitted for a concise label, but a page must never
    # add a scale/currency unit that is absent from its evidence. Equivalent
    # spellings such as KRW/원 and M/million are normalized above.
    if page_unit and not evidence_unit:
        return False
    return not (page_unit and evidence_unit and page_unit != evidence_unit)


def reconcile_page_fact_ids(page_data: dict, ledger: dict) -> dict:
    """Attach an omitted fact ID when a page anchor uniquely matches ledger evidence."""
    prepared = copy.deepcopy(page_data)
    fact_tokens = {
        fact["id"]: _fact_tokens(f"{fact.get('statement', '')} {fact.get('evidence', '')}")
        for fact in ledger.get("facts") or []
    }
    for page in prepared.get("pages") or []:
        selected = [str(value) for value in page.get("fact_ids") or []]
        for page_token in _fact_tokens(_page_text(page)):
            already_supported = any(
                _tokens_match(page_token, evidence_token)
                for fact_id in selected
                for evidence_token in fact_tokens.get(fact_id, set())
            )
            if already_supported:
                continue
            candidates = [
                fact_id for fact_id, evidence_tokens in fact_tokens.items()
                if any(_tokens_match(page_token, evidence_token) for evidence_token in evidence_tokens)
            ]
            if len(candidates) == 1 and candidates[0] not in selected:
                selected.append(candidates[0])
        page["fact_ids"] = selected
    return prepared


def _language_mismatch(text: str, language: str) -> bool:
    letters = [char for char in text if char.isalpha()]
    if len(letters) < 20:
        return False
    hangul = sum("가" <= char <= "힣" for char in letters)
    latin = sum(("a" <= char.lower() <= "z") for char in letters)
    if language == "ko":
        return hangul / len(letters) < 0.18 and latin / len(letters) > 0.55
    if language == "en":
        return hangul / len(letters) > 0.18
    return False


def audit_presentation(page_data: dict, ledger: dict, language: str) -> list[dict]:
    """Return deterministic QA findings after the semantic model audit."""
    facts = {fact["id"]: fact for fact in ledger.get("facts") or []}
    findings: list[dict] = []
    pages = page_data.get("pages") or []

    for index, page in enumerate(pages):
        text = _page_text(page)
        if _language_mismatch(text, language):
            findings.append({"page_index": index, "code": "language_mismatch"})

        requested_ids = [str(value) for value in page.get("fact_ids") or []]
        invalid_ids = [fact_id for fact_id in requested_ids if fact_id not in facts]
        if invalid_ids:
            findings.append({"page_index": index, "code": "invalid_fact_ids", "details": invalid_ids})

        page_tokens = _fact_tokens(text)
        if not page_tokens:
            continue
        referenced = [facts[fact_id] for fact_id in requested_ids if fact_id in facts]
        if not referenced:
            findings.append({"page_index": index, "code": "unreferenced_factual_claim"})
            continue
        evidence_blob = " ".join(f"{fact['statement']} {fact['evidence']}" for fact in referenced)
        evidence_tokens = _fact_tokens(evidence_blob)
        unsupported = sorted(
            page_token for page_token in page_tokens
            if not any(_tokens_match(page_token, evidence_token) for evidence_token in evidence_tokens)
        )
        if unsupported:
            findings.append({"page_index": index, "code": "unsupported_fact_tokens", "details": unsupported})

    return findings


def apply_page_repairs(page_data: dict, repair_data: dict) -> dict:
    """Apply bounded page replacements while preserving the original deck shell."""
    repaired = copy.deepcopy(page_data)
    pages = repaired.get("pages") or []
    for item in repair_data.get("repaired_pages") or []:
        if not isinstance(item, dict) or not isinstance(item.get("page"), dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        if 0 <= index < len(pages):
            replacement = item["page"]
            replacement["index"] = index
            pages[index] = replacement
    return repaired


def repair_unsupported_fact_tokens(page_data: dict, ledger: dict, findings: list[dict]) -> dict:
    """Restore unsupported numeric tokens from a uniquely matching cited source token.

    This is intentionally syntax-only: it never calculates or converts values. A
    replacement is made only when the page cites a fact containing exactly one
    normalized source token with the same digits.
    """
    repaired = copy.deepcopy(page_data)
    facts = {fact["id"]: fact for fact in ledger.get("facts") or []}
    unsupported_by_page = {
        finding["page_index"]: set(finding.get("details") or [])
        for finding in findings
        if finding.get("code") == "unsupported_fact_tokens"
        and isinstance(finding.get("page_index"), int)
        and isinstance(finding.get("details"), list)
    }

    for page_index, unsupported_tokens in unsupported_by_page.items():
        pages = repaired.get("pages") or []
        if not 0 <= page_index < len(pages):
            continue
        page = pages[page_index]
        referenced = [
            facts[fact_id]
            for fact_id in page.get("fact_ids") or []
            if fact_id in facts
        ]
        source_tokens_by_digits: dict[str, dict[str, str]] = {}
        for fact in referenced:
            source_text = f"{fact.get('statement', '')} {fact.get('evidence', '')}"
            for match in FACT_TOKEN_PATTERN.finditer(source_text):
                raw_token = match.group(0).strip()
                normalized = _normalized_text(raw_token).strip(".,")
                digits = re.sub(r"\D", "", normalized)
                if digits:
                    source_tokens_by_digits.setdefault(digits, {})[normalized] = raw_token

        replacements: dict[str, str] = {}
        for unsupported in unsupported_tokens:
            digits = re.sub(r"\D", "", unsupported)
            candidates = source_tokens_by_digits.get(digits, {})
            if len(candidates) == 1:
                replacements[unsupported] = next(iter(candidates.values()))
        if not replacements:
            continue

        def restore(value: Any, visible: bool = False) -> Any:
            if isinstance(value, str) and visible:
                return FACT_TOKEN_PATTERN.sub(
                    lambda match: replacements.get(
                        _normalized_text(match.group(0)).strip(".,"),
                        match.group(0),
                    ),
                    value,
                )
            if isinstance(value, list):
                return [restore(item, visible) for item in value]
            if isinstance(value, dict):
                return {
                    key: restore(item, visible or key in VISIBLE_TEXT_FIELDS)
                    for key, item in value.items()
                }
            return value

        pages[page_index] = restore(page)
    return repaired


def add_source_notes(page_data: dict, ledger: dict, language: str = "en") -> dict:
    """Append human-readable [Sources] blocks based on each page's fact IDs."""
    prepared = copy.deepcopy(page_data)
    facts = {fact["id"]: fact for fact in ledger.get("facts") or []}
    source_labels = {
        "ko": "근거 출처",
        "en": "Sources",
        "es": "Fuentes",
        "fr": "Sources",
        "zh": "来源",
        "ja": "出典",
        "th": "แหล่งที่มา",
        "vi": "Nguồn",
    }
    source_label = source_labels.get(language, source_labels["en"])
    for page in prepared.get("pages") or []:
        selected = [facts[fact_id] for fact_id in page.get("fact_ids") or [] if fact_id in facts]
        if not selected:
            continue
        lines = []
        seen = set()
        for fact in selected:
            line = f"- {fact['source_title']}: {fact['evidence']}"
            if line not in seen:
                seen.add(line)
                lines.append(line)
        existing = str(page.get("speaker_notes") or "").strip()
        source_block = f"[{source_label}]\n" + "\n".join(lines)
        page["speaker_notes"] = f"{existing}\n\n{source_block}".strip()
    return prepared
