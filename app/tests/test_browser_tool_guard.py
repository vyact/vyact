from services.llm.providers import _ToolCallGuard


def execute(guard, name, args=None, result='{"ok":true}'):
    fingerprint = guard.fingerprint(name, args or {})
    assert not guard.repeated(name, fingerprint)
    guard.record(name, fingerprint, result)


def test_page_navigation_allows_inspection_again():
    guard = _ToolCallGuard()
    execute(guard, 'browser_inspect')
    assert guard.repeated('browser_inspect', guard.fingerprint('browser_inspect', {}))
    execute(guard, 'browser_open', {'url': 'https://example.com/product'})
    execute(guard, 'browser_inspect')


def test_typing_and_scrolling_allow_fresh_reads():
    guard = _ToolCallGuard()
    execute(guard, 'browser_read')
    execute(guard, 'browser_type', {'element_id': 'field', 'text': 'desk'})
    execute(guard, 'browser_read')
    execute(guard, 'browser_scroll', {'amount': 700})
    execute(guard, 'browser_read')
    execute(guard, 'browser_scroll', {'amount': 700})
    execute(guard, 'browser_read')


def test_failed_navigation_does_not_unlock_repeated_read():
    guard = _ToolCallGuard()
    execute(guard, 'browser_read')
    execute(guard, 'browser_open', {'url': 'https://example.com'}, '{"ok":false,"error":"failed"}')
    assert guard.repeated('browser_read', guard.fingerprint('browser_read', {}))


def test_polling_is_bounded_but_changed_status_unlocks_read():
    guard = _ToolCallGuard()
    execute(guard, 'browser_read')
    for _ in range(3):
        execute(guard, 'browser_status', result='{"loading":true}')
    assert guard.repeated('browser_status', guard.fingerprint('browser_status', {}))
    execute(guard, 'browser_wait', {'seconds': 1}, '{"loading":false}')
    execute(guard, 'browser_read')


def test_browser_progress_does_not_unlock_unrelated_mutation():
    guard = _ToolCallGuard()
    execute(guard, 'send_email', {'id': 'one'})
    execute(guard, 'browser_open', {'url': 'https://example.com'})
    assert guard.repeated('send_email', guard.fingerprint('send_email', {'id': 'one'}))


def test_immediate_duplicate_click_remains_blocked():
    guard = _ToolCallGuard()
    execute(guard, 'browser_click', {'element_id': 'cart'})
    assert guard.repeated('browser_click', guard.fingerprint('browser_click', {'element_id': 'cart'}))
    execute(guard, 'browser_inspect')
    execute(guard, 'browser_click', {'element_id': 'cart'})
