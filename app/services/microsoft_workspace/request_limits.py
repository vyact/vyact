"""Persistent local budgets and shared Microsoft cooldowns; no credentials or URLs stored."""
import asyncio
import hashlib
import math
import sqlite3
import time
import uuid
from contextvars import ContextVar
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path

from fastapi import HTTPException

from config import INSTALL_DIR
from logger import get_logger

logger = get_logger(__name__)
CONCURRENT_REQUESTS = 3
HISTORY_SECONDS = 600
BACKOFF_BASE_SECONDS = 10
BACKOFF_MAX_SECONDS = 300
BACKOFF_RESET_SECONDS = 3600
_upload_reservation = ContextVar("microsoft_upload_reservation", default=None)


@dataclass(frozen=True)
class RequestBudget:
    window_seconds: int
    requests: int
    upload_bytes: int = 0
    upload_window_seconds: int = 300


# Local safety margins, not promises about Microsoft's dynamic service limits.
BUDGETS = {
    'outlook': RequestBudget(600, 9_000, 140 * 1024 * 1024),
    'drive': RequestBudget(300, 2_400),
    'oauth': RequestBudget(60, 30),
    'profile': RequestBudget(60, 60),
}


def request_scope(client_id: str, principal: str, service: str) -> str:
    identity = f'{client_id.lower()}\0{principal.casefold()}'
    return f'{service}:{hashlib.sha256(identity.encode()).hexdigest()}'


def throttled_error(seconds: int) -> HTTPException:
    return HTTPException(429, 'microsoft_rate_limited', headers={'Retry-After': str(max(1, seconds))})


def is_throttled(error: Exception) -> bool:
    return isinstance(error, HTTPException) and error.status_code == 429


class MicrosoftRequestLimiter:
    def __init__(self, path: Path, clock=time.time):
        self.path = path
        self.clock = clock
        self._initialized = False
        self._slots: dict[str, asyncio.Semaphore] = {}

    @contextmanager
    def _database(self):
        connection = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(self.path, timeout=5)
            if not self._initialized:
                connection.execute('PRAGMA journal_mode=WAL')
                connection.executescript('''
                    CREATE TABLE IF NOT EXISTS requests (
                        scope TEXT NOT NULL, at INTEGER NOT NULL,
                        units INTEGER NOT NULL, upload_bytes INTEGER NOT NULL,
                        PRIMARY KEY(scope, at)
                    );
                    CREATE TABLE IF NOT EXISTS upload_reservations (
                        id TEXT PRIMARY KEY, scope TEXT NOT NULL, at REAL NOT NULL, remaining INTEGER NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS cooldowns (
                        scope TEXT PRIMARY KEY, until REAL NOT NULL,
                        failures INTEGER NOT NULL, last_throttled REAL NOT NULL
                    );
                ''')
                self._initialized = True
            with connection:
                yield connection
        except (OSError, sqlite3.Error):
            logger.exception('Microsoft request limit storage unavailable')
            raise HTTPException(503, 'service_unavailable') from None
        finally:
            if connection:
                connection.close()

    def remaining(self, scope: str) -> int:
        with self._database() as db:
            row = db.execute('SELECT until FROM cooldowns WHERE scope=?', (scope,)).fetchone()
        return max(0, math.ceil(row[0] - self.clock())) if row else 0

    def check(self, scope: str) -> None:
        seconds = self.remaining(scope)
        if seconds:
            raise throttled_error(seconds)

    def block(self, scope: str, retry_after: str | None = None) -> HTTPException:
        now = self.clock()
        with self._database() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT until, failures, last_throttled FROM cooldowns WHERE scope=?', (scope,)).fetchone()
            failures = previous[1] if previous and now - previous[2] < BACKOFF_RESET_SECONDS else 0
            delay = self.retry_delay(retry_after, now)
            if delay is None:
                delay = min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** min(failures, 5))
            until = max(now + delay, previous[0] if previous else 0)
            db.execute('INSERT OR REPLACE INTO cooldowns VALUES (?, ?, ?, ?)', (scope, until, failures + 1, now))
        return throttled_error(math.ceil(until - now))

    @staticmethod
    def retry_delay(value: str | None, now: float) -> float | None:
        if not value:
            return None
        try:
            delay = float(value)
            if math.isfinite(delay) and delay >= 0:
                return max(1, delay)
        except (TypeError, ValueError):
            pass
        try:
            return max(1, parsedate_to_datetime(value).timestamp() - now)
        except (TypeError, ValueError, OverflowError):
            return None

    def reserve(self, scope: str, units: int = 1, upload_bytes: int = 0, *, hold: str | None = None) -> None:
        budget = BUDGETS[scope.split(':', 1)[0]]
        now = self.clock()
        wait_until = 0
        with self._database() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM requests WHERE at <= ?', (now - HISTORY_SECONDS,))
            db.execute('DELETE FROM cooldowns WHERE until <= ? AND last_throttled <= ?', (now, now - BACKOFF_RESET_SECONDS))
            row = db.execute('SELECT until FROM cooldowns WHERE scope=?', (scope,)).fetchone()
            if row and row[0] > now:
                raise throttled_error(math.ceil(row[0] - now))
            db.execute('DELETE FROM upload_reservations WHERE at <= ?', (now - budget.upload_window_seconds,))
            reservation_id = _upload_reservation.get() if hold is None else None
            reservation = db.execute('SELECT remaining FROM upload_reservations WHERE id=? AND scope=?', (reservation_id, scope)).fetchone()
            credit = min(upload_bytes, reservation[0]) if reservation else 0
            rows = db.execute('SELECT at, units, upload_bytes FROM requests WHERE scope=? ORDER BY at', (scope,)).fetchall()
            rows += [(at, 0, remaining) for at, remaining in db.execute('SELECT at, remaining FROM upload_reservations WHERE scope=?', (scope,))]
            rows.sort(key=lambda entry: entry[0])
            for index, amount, limit, window in (
                (1, units, budget.requests, budget.window_seconds),
                (2, upload_bytes - credit, budget.upload_bytes, budget.upload_window_seconds),
            ):
                if not limit or not amount:
                    continue
                if amount > limit:
                    raise HTTPException(413, 'payload_too_large')
                recent = [entry for entry in rows if entry[0] > now - window]
                excess = sum(entry[index] for entry in recent) + amount - limit
                for entry in recent:
                    if excess <= 0:
                        break
                    excess -= entry[index]
                    wait_until = max(wait_until, entry[0] + window)
            if wait_until > now:
                pass  # A rejected local admission must not block already admitted uploads.
            elif hold is not None:
                db.execute('INSERT INTO upload_reservations VALUES (?, ?, ?, ?)', (hold, scope, now, upload_bytes))
            else:
                if reservation:
                    db.execute('UPDATE upload_reservations SET remaining=remaining-?, at=? WHERE id=?', (credit, now, reservation_id))
                db.execute('INSERT INTO requests VALUES (?, ?, ?, ?) ON CONFLICT(scope, at) DO UPDATE SET units=units+excluded.units, upload_bytes=upload_bytes+excluded.upload_bytes',
                           (scope, math.ceil(now), units, upload_bytes))
        if wait_until > now:
            raise throttled_error(math.ceil(wait_until - now))

    @asynccontextmanager
    async def upload(self, scope: str, upload_bytes: int):
        """Admit the whole operation before remote writes; unused capacity is released."""
        reservation_id = uuid.uuid4().hex
        self.reserve(scope, units=0, upload_bytes=upload_bytes, hold=reservation_id)
        token = _upload_reservation.set(reservation_id)
        try:
            yield
        finally:
            _upload_reservation.reset(token)
            with self._database() as db:
                db.execute('DELETE FROM upload_reservations WHERE id=?', (reservation_id,))

    @asynccontextmanager
    async def request(self, scope: str, units: int = 1, upload_bytes: int = 0):
        self.check(scope)
        async with self._slots.setdefault(scope, asyncio.Semaphore(CONCURRENT_REQUESTS)):
            # A 429 received while queued must stop this request before it leaves the app.
            self.reserve(scope, units, upload_bytes)
            yield


request_limiter = MicrosoftRequestLimiter(INSTALL_DIR / 'microsoft-request-limits.sqlite3')
