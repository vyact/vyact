import asyncio
import unittest

from services.startup_activity import (
    begin_chat_activity,
    end_chat_activity,
    wait_for_chat_idle,
)


class StartupActivityTests(unittest.IsolatedAsyncioTestCase):
    async def test_warmup_waits_until_all_active_chats_finish(self):
        begin_chat_activity()
        begin_chat_activity()
        waiter = asyncio.create_task(wait_for_chat_idle())

        await asyncio.sleep(0)
        self.assertFalse(waiter.done())

        end_chat_activity()
        await asyncio.sleep(0)
        self.assertFalse(waiter.done())

        end_chat_activity()
        await asyncio.wait_for(waiter, timeout=0.1)


if __name__ == "__main__":
    unittest.main()
