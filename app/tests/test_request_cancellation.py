import asyncio
import unittest

from services.request_cancellation import await_while_connected


class FakeRequest:
    def __init__(self):
        self.disconnected = False

    async def is_disconnected(self):
        return self.disconnected


class RequestCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_completed_operation_returns_result(self):
        self.assertEqual(
            await await_while_connected(FakeRequest(), asyncio.sleep(0, result='ok')),
            'ok',
        )

    async def test_disconnect_cancels_operation(self):
        request = FakeRequest()
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def operation():
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        task = asyncio.create_task(await_while_connected(request, operation()))
        await started.wait()
        request.disconnected = True
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)
        self.assertTrue(cancelled.is_set())

    async def test_parent_cancellation_cleans_up_operation(self):
        cancelled = asyncio.Event()
        started = asyncio.Event()

        async def operation():
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        task = asyncio.create_task(await_while_connected(FakeRequest(), operation()))
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(cancelled.is_set())
