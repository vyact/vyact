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
    assert get_tool_risk("browser_click") == "sensitive"
    assert get_tool_risk("browser_type") == "sensitive"
    assert get_tool_risk("browser_wait_for_user") == "sensitive"


def test_browser_tools_register_for_extension_or_electron(monkeypatch) -> None:
    monkeypatch.delenv("VYACT_BROWSER_CONTROL_URL", raising=False)
    monkeypatch.delenv("VYACT_BROWSER_CONTROL_TOKEN", raising=False)
    module = importlib.reload(browser_tools)
    assert module.register_browser_tools() is True
