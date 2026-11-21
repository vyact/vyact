import asyncio
from unittest.mock import AsyncMock

import pytest

from routers import chat
from services import chat_queue


@pytest.mark.asyncio
@pytest.mark.parametrize('first_client', ['desktop', 'chrome'])
async def test_clients_wait_and_cancel_without_blocking_following_requests(monkeypatch, first_client):
    lock = asyncio.Lock()
    monkeypatch.setattr(chat, 'chat_request_lock', lock)
    started = asyncio.Event()
    release = asyncio.Event()
    calls = []

    async def respond(req):
        calls.append(req.question)
        if req.question == first_client:
            started.set()
            await release.wait()
        return {'answer': req.question}

    monkeypatch.setattr(chat, '_query_serialized', respond)
    first = asyncio.create_task(chat.query(chat.QueryRequest(question=first_client)))
    await started.wait()
    cancelled = asyncio.create_task(chat.query(chat.QueryRequest(question='cancelled')))
    following = asyncio.create_task(chat.query(chat.QueryRequest(question='following')))
    await asyncio.sleep(0)
    assert calls == [first_client]
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    release.set()
    await first
    assert await following == {'answer': 'following'}
    assert calls == [first_client, 'following']
    assert not lock.locked()


@pytest.mark.asyncio
async def test_stream_reports_waiting_and_cancellation_does_not_release_owner(monkeypatch):
    lock = asyncio.Lock()
    monkeypatch.setattr(chat, 'chat_request_lock', lock)
    await lock.acquire()
    response = await chat.query_stream(chat.QueryRequest(question='waiting'))
    stream = response.body_iterator
    queued = await anext(stream)
    assert '"waiting": true' in queued
    waiting = asyncio.create_task(anext(stream))
    await asyncio.sleep(0)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert lock.locked()
    lock.release()


@pytest.mark.asyncio
async def test_stream_fallback_does_not_wait_on_its_own_lock(monkeypatch):
    monkeypatch.setattr(chat, '_query_response', AsyncMock(return_value={'answer': 'ok'}))
    token = chat.current_approval_context.set(chat.ApprovalContext(interactive=True))
    try:
        async with chat.chat_request_lock:
            assert await asyncio.wait_for(chat.query(chat.QueryRequest(question='fallback')), 1) == {'answer': 'ok'}
    finally:
        chat.current_approval_context.reset(token)


@pytest.mark.asyncio
async def test_translation_runs_when_model_is_available(monkeypatch):
    lock = asyncio.Lock()
    monkeypatch.setattr(chat, 'chat_request_lock', lock)
    llm = AsyncMock(return_value='translated')
    monkeypatch.setattr(chat, 'query_llm', llm)
    request = AsyncMock()
    request.headers = {}
    request.is_disconnected.return_value = False
    result = await asyncio.wait_for(
        chat.translate(chat.TranslateRequest(text='hello', target_lang='ko'), request), 1
    )
    assert result['translated'] == 'translated'
    llm.assert_awaited_once()
    assert not lock.locked()

@pytest.mark.asyncio
@pytest.mark.parametrize('headers', [{}, {'x-vyact-reject-if-busy': '1'}])
@pytest.mark.parametrize('save_history', [False, True])
async def test_extension_translation_rejects_busy_chat(monkeypatch, headers, save_history):
    lock = asyncio.Lock()
    monkeypatch.setattr(chat, 'chat_request_lock', lock)
    llm = AsyncMock()
    monkeypatch.setattr(chat, 'query_llm', llm)
    request = AsyncMock()
    request.headers = headers
    request.is_disconnected.return_value = False
    async with lock:
        with pytest.raises(chat.HTTPException) as error:
            await asyncio.wait_for(chat.translate(
                chat.TranslateRequest(text='hello', target_lang='ko', save_history=save_history), request
            ), 0.5)
        assert error.value.status_code == 409
        assert error.value.detail == {'code': 'ai_busy'}
        assert lock.locked()
        llm.assert_not_awaited()


@pytest.mark.asyncio
async def test_community_translation_uses_an_isolated_prompt(monkeypatch):
    monkeypatch.setattr(chat, 'chat_request_lock', asyncio.Lock())
    llm = AsyncMock(return_value=' 안녕 ')
    monkeypatch.setattr(chat, 'query_llm', llm)
    request = AsyncMock()
    request.is_disconnected.return_value = False

    result = await chat.translate_community_message(
        chat.CommunityTranslateRequest(text='Hello', target_lang='Korean'), request
    )

    assert result == {'translated': '안녕'}
    llm.assert_awaited_once()
    args, kwargs = llm.await_args
    assert args == ('Translate to Korean. Output only the translation.\n\nHello', [], '', [], [])
    assert kwargs['isolated_system_prompt']
    assert kwargs['raise_on_error']
    for option in ('use_tools', 'inject_user_profile', 'include_skills', 'include_response_language', 'reasoning'):
        assert kwargs[option] is False
