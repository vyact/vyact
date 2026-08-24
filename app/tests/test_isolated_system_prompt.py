import unittest
from unittest.mock import AsyncMock, patch

from prompts import build_system_message
from services.llm.prepare import prepare_request


class IsolatedSystemPromptTests(unittest.TestCase):
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
            + "\n\n[응답 언어]\n사용자 UI 언어는 한국어입니다. "
              "사용자가 다른 언어를 명시적으로 요청하지 않는 한, 반드시 한국어로 답변하세요. "
              "제목과 섹션명도 한국어로 작성하세요.",
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

        self.assertNotIn("[응답 언어]", result)
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

        self.assertTrue(system_message.startswith("PLUGIN_SYSTEM_PROMPT\n\n[응답 언어]"))
        self.assertIn("반드시 한국어로 답변하세요", system_message)
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

        self.assertNotIn("[응답 언어]", system_message)
        self.assertNotIn("English", system_message)


if __name__ == "__main__":
    unittest.main()
