import importlib

import pytest

from logger import DebugLogSettings
from services import browser_tools
from services.tool_approval import get_tool_risk, requires_approval


def test_browser_url_rejects_local_and_private_addresses() -> None:
    with pytest.raises(ValueError):
        browser_tools._validate_public_url("http://localhost:8000")
    with pytest.raises(ValueError):
        browser_tools._validate_public_url("http://127.0.0.1/private")
    with pytest.raises(ValueError):
        browser_tools._validate_public_url("http://192.168.0.10")


def test_browser_url_allows_public_https() -> None:
    assert browser_tools._validate_public_url("https://example.com/path") == "https://example.com/path"


def test_project_browser_allows_local_and_private_addresses() -> None:
    token = browser_tools.current_code_folders.set({"project": "/tmp/project"})
    try:
        assert browser_tools._validate_public_url("http://localhost:5173") == "http://localhost:5173"
        assert browser_tools._validate_public_url("localhost:3000") == "http://localhost:3000"
        assert browser_tools._validate_public_url("http://192.168.0.10:8080") == "http://192.168.0.10:8080"
    finally:
        browser_tools.current_code_folders.reset(token)


def test_project_browser_still_rejects_non_http_urls() -> None:
    token = browser_tools.current_code_folders.set({"project": "/tmp/project"})
    try:
        with pytest.raises(ValueError):
            browser_tools._validate_public_url("file:///etc/passwd")
    finally:
        browser_tools.current_code_folders.reset(token)


def test_browser_tool_risk_classification() -> None:
    assert get_tool_risk("browser_read") == "read"
    assert get_tool_risk("browser_read_urls") == "read"
    assert get_tool_risk("browser_search") == "read"
    assert get_tool_risk("browser_click") == "write"
    assert get_tool_risk("browser_type") == "write"
    assert get_tool_risk("browser_wait_for_user") == "sensitive"


def test_page_result_removes_empty_and_duplicate_links() -> None:
    result = browser_tools._compact_page_result({
        "url": "https://example.com",
        "title": "Example",
        "text": "Visible text   \n\n\n\nMore text",
        "links": [
            {"text": "", "url": "https://example.com/image"},
            {"text": " Product   one ", "url": "https://example.com/product"},
            {"text": "Duplicate", "url": "https://example.com/product"},
        ],
        "html": "<style>.unused{color:red}</style><script>track()</script>",
    })

    assert result == {
        "url": "https://example.com",
        "title": "Example",
        "text": "Visible text\n\nMore text",
        "links": [{"text": "Product one", "url": "https://example.com/product"}],
    }


def test_risky_only_allows_routine_browser_interactions() -> None:
    assert requires_approval("browser_click", "risky_only") is False
    assert requires_approval("browser_type", "risky_only") is False
    assert requires_approval("browser_click", "always_confirm") is True
    assert requires_approval("browser_type", "always_confirm") is True
    assert requires_approval("browser_ask_user", "trusted") is True


def test_browser_tools_register_for_extension_or_electron(monkeypatch) -> None:
    monkeypatch.delenv("VYACT_BROWSER_CONTROL_URL", raising=False)
    monkeypatch.delenv("VYACT_BROWSER_CONTROL_TOKEN", raising=False)
    module = importlib.reload(browser_tools)
    assert module.register_browser_tools() is True


def test_debug_logging_masks_user_input() -> None:
    assert DebugLogSettings.redact_arguments({
        "element_id": "vyact-12",
        "text": "private input",
        "nested": {"token": "secret", "url": "https://example.com"},
    }) == {
        "element_id": "vyact-12",
        "text": "[REDACTED]",
        "nested": {"token": "[REDACTED]", "url": "https://example.com"},
    }
