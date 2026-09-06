"""Persistent throttling and transport integration without network access."""
import asyncio
import sqlite3
import os
import subprocess
import sys
import json
from contextvars import Context
from email.utils import formatdate
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.datastructures import FormData, UploadFile
from io import BytesIO
from routers import microsoft_workspace as router
from error_responses import http_exception_handler

from services.microsoft_workspace import auth, notifications, calendar_notifications, request_limits as limits
from services.microsoft_workspace.transport import managed_request


@pytest.fixture
def limiter(tmp_path, monkeypatch):
    now = [2_000_000_000.0]
    manager = limits.MicrosoftRequestLimiter(tmp_path / 'limits.db', clock=lambda: now[0])
    monkeypatch.setattr(limits, 'request_limiter', manager)
    return manager, now


def test_cooldown_survives_restart_and_expires(limiter):
    manager, now = limiter
    scope = limits.request_scope('client', 'user@example.com', 'outlook')
    assert manager.block(scope, '90').headers == {'Retry-After': '90'}
    now[0] += 20
    restarted = limits.MicrosoftRequestLimiter(manager.path, clock=lambda: now[0])
    assert restarted.remaining(scope) == 70
    with pytest.raises(HTTPException) as caught:
        restarted.reserve(scope)
    assert caught.value.headers['Retry-After'] == '70'
    now[0] += 70
    restarted.reserve(scope)


def test_retry_after_dates_fallback_and_no_shortening(limiter):
    manager, now = limiter
    scope = limits.request_scope('app', 'user', 'outlook')
    manager.block(scope, formatdate(now[0] + 120, usegmt=True))
    manager.block(scope, '2')
    assert manager.remaining(scope) == 120
    fallback = limits.request_scope('app', 'other', 'outlook')
    assert manager.block(fallback, 'invalid').headers['Retry-After'] == '10'
    now[0] += 10
    assert manager.block(fallback).headers['Retry-After'] == '20'


def test_identity_and_service_isolation(limiter):
    manager, _ = limiter
    token = {'email': 'User@Example.com', 'mailbox_id': 'mailbox'}
    scope = auth.scope_for_token('APP', token, 'slot-one', 'outlook')
    same = auth.scope_for_token('app', {**token, 'email': 'user@example.com'}, 'slot-two', 'outlook')
    assert scope == same
    manager.block(scope, '60')
    assert manager.remaining(same) == 60
    assert manager.remaining(auth.scope_for_token('other-app', token, 'slot-two', 'outlook')) == 0
    assert manager.remaining(auth.scope_for_token('app', token, 'slot-one', 'drive')) == 0
    assert 'example.com' not in manager.path.read_bytes().decode(errors='ignore')


def test_window_counts_batch_units_and_survives_restart(limiter, monkeypatch):
    manager, now = limiter
    monkeypatch.setitem(limits.BUDGETS, 'outlook', limits.RequestBudget(60, 5))
    scope = limits.request_scope('app', 'user', 'outlook')
    manager.reserve(scope, units=4)
    now[0] += 10
    restarted = limits.MicrosoftRequestLimiter(manager.path, clock=lambda: now[0])
    with pytest.raises(HTTPException) as caught:
        restarted.reserve(scope, units=2)
    assert caught.value.headers['Retry-After'] == '50'
    now[0] += 50
    restarted.reserve(scope, units=2)


def test_upload_bytes_use_separate_window(limiter, monkeypatch):
    manager, now = limiter
    monkeypatch.setitem(limits.BUDGETS, 'outlook', limits.RequestBudget(600, 100, 10, 300))
    scope = limits.request_scope('app', 'user', 'outlook')
    manager.reserve(scope, upload_bytes=8)
    now[0] += 100
    with pytest.raises(HTTPException) as caught:
        manager.reserve(scope, upload_bytes=3)
    assert caught.value.headers['Retry-After'] == '200'
    now[0] += 200
    manager.reserve(scope, upload_bytes=3)


@pytest.mark.asyncio
async def test_queued_request_checks_cooldown_again_and_slots_are_released(limiter):
    manager, _ = limiter
    scope = limits.request_scope('app', 'user', 'outlook')
    entered, release = asyncio.Event(), asyncio.Event()
    active = peak = 0
    async def work():
        nonlocal active, peak
        async with manager.request(scope):
            active += 1
            peak = max(peak, active)
            if active == limits.CONCURRENT_REQUESTS:
                entered.set()
            try:
                await release.wait()
            finally:
                active -= 1
    tasks = [asyncio.create_task(work()) for _ in range(4)]
    await entered.wait()
    manager.block(scope, '60')
    release.set()
    results = await asyncio.gather(*tasks, return_exceptions=True)
    assert peak == 3
    assert sum(isinstance(result, HTTPException) for result in results) == 1
    assert manager._slots[scope]._value == 3


@pytest.mark.asyncio
async def test_batch_429_honors_longest_delay_and_never_reissues(limiter):
    manager, _ = limiter
    scope = limits.request_scope('app', 'user', 'outlook')
    client = AsyncMock()
    client.request.return_value = httpx.Response(200, json={'responses': [
        {'id': '1', 'status': 424},
        {'id': '2', 'status': 429, 'headers': {'Retry-After': '15'}},
        {'id': '3', 'status': 429, 'headers': {'retry-after': '80'}},
    ]})
    with pytest.raises(HTTPException) as caught:
        await managed_request(client, scope, 'POST', 'https://graph.microsoft.com/v1.0/$batch', units=3, batch=True)
    assert caught.value.headers['Retry-After'] == '80'
    with pytest.raises(HTTPException):
        await managed_request(client, scope, 'GET', 'https://graph.microsoft.com/v1.0/me/messages')
    client.request.assert_awaited_once()
    with sqlite3.connect(manager.path) as db:
        assert db.execute('SELECT SUM(units) FROM requests').fetchone()[0] == 3


@pytest.mark.asyncio
async def test_real_graph_scope_blocks_before_refresh(limiter, monkeypatch):
    manager, _ = limiter
    token = {'email': 'same@example.com', 'client_id': 'client', 'refresh_token': 'secret', 'expires_at': 0}
    monkeypatch.setattr(auth, 'account', AsyncMock(return_value=({'client_id': 'client'}, {'id': 'slot-two'})))
    monkeypatch.setattr(auth, 'read_token', AsyncMock(return_value=token))
    access = AsyncMock()
    monkeypatch.setattr(auth, 'access_token', access)
    manager.block(auth.scope_for_token('client', token, 'slot-one', 'outlook'), '60')
    with pytest.raises(HTTPException) as caught:
        await auth.graph('/me/messages', account_id='slot-two')
    assert caught.value.status_code == 429
    access.assert_not_awaited()


@pytest.mark.asyncio
async def test_background_collectors_skip_throttled_account_without_logging(limiter, monkeypatch):
    manager, _ = limiter
    state = {'accounts': [{'id': 'a', 'authenticated': True}, {'id': 'b', 'authenticated': True}],
             'config': {'accounts': [{'id': 'a', 'mail_notifications': True}, {'id': 'b', 'mail_notifications': True}]}}
    manager.block(limits.request_scope('client', 'a', 'outlook'), '60')
    monkeypatch.setattr(auth, 'scope_for_account', AsyncMock(side_effect=lambda account_id, service: limits.request_scope('client', account_id, service)))
    monkeypatch.setattr(auth, 'access_token', AsyncMock(return_value=('token', {'id': 'b'})))
    client = AsyncMock()
    client.request.return_value = httpx.Response(200, json={'value': []})
    factory = AsyncMock()
    factory.__aenter__.return_value = client
    monkeypatch.setattr(auth.httpx, 'AsyncClient', lambda **kwargs: factory)
    monkeypatch.setattr(notifications, 'status', AsyncMock(return_value=state))
    monkeypatch.setattr(calendar_notifications, 'status', AsyncMock(return_value=state))
    log = Mock()
    monkeypatch.setattr(calendar_notifications.logger, 'exception', log)
    for _ in range(3):
        await notifications.collect_microsoft_notifications()
        await calendar_notifications.collect_microsoft_calendar_notifications()
    assert client.request.await_count == 6
    log.assert_not_called()


@pytest.mark.asyncio
async def test_signed_upload_uses_shared_outlook_cooldown_without_bearer(limiter, monkeypatch):
    manager, _ = limiter
    scope = limits.request_scope('client', 'mailbox', 'outlook')
    monkeypatch.setattr(auth, 'scope_for_account', AsyncMock(return_value=scope))
    client = AsyncMock()
    client.request.return_value = httpx.Response(429, headers={'Retry-After': '45'})
    with pytest.raises(HTTPException) as caught:
        await auth.external_request(client, 'PUT', 'https://upload.example.test/private-session',
                                    account_id='account', service='outlook', content=b'file', headers={'Content-Range': 'bytes 0-3/4'})
    assert caught.value.headers['Retry-After'] == '45'
    assert 'Authorization' not in client.request.call_args.kwargs['headers']
    with pytest.raises(HTTPException):
        await managed_request(client, scope, 'GET', 'https://graph.microsoft.com/v1.0/me/messages')
    client.request.assert_awaited_once()


def test_cooldown_is_readable_by_a_fresh_python_process(limiter, tmp_path):
    manager, now = limiter
    scope = limits.request_scope('app', 'user', 'outlook')
    manager.block(scope, '90')
    script = "from pathlib import Path; from services.microsoft_workspace.request_limits import MicrosoftRequestLimiter; import sys; print(MicrosoftRequestLimiter(Path(sys.argv[1]), clock=lambda: 2000000020).remaining(sys.argv[2]))"
    result = subprocess.run([sys.executable, '-c', script, str(manager.path), scope],
                            env={**os.environ, 'VYACT_INSTALL_DIR': str(tmp_path / 'runtime')},
                            capture_output=True, text=True, check=True)
    assert result.stdout.strip() == '70'


@pytest.mark.asyncio
async def test_public_api_response_retains_remaining_seconds(limiter):
    manager, _ = limiter
    error = manager.block(limits.request_scope('app', 'user', 'outlook'), '75')
    response = await http_exception_handler(Request({'type': 'http'}), error)
    assert response.status_code == 429
    assert response.headers['Retry-After'] == '75'
    assert json.loads(response.body)['code'] == 'microsoft_rate_limited'


def test_corrupt_persistence_fails_closed_instead_of_resetting(limiter):
    manager, _ = limiter
    manager.path.write_text('invalid sqlite file')
    with pytest.raises(HTTPException) as caught:
        manager.reserve(limits.request_scope('app', 'user', 'outlook'))
    assert caught.value.status_code == 503
    assert manager.path.read_text() == 'invalid sqlite file'


@pytest.mark.asyncio
async def test_whole_upload_admission_counts_history_and_other_reservations(limiter, monkeypatch):
    manager, now = limiter
    monkeypatch.setitem(limits.BUDGETS, 'outlook', limits.RequestBudget(600, 100, 10))
    scope = limits.request_scope('app', 'mailbox', 'outlook')
    manager.reserve(scope, upload_bytes=4)
    async with manager.upload(scope, 6):
        with pytest.raises(HTTPException) as caught:
            async with manager.upload(scope, 1):
                pytest.fail('Concurrent upload must be rejected before starting')
        assert caught.value.status_code == 429
        manager.reserve(scope, upload_bytes=3)
        manager.reserve(scope, upload_bytes=3)
    with manager._database() as db:
        assert db.execute('SELECT SUM(upload_bytes) FROM requests').fetchone()[0] == 10
        assert db.execute('SELECT COUNT(*) FROM upload_reservations').fetchone()[0] == 0
    now[0] += 300
    async with manager.upload(scope, 10):
        pass


@pytest.mark.asyncio
async def test_upload_failure_releases_only_unsent_bytes(limiter, monkeypatch):
    manager, _ = limiter
    monkeypatch.setitem(limits.BUDGETS, 'outlook', limits.RequestBudget(600, 100, 10))
    scope = limits.request_scope('app', 'mailbox', 'outlook')
    with pytest.raises(ValueError):
        async with manager.upload(scope, 10):
            manager.reserve(scope, upload_bytes=4)
            raise ValueError('failed')
    async with manager.upload(scope, 6):
        restarted = limits.MicrosoftRequestLimiter(manager.path, clock=manager.clock)
        with pytest.raises(HTTPException):
            Context().run(restarted.reserve, scope, upload_bytes=1)


@pytest.mark.asyncio
async def test_mail_preflight_rejects_before_draft_creation(limiter, monkeypatch):
    manager, _ = limiter
    scope = limits.request_scope('app', 'mailbox', 'outlook')
    monkeypatch.setitem(limits.BUDGETS, 'outlook', limits.RequestBudget(600, 100, 1000))
    manager.reserve(scope, upload_bytes=990)
    monkeypatch.setattr(auth, 'scope_for_account', AsyncMock(return_value=scope))
    graph = AsyncMock()
    monkeypatch.setattr(auth, 'graph', graph)
    request = Mock()
    request.form = AsyncMock(return_value=FormData({'subject': 'test', 'to': 'a@example.com'}))
    with pytest.raises(HTTPException) as caught:
        await router.send_mail(request, 'account')
    assert caught.value.status_code == 429
    graph.assert_not_awaited()


@pytest.mark.asyncio
async def test_drive_validates_entire_selection_before_remote_writes(monkeypatch):
    monkeypatch.setattr(router, 'MAX_DRIVE_UPLOAD_BYTES', 4)
    graph = AsyncMock()
    monkeypatch.setattr(auth, 'graph', graph)
    request = Mock()
    request.form = AsyncMock(return_value=FormData([
        ('directories', 'folder'),
        ('files', UploadFile(BytesIO(b'ok'), filename='first.txt')),
        ('files', UploadFile(BytesIO(b'too large'), filename='second.txt')),
    ]))
    with pytest.raises(HTTPException) as caught:
        await router.upload_files(request, 'account')
    assert caught.value.status_code == 413
    graph.assert_not_awaited()
