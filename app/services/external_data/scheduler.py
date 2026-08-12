"""Background synchronization scheduler for connected external data sources."""

import asyncio
from datetime import datetime, timedelta, timezone

from logger import get_logger
from services.external_data.gov24 import get_sync_status, start_synchronization
from services.external_data.settings import load_external_data_connections

logger = get_logger(__name__)

SCHEDULER_CHECK_INTERVAL_SECONDS = 60
DEFAULT_INTERVAL_HOURS = 24
ALLOWED_INTERVAL_HOURS = {1, 3, 6, 12, 24}

_scheduler_task: asyncio.Task | None = None
_stop_event: asyncio.Event | None = None
_wake_event: asyncio.Event | None = None


def is_sync_due(last_successful_sync_at: str | None, interval_hours: int, now: datetime | None = None) -> bool:
    if not last_successful_sync_at:
        return True
    try:
        last_sync = datetime.fromisoformat(last_successful_sync_at.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return True
    if last_sync.tzinfo is None:
        last_sync = last_sync.replace(tzinfo=timezone.utc)
    current_time = now or datetime.now(timezone.utc)
    return current_time >= last_sync + timedelta(hours=interval_hours)


async def _run_due_synchronizations() -> None:
    connections = await load_external_data_connections()
    gov24 = connections.get("kr.gov24") or {}
    if not gov24.get("service_key") or not gov24.get("auto_sync_enabled", False):
        return
    interval_hours = gov24.get("auto_sync_interval_hours", DEFAULT_INTERVAL_HOURS)
    if interval_hours not in ALLOWED_INTERVAL_HOURS:
        interval_hours = DEFAULT_INTERVAL_HOURS
    status = await get_sync_status()
    # 실패 시 매분 API를 재호출하지 않고 선택한 주기만큼 기다린다. 이전 앱
    # 실행이 수집 도중 종료돼 status가 running으로 남은 경우에는 메모리 락이
    # 비어 있으므로 마지막 성공 시각을 기준으로 다시 시작할 수 있다.
    reference_time = (
        status.get("failed_at")
        if status.get("status") == "failed"
        else status.get("last_successful_sync_at")
    )
    if is_sync_due(reference_time, interval_hours):
        if start_synchronization(gov24["service_key"]):
            logger.info("[external-data] scheduled Government24 sync started (%sh)", interval_hours)


async def _run_scheduler() -> None:
    while _stop_event and not _stop_event.is_set():
        try:
            await _run_due_synchronizations()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning("[external-data] scheduler check failed: %s", error)
        try:
            await asyncio.wait_for(_wake_event.wait(), timeout=SCHEDULER_CHECK_INTERVAL_SECONDS)
            _wake_event.clear()
        except TimeoutError:
            continue


def start_external_data_scheduler() -> None:
    global _scheduler_task, _stop_event, _wake_event
    if _scheduler_task and not _scheduler_task.done():
        return
    _stop_event = asyncio.Event()
    _wake_event = asyncio.Event()
    _scheduler_task = asyncio.create_task(_run_scheduler(), name="external-data-scheduler")
    logger.info("[external-data] background scheduler started")


def request_external_data_schedule_check() -> None:
    if _scheduler_task and not _scheduler_task.done() and _wake_event:
        _wake_event.set()


async def stop_external_data_scheduler() -> None:
    global _scheduler_task, _stop_event, _wake_event
    if not _scheduler_task:
        return
    if _stop_event:
        _stop_event.set()
    if _wake_event:
        _wake_event.set()
    await _scheduler_task
    _scheduler_task = None
    _stop_event = None
    _wake_event = None
    logger.info("[external-data] background scheduler stopped")
