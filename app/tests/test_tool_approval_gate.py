import unittest
from unittest.mock import AsyncMock

from services.tool_approval import (
    ApprovalContext, await_tool_approval, current_approval_context,
    resolve_tool_approval,
)


class ApprovalGateTests(unittest.IsolatedAsyncioTestCase):
    async def check_gate(self, mode, tool, expected):
        token = current_approval_context.set(ApprovalContext(mode=mode))
        emit = AsyncMock()
        try:
            self.assertEqual(await await_tool_approval(tool, {}, emit), expected)
            emit.assert_not_awaited()
        finally:
            current_approval_context.reset(token)

    async def test_noninteractive_policy(self):
        for mode, tool, expected in [
            ('risky_only', 'send_email', False),
            ('always_confirm', 'code_edit_file', False),
            ('trusted', 'send_email', True),
            ('trusted', 'code_edit_file', True),
            ('trusted', 'code_delete_file', False),
            ('trusted', 'browser_ask_user', False),
            ('risky_only', 'code_read_file', True),
            ('risky_only', 'code_edit_file', True),
        ]:
            with self.subTest(mode=mode, tool=tool):
                await self.check_gate(mode, tool, expected)

    async def test_missing_context_cannot_send_email(self):
        self.assertFalse(await await_tool_approval('send_email', {}, AsyncMock()))

    async def test_interactive_approval_and_rejection(self):
        token = current_approval_context.set(ApprovalContext(interactive=True))
        try:
            for approved in [True, False]:
                async def emit(event):
                    self.assertEqual(event['phase'], 'approval_required')
                    self.assertTrue(resolve_tool_approval(event['approval_id'], approved))
                self.assertEqual(await await_tool_approval('send_email', {}, emit), approved)
        finally:
            current_approval_context.reset(token)
