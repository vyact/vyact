import unittest
from unittest.mock import AsyncMock, patch

from prompts import build_system_message
from services.llm.prepare import prepare_request


class IsolatedSystemPromptTests(unittest.TestCase):
    def test_regular_prompt_calibrates_response_length(self):
        result = build_system_message(
            "SYSTEM PROMPT",
            format_instruction_override=None,
            user_language="ko",
        )

        self.assertIn("[Response length]", result)
        self.assertIn("greetings, simple recommendations, and short factual questions", result)
        self.assertIn("1–3 sentences", result)

    def test_reasoning_prompt_reserves_tokens_before_dynamic_context(self):
        result = build_system_message(
            "SYSTEM PROMPT",
            format_instruction_override=None,
            user_language="ko",
            reasoning=True,
        )

        instruction = "추론은 필요한 만큼만 간결하게 수행하고, 최종 답변을 위한 출력 토큰을 반드시 남겨두세요."
        self.assertIn(instruction, result)
        self.assertLess(result.index("[Response length]"), result.index(instruction))
        self.assertLess(result.index(instruction), result.index("Current date:"))

    def test_reasoning_prompt_is_excluded_when_reasoning_is_off(self):
        result = build_system_message(
            "SYSTEM PROMPT",
            format_instruction_override=None,
            user_language="ko",
            reasoning=False,
        )

        self.assertNotIn("[Reasoning budget]", result)

    def test_isolated_prompt_adds_only_response_language_rule(self):
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

        self.assertEqual(
            result,
            plugin_prompt
            + "\n\n[Response language]\nThe user's UI language is Korean. "
              "Respond in Korean unless the user explicitly requests another language. "
              "Use Korean for headings and section titles as well.",
        )
        self.assertNotIn("BACKEND FORMAT", result)
        self.assertNotIn("BACKEND PROFILE", result)
        self.assertNotIn("BACKEND SKILL", result)
        self.assertNotIn("BACKEND SUMMARY", result)

    def test_response_language_rule_can_be_excluded(self):
        result = build_system_message(
            "TRANSLATE ONLY",
            format_instruction_override="",
            user_language="en",
            include_response_language=False,
        )

        self.assertNotIn("[Response language]", result)
        self.assertNotIn("English", result)


class IsolatedPreparedRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_context_keeps_plugin_prompt_and_adds_server_language(self):
        with patch("routers.deps.load_ui_language_async", AsyncMock(return_value="ko")):
            _, system_message, user_prompt, history, _ = await prepare_request(
                "PLUGIN_USER_PROMPT",
                [],
                "PLUGIN_SYSTEM_PROMPT",
                [],
                [],
                "",
                False,
                "openai",
                conversation_summary="",
                include_skills=False,
                isolated_system_prompt=True,
            )

        self.assertTrue(system_message.startswith("PLUGIN_SYSTEM_PROMPT\n\n[Response language]"))
        self.assertIn("Respond in Korean", system_message)
        self.assertEqual(user_prompt, "PLUGIN_USER_PROMPT")
        self.assertEqual(history, [])

    async def test_prepared_request_can_exclude_response_language_rule(self):
        with patch("routers.deps.load_ui_language_async", AsyncMock(return_value="en")):
            _, system_message, _, _, _ = await prepare_request(
                "TRANSLATE_USER_PROMPT",
                [],
                "",
                [],
                [],
                "",
                False,
                "openai",
                include_skills=False,
                include_response_language=False,
            )

        self.assertNotIn("[Response language]", system_message)
        self.assertNotIn("English", system_message)


if __name__ == "__main__":
    unittest.main()
