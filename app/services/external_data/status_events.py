"""In-process notifications for external-data synchronization status changes."""

import asyncio

_condition = asyncio.Condition()
_versions: dict[str, int] = {}


async def notify_status_changed(source_id: str) -> None:
    async with _condition:
        _versions[source_id] = _versions.get(source_id, 0) + 1
        _condition.notify_all()


def status_versions(source_ids: list[str]) -> dict[str, int]:
    return {source_id: _versions.get(source_id, 0) for source_id in source_ids}


async def wait_for_status_change(
    versions: dict[str, int],
    timeout_seconds: float = 15.0,
) -> None:
    async with _condition:
        try:
            await asyncio.wait_for(
                _condition.wait_for(
                    lambda: any(
                        _versions.get(source_id, 0) != version
                        for source_id, version in versions.items()
                    )
                ),
                timeout=timeout_seconds,
            )
        except TimeoutError:
            # Periodic wake-up keeps SSE connections healthy without polling ES.
            return
