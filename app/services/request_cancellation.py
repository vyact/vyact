"""Cancel request work when the HTTP client disconnects."""
import asyncio

from fastapi import Request


async def await_while_connected(request: Request, operation):
    async def wait_for_disconnect():
        while not await request.is_disconnected():
            await asyncio.sleep(0.1)

    work = asyncio.create_task(operation)
    disconnect = asyncio.create_task(wait_for_disconnect())
    try:
        done, _ = await asyncio.wait(
            {work, disconnect}, return_when=asyncio.FIRST_COMPLETED
        )
        if disconnect in done:
            await disconnect
            raise asyncio.CancelledError("HTTP client disconnected")
        return await work
    finally:
        for task in (work, disconnect):
            if not task.done():
                task.cancel()
        await asyncio.gather(work, disconnect, return_exceptions=True)
