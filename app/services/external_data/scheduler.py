"""Background synchronization scheduler for connected external data sources."""

import asyncio
from datetime import datetime, timedelta, timezone

from logger import get_logger
from services.external_data.cleanup import (
    is_cleanup_due,
    is_cleanup_running,
    start_expired_document_cleanup,
)
from services.external_data.biz_support import (
    start_synchronization as start_biz_support_synchronization,
)
from services.external_data.gov24 import start_synchronization
from services.external_data.housing import (
    start_synchronization as start_housing_synchronization,
)
from services.external_data.lh_lease_complex import (
    start_synchronization as start_lh_complex_synchronization,
)
from services.external_data.lh_lease_notice import (
    start_synchronization as start_lh_notice_synchronization,
)
from services.external_data.k_startup import (
    start_synchronization as start_k_startup_synchronization,
)
from services.external_data.welfare import (
    start_synchronization as start_welfare_synchronization,
)
from services.external_data.settings import load_external_data_connections
from services.external_data.statuses import load_sync_statuses

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
    shared_service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    schedule_config = connections.get("kr.gov24") or {}
    if schedule_config.get("auto_delete_expired_enabled", False) and await is_cleanup_due():
        if start_expired_document_cleanup():
            logger.info("[external-data] expired document cleanup started")
    if is_cleanup_running():
        return
    auto_sync_enabled = schedule_config.get("auto_sync_enabled", False)
    interval_hours = schedule_config.get("auto_sync_interval_hours", DEFAULT_INTERVAL_HOURS)
    if interval_hours not in ALLOWED_INTERVAL_HOURS:
        interval_hours = DEFAULT_INTERVAL_HOURS
    if not shared_service_key or not auto_sync_enabled:
        return

    source_handlers = {
        "kr.gov24": (start_synchronization, "Government24"),
        "kr.biz_support": (start_biz_support_synchronization, "BizInfo support"),
        "kr.k_startup": (start_k_startup_synchronization, "K-Startup"),
        "kr.welfare": (start_welfare_synchronization, "welfare"),
        "kr.housing": (start_housing_synchronization, "housing"),
        "kr.lh_lease_complex": (start_lh_complex_synchronization, "kr.lh_lease_complex"),
        "kr.lh_lease_notice": (start_lh_notice_synchronization, "kr.lh_lease_notice"),
    }
    enabled_source_ids = [
        source_id
        for source_id in source_handlers
        if (connections.get(source_id) or {}).get("enabled", source_id == "kr.gov24")
    ]
    statuses = await load_sync_statuses(enabled_source_ids)
    for source_id in enabled_source_ids:
        status = statuses.get(source_id, {})
        reference_time = (
            status.get("failed_at")
            if status.get("status") == "failed"
            else status.get("last_successful_sync_at")
        )
        start_callback, source_label = source_handlers[source_id]
        if is_sync_due(reference_time, interval_hours) and start_callback(shared_service_key):
            logger.info("[external-data] scheduled %s sync started (%sh)", source_label, interval_hours)


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
