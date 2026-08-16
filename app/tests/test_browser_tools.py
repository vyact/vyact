import importlib

import pytest

from services import browser_tools
from services.tool_approval import get_tool_risk


def test_browser_url_rejects_local_and_private_addresses() -> None:
    with pytest.raises(ValueError):
        browser_tools._validate_public_url("http://localhost:8000")
    with pytest.raises(ValueError):
        browser_tools._validate_public_url("http://127.0.0.1/private")
    with pytest.raises(ValueError):
        browser_tools._validate_public_url("http://192.168.0.10")


def test_browser_url_allows_public_https() -> None:
    assert browser_tools._validate_public_url("https://example.com/path") == "https://example.com/path"


def test_browser_tool_risk_classification() -> None:
    assert get_tool_risk("browser_read") == "read"
    assert get_tool_risk("browser_read_urls") == "read"
    assert get_tool_risk("browser_search") == "read"
    assert get_tool_risk("browser_click") == "sensitive"
    assert get_tool_risk("browser_type") == "sensitive"
    assert get_tool_risk("browser_wait_for_user") == "sensitive"


def test_browser_tools_register_only_with_electron_bridge(monkeypatch) -> None:
    monkeypatch.delenv("VYACT_BROWSER_CONTROL_URL", raising=False)
    monkeypatch.delenv("VYACT_BROWSER_CONTROL_TOKEN", raising=False)
    module = importlib.reload(browser_tools)
    assert module.register_browser_tools() is False
