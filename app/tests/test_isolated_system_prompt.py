import unittest

from prompts import build_system_message
from services.llm.prepare import prepare_request


class IsolatedSystemPromptTests(unittest.TestCase):
    def test_isolated_prompt_is_returned_byte_for_byte(self):
        plugin_prompt = "PLUGIN ONLY\n두 번째 줄"

        result = build_system_message(
            plugin_prompt,
            format_instruction_override="BACKEND FORMAT",
            user_profile="BACKEND PROFILE",
            skill_context="BACKEND SKILL",
            conversation_summary="BACKEND SUMMARY",
            user_language="ko",
            isolated=True,
        )

        self.assertEqual(result, plugin_prompt)


class IsolatedPreparedRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_context_keeps_both_plugin_prompts_exact(self):
        _, system_message, user_prompt, history, _ = await prepare_request(
            "PLUGIN_USER_PROMPT",
            [],
            "PLUGIN_SYSTEM_PROMPT",
            [],
            [],
            "",
            False,
            "ollama",
            conversation_summary="",
            include_skills=False,
            isolated_system_prompt=True,
        )

        self.assertEqual(system_message, "PLUGIN_SYSTEM_PROMPT")
        self.assertEqual(user_prompt, "PLUGIN_USER_PROMPT")
        self.assertEqual(history, [])


if __name__ == "__main__":
    unittest.main()
