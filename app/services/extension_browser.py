"""Command bridge between LLM browser tools and the Vyact Chrome extension."""
import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any


EXTENSION_TIMEOUT_SECONDS = 35.0
EXTENSION_HEARTBEAT_SECONDS = 7.0
CHROME_STORE_URL = "https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib"
EXTENSION_REQUIRED_MARKER = "VYACT_BROWSER_EXTENSION_REQUIRED"


@dataclass
class ExtensionBrowserBridge:
    token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    last_seen: float = 0.0
    commands: asyncio.Queue = field(default_factory=asyncio.Queue)
    pending: dict[str, asyncio.Future] = field(default_factory=dict)
    websocket: Any | None = None

    def register(self) -> str:
        self.last_seen = time.monotonic()
        return self.token

    def connected(self) -> bool:
        return self.websocket is not None and time.monotonic() - self.last_seen < EXTENSION_HEARTBEAT_SECONDS

    def attach(self, websocket: Any) -> None:
        self.websocket = websocket
        self.last_seen = time.monotonic()

    def detach(self, websocket: Any) -> None:
        if self.websocket is websocket:
            self.websocket = None
            error = RuntimeError(
                f"{EXTENSION_REQUIRED_MARKER}: Chrome extension connection was lost. "
                f"[Install Vyact Chrome extension]({CHROME_STORE_URL})"
            )
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(error)

    async def next_command(self, timeout: float = 20.0):
        self.last_seen = time.monotonic()
        try:
            return await asyncio.wait_for(self.commands.get(), timeout=min(max(timeout, 1), 25))
        except asyncio.TimeoutError:
            return None

    async def execute(self, command: str, **args):
        if not self.connected():
            raise RuntimeError(
                f"{EXTENSION_REQUIRED_MARKER}: Vyact Chrome extension is not connected. Install or enable it here: "
                f"[Install Vyact Chrome extension]({CHROME_STORE_URL})"
            )
        command_id = secrets.token_urlsafe(12)
        future = asyncio.get_running_loop().create_future()
        self.pending[command_id] = future
        item = {"type": "command", "id": command_id, "command": command, "args": args}
        if self.websocket is not None:
            try:
                await self.websocket.send_json(item)
            except Exception:
                self.websocket = None
                self.pending.pop(command_id, None)
                raise RuntimeError(
                    f"{EXTENSION_REQUIRED_MARKER}: Chrome extension connection was lost. "
                    f"[Install Vyact Chrome extension]({CHROME_STORE_URL})"
                )
        else:
            await self.commands.put(item)
        try:
            result = await asyncio.wait_for(future, timeout=EXTENSION_TIMEOUT_SECONDS)
        finally:
            self.pending.pop(command_id, None)
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or "Chrome extension browser command failed")
        return result.get("result")

    def complete(self, command_id: str, result: dict) -> bool:
        self.last_seen = time.monotonic()
        future = self.pending.get(command_id)
        if not future or future.done():
            return False
        future.set_result(result)
        return True


extension_browser = ExtensionBrowserBridge()
