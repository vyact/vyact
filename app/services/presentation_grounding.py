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
    r"KRW|USD|EUR|JPY|million|billion|trillion|percent|points?))?",
    re.IGNORECASE,
)


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


def _page_text(page: dict) -> str:
    values: list[Any] = [page.get("title"), page.get("subtitle"), page.get("content"), page.get("quote")]
    values.extend(page.get("bullets") or [])
    for stat in page.get("stats") or []:
        values.extend([stat.get("value"), stat.get("label"), stat.get("desc")])
    return " ".join(str(value) for value in values if value)


def _fact_tokens(value: str) -> set[str]:
    tokens = set()
    for match in FACT_TOKEN_PATTERN.finditer(value or ""):
        token = _normalized_text(match.group(0)).strip(".,")
        digits = re.sub(r"\D", "", token)
        if len(digits) >= 2 or any(marker in token for marker in ("%", "원", "krw", "usd", "eur", "년", "월", "일")):
            tokens.add(token)
    return tokens


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
        unsupported = sorted(page_tokens - evidence_tokens)
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
