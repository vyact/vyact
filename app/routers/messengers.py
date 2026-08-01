"""Messenger-channel configuration APIs."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import telegram_bot

router = APIRouter()


class TelegramSettingsRequest(BaseModel):
    token: str
    enabled: bool = True


@router.get("/messengers/telegram")
async def get_telegram_settings():
    return telegram_bot.public_status(await telegram_bot.get_settings())


@router.put("/messengers/telegram")
async def update_telegram_settings(req: TelegramSettingsRequest):
    token = req.token.strip()
    if not token:
        raise HTTPException(400, "Telegram bot token is required.")
    try:
        bot = await telegram_bot.validate_token(token)
    except Exception as error:
        raise HTTPException(400, f"Telegram token validation failed: {error}") from error
    await telegram_bot.save_settings(token, req.enabled)
    await telegram_bot.start()
    return {**telegram_bot.public_status(await telegram_bot.get_settings()), "bot": bot}
