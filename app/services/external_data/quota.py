"""Shared daily request quota accounting for external public-data APIs."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

KOREA_TIMEZONE = timezone(timedelta(hours=9))


class DailyRequestQuotaExceededError(RuntimeError):
    error_code = "request_limit_exceeded"


@dataclass
class DailyRequestQuota:
    limit: int
    used: int
    request_date: str

    @property
    def exhausted(self) -> bool:
        return self.used >= self.limit

    @classmethod
    def from_status(cls, status: dict, limit: int) -> "DailyRequestQuota":
        request_date = datetime.now(KOREA_TIMEZONE).date().isoformat()
        used = int(status.get("request_count") or 0) if status.get("request_date") == request_date else 0
        return cls(limit=limit, used=used, request_date=request_date)

    def consume(self) -> None:
        if self.used >= self.limit:
            raise DailyRequestQuotaExceededError(
                f"일일 API 호출 한도 {self.limit:,}회를 모두 사용했습니다."
            )
        self.used += 1

    def status_fields(self) -> dict:
        return {
            "request_count": self.used,
            "request_limit": self.limit,
            "request_date": self.request_date,
        }
