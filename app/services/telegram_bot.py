"""Telegram long-polling bridge for Vyact conversations."""
import asyncio
import json
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from logger import get_logger
from routers.deps import load_config_async
from services.db import SETTINGS_INDEX, get_es

logger = get_logger(__name__)

_SETTINGS_ID = "telegram_bot"
_polling_task: asyncio.Task | None = None
_stop_event = asyncio.Event()


def _telegram_request(token: str, method: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        f"https://api.telegram.org/bot{token}/{method}", data=data,
        headers={"Content-Type": "application/json"} if data else {}, method="POST" if data else "GET",
    )
    with urlopen(request, timeout=35) as response:  # nosec B310 - fixed Telegram API host
        result = json.loads(response.read().decode("utf-8"))
    if not result.get("ok"):
        raise ValueError(result.get("description", "Telegram API request failed"))
    return result


async def get_settings() -> dict[str, Any]:
    es = get_es()
    try:
        result = await es.get(index=SETTINGS_INDEX, id=_SETTINGS_ID, ignore=[404])
        value = result.get("_source", {}).get("value", {}) if result.get("found") else {}
        return value if isinstance(value, dict) else {}
    finally:
        await es.close()


async def save_settings(token: str, enabled: bool) -> None:
    es = get_es()
    try:
        current = await get_settings()
        await es.index(index=SETTINGS_INDEX, id=_SETTINGS_ID, document={
            "key": _SETTINGS_ID,
            "value": {**current, "token": token, "enabled": enabled},
        }, refresh=True)
    finally:
        await es.close()


def public_status(settings: dict[str, Any]) -> dict[str, Any]:
    return {"configured": bool(settings.get("token")), "enabled": bool(settings.get("enabled")), "running": _polling_task is not None and not _polling_task.done()}


async def validate_token(token: str) -> dict[str, str]:
    result = await asyncio.to_thread(_telegram_request, token, "getMe")
    user = result.get("result", {})
    return {"username": str(user.get("username", "")), "name": str(user.get("first_name", ""))}


async def _answer_message(token: str, message: dict[str, Any]) -> None:
    text = str(message.get("text", "")).strip()
    chat_id = message.get("chat", {}).get("id")
    if not text or not chat_id:
        return
    if text.startswith("/start"):
        await asyncio.to_thread(_telegram_request, token, "sendMessage", {"chat_id": chat_id, "text": "Vyact에 연결되었습니다. 질문을 보내주세요."})
        return
    from routers.chat import QueryRequest, query
    conversation_id = f"telegram:{chat_id}"
    try:
        result = await query(QueryRequest(question=text, conv_id=conversation_id, minimal_prompt=True))
        answer = str(result.get("answer", "")).strip() or "답변을 생성하지 못했습니다."
    except Exception:
        logger.exception("[telegram] Vyact query failed")
        answer = "Vyact에서 답변을 생성하지 못했습니다. 앱의 모델 연결 상태를 확인해주세요."
    # Telegram message limit is 4096 characters.
    for start in range(0, len(answer), 4000):
        await asyncio.to_thread(_telegram_request, token, "sendMessage", {
            "chat_id": chat_id, "text": answer[start:start + 4000],
            "reply_parameters": {"message_id": message.get("message_id")},
        })


async def _poll() -> None:
    offset: int | None = None
    while not _stop_event.is_set():
        try:
            settings = await get_settings()
            token = str(settings.get("token", "")).strip()
            if not token or not settings.get("enabled"):
                await asyncio.sleep(2)
                continue
            payload: dict[str, Any] = {"timeout": 25, "allowed_updates": ["message"]}
            if offset is not None:
                payload["offset"] = offset
            result = await asyncio.to_thread(_telegram_request, token, "getUpdates", payload)
            for update in result.get("result", []):
                offset = int(update["update_id"]) + 1
                if "message" in update:
                    await _answer_message(token, update["message"])
        except (URLError, TimeoutError, ValueError) as error:
            logger.warning("[telegram] polling failed: %s", error)
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[telegram] unexpected polling failure")
            await asyncio.sleep(5)


async def start() -> None:
    global _polling_task
    if _polling_task is None or _polling_task.done():
        _stop_event.clear()
        _polling_task = asyncio.create_task(_poll(), name="telegram-bot-polling")


async def stop() -> None:
    global _polling_task
    _stop_event.set()
    if _polling_task:
        _polling_task.cancel()
        try:
            await _polling_task
        except asyncio.CancelledError:
            pass
    _polling_task = None
