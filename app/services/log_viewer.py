"""Incremental, bounded reads of application-owned logs without writer locks."""
import asyncio
import codecs
import json
import os
import re
from pathlib import Path
from dataclasses import dataclass, field

from config import get_log_file

MAX_LOG_BYTES = 256 * 1024
LOG_CHECK_INTERVAL = 1.0
HEARTBEAT_INTERVAL = 15


def log_names(kind: str, model: str) -> list[str]:
    if kind == 'app':
        return ['app']
    if kind == 'decision':
        return ['decision']
    if kind == 'llm':
        return ['llm']
    if kind == 'model':
        if model.startswith('mlx/'):
            return ['omlx']
        if model.lower().endswith('.gguf'):
            return ['llama-swap']
    return []


def available_log_files(kind: str, model: str) -> list[dict]:
    files = []
    for name in log_names(kind, model):
        directory = get_log_file(name).parent
        pattern = re.compile(rf"{re.escape(name)}_(20\d{{6}})\.log")
        for path in directory.glob(f"{name}_*.log"):
            if pattern.fullmatch(path.name) and path.is_file() and not path.is_symlink():
                files.append({'name': name, 'filename': path.name, 'path': str(path)})
    return sorted(files, key=lambda file: file['filename'], reverse=True)


@dataclass
class LogCursor:
    name: str
    path: Path | None = None
    identity: tuple | None = None
    offset: int = 0
    modified: int = 0
    decoder: object = field(default_factory=lambda: codecs.getincrementaldecoder('utf-8')(errors='replace'))

    def read(self) -> dict | None:
        path = self.path or get_log_file(self.name)
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


async def stream_logs(kind: str, model: str, filename: str = ''):
    cursors = []
    previous_selection = None
    previous_available = None
    heartbeat = 0
    # StreamingResponse cancels this generator when the client disconnects.
    while True:
        available = await asyncio.to_thread(available_log_files, kind, model)
        selected = next((file for file in available if file['filename'] == filename), None) if filename else (available[0] if available else None)
        selection = selected['path'] if selected else ''
        changed = selection != previous_selection or available != previous_available
        if selection != previous_selection:
            cursors = [LogCursor(selected['name'], path=Path(selection))] if selected else []
        updates = await asyncio.to_thread(read_updates, cursors)
        if updates or changed:
            payload = {"files": updates, "available": available, "selected": selection,
                       "replace": selection != previous_selection}
            yield f'data: {json.dumps(payload, ensure_ascii=False)}\n\n'
            previous_selection = selection
            previous_available = available
            heartbeat = 0
        else:
            heartbeat += 1
            if heartbeat >= HEARTBEAT_INTERVAL:
                yield ': heartbeat\n\n'
                heartbeat = 0
        await asyncio.sleep(LOG_CHECK_INTERVAL)
