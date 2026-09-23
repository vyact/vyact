import unittest
from unittest.mock import AsyncMock

from services.tool_approval import (
    ApprovalContext, await_tool_approval, current_approval_context,
    resolve_tool_approval, get_tool_risk, requires_approval,
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
            ('risky_only', 'user_memory_delete', True),
            ('always_confirm', 'user_memory_delete', True),
            ('trusted', 'user_memory_delete', True),
            ('trusted', 'browser_ask_user', False),
            ('risky_only', 'code_read_file', True),
            ('always_confirm', 'user_memory_list', True),
            ('risky_only', 'code_edit_file', True),
        ]:
            with self.subTest(mode=mode, tool=tool):
                await self.check_gate(mode, tool, expected)

    async def test_trusted_read_metadata_skips_gate_and_destructive_metadata_emits_risk(self):
        token = current_approval_context.set(ApprovalContext(interactive=True))
        try:
            emit = AsyncMock()
            self.assertTrue(await await_tool_approval("Custom__lookup", {}, emit,
                annotations={"readOnlyHint": True}, annotations_trusted=True))
            emit.assert_not_awaited()

            async def reject(event):
                self.assertEqual(event["risk"], "destructive")
                resolve_tool_approval(event["approval_id"], False)

            self.assertFalse(await await_tool_approval("Custom__action", {}, reject,
                annotations={"destructiveHint": True}, annotations_trusted=True))
        finally:
            current_approval_context.reset(token)

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


class McpApprovalMetadataTests(unittest.TestCase):
    def test_read_only_requires_explicit_server_trust(self):
        for name in ("Search__web_search_exa", "Docs__resolve_library", "Other__lookup"):
            with self.subTest(name=name):
                hints = {"readOnlyHint": True}
                self.assertTrue(requires_approval(name, "risky_only", hints))
                self.assertFalse(requires_approval(name, "risky_only", hints, True))
                self.assertFalse(requires_approval(name, "always_confirm", hints, True))

    def test_missing_or_non_read_metadata_remains_approval_gated(self):
        for hints in (None, {}, {"readOnlyHint": False}, {"readOnlyHint": "true"},
                      {"destructiveHint": False}, {"idempotentHint": True},
                      {"openWorldHint": False}):
            with self.subTest(hints=hints):
                self.assertTrue(requires_approval("Custom__get_and_delete", "risky_only", hints, True))

    def test_destructive_and_conflicting_hints_cannot_bypass_approval(self):
        for hints in ({"destructiveHint": True}, {"readOnlyHint": True, "destructiveHint": True}):
            self.assertEqual(get_tool_risk("Custom__action", hints, True), "destructive")
            for mode in ("trusted", "risky_only", "always_confirm"):
                self.assertTrue(requires_approval("Custom__action", mode, hints, True))
        self.assertTrue(requires_approval("Custom__delete_file", "trusted", {"readOnlyHint": True}, True))

    def test_external_hints_do_not_override_internal_policy(self):
        self.assertTrue(requires_approval("send_email", "risky_only", {"readOnlyHint": True}, True))
        self.assertFalse(requires_approval("web_search", "risky_only"))
