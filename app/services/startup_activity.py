"""Coordinate optional startup warm-up work with foreground chat requests."""
import asyncio


_active_chat_count = 0
_chat_idle = asyncio.Event()
_chat_idle.set()


def begin_chat_activity() -> None:
    """Give an active chat request priority over optional model warm-up work."""
    global _active_chat_count
    _active_chat_count += 1
    _chat_idle.clear()


def end_chat_activity() -> None:
    """Release the foreground priority held by a completed chat request."""
    global _active_chat_count
    _active_chat_count = max(0, _active_chat_count - 1)
    if _active_chat_count == 0:
        _chat_idle.set()


async def wait_for_chat_idle() -> None:
    """Wait until no chat stream is using foreground inference resources."""
    while _active_chat_count > 0:
        await _chat_idle.wait()
