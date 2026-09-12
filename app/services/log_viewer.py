"""Incremental, bounded reads of application-owned logs without writer locks."""
import asyncio
import codecs
import json
import os
from dataclasses import dataclass, field

from config import get_log_file

MAX_LOG_BYTES = 256 * 1024
LOG_CHECK_INTERVAL = 1.0
HEARTBEAT_INTERVAL = 15


def log_names(kind: str, model: str) -> list[str]:
    if kind == 'app':
        return ['app']
    names = ['llm']
    if model.startswith('mlx/'):
        names.append('omlx')
    elif model.lower().endswith('.gguf'):
        names.append('llama-swap')
    return names


@dataclass
class LogCursor:
    name: str
    identity: tuple | None = None
    offset: int = 0
    modified: int = 0
    decoder: object = field(default_factory=lambda: codecs.getincrementaldecoder('utf-8')(errors='replace'))

    def read(self) -> dict | None:
        path = get_log_file(self.name)
        try:
            with path.open('rb') as stream:
                stat = os.fstat(stream.fileno())
                identity = (str(path), stat.st_dev, stat.st_ino)
                reset = (identity != self.identity or stat.st_size < self.offset
                         or (stat.st_size == self.offset and stat.st_mtime_ns != self.modified))
                if reset:
                    self.offset = max(0, stat.st_size - MAX_LOG_BYTES)
                    self.decoder.reset()
                if not reset and stat.st_size == self.offset:
                    return None
                stream.seek(self.offset)
                data = stream.read(MAX_LOG_BYTES)
                self.offset += len(data)
                self.identity = identity
                self.modified = stat.st_mtime_ns
                content = self.decoder.decode(data)
                return {'name': self.name, 'path': str(path), 'reset': reset, 'content': content}
        except FileNotFoundError:
            identity = (str(path), None, None)
            if self.identity == identity:
                return None
            self.identity = identity
            self.offset = 0
            self.modified = 0
            self.decoder.reset()
            return {'name': self.name, 'path': str(path), 'reset': True, 'content': ''}


def read_updates(cursors: list[LogCursor]) -> list[dict]:
    return [update for cursor in cursors if (update := cursor.read()) is not None]


async def stream_logs(kind: str, model: str):
    cursors = [LogCursor(name) for name in log_names(kind, model)]
    heartbeat = 0
    # StreamingResponse cancels this generator when the client disconnects.
    while True:
        updates = await asyncio.to_thread(read_updates, cursors)
        if updates:
            yield f'data: {json.dumps({"files": updates}, ensure_ascii=False)}\n\n'
            heartbeat = 0
        else:
            heartbeat += 1
            if heartbeat >= HEARTBEAT_INTERVAL:
                yield ': heartbeat\n\n'
                heartbeat = 0
        await asyncio.sleep(LOG_CHECK_INTERVAL)
