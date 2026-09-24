"""Translate Google API failures without treating every HTTP 403 as a quota error."""

import json

from googleapiclient.errors import HttpError


_TEMPORARY_RATE_LIMIT_REASONS = frozenset({"rateLimitExceeded", "userRateLimitExceeded"})


def is_google_rate_limited(error: Exception) -> bool:
    if not isinstance(error, HttpError):
        return False
    if error.resp.status == 429:
        return True
    if error.resp.status != 403:
        return False
    try:
        payload = json.loads(error.content)
    except (TypeError, ValueError, UnicodeDecodeError):
        return False
    details = payload.get("error", {}) if isinstance(payload, dict) else {}
    if not isinstance(details, dict):
        return False
    reasons = [item.get("reason") for item in details.get("errors", []) if isinstance(item, dict)]
    reasons.extend(item.get("reason") for item in details.get("details", []) if isinstance(item, dict))
    return any(reason in _TEMPORARY_RATE_LIMIT_REASONS for reason in reasons)
