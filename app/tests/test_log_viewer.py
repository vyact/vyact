import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services import log_viewer


class LogViewerTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'app.log'
        patcher = patch.object(log_viewer, 'get_log_file', return_value=self.path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_only_new_bytes_are_sent_and_unchanged_files_emit_nothing(self):
        self.path.write_text('first\n')
        cursor = log_viewer.LogCursor('app')
        self.assertTrue(cursor.read()['reset'])
        self.assertIsNone(cursor.read())
        with self.path.open('a') as stream:
            stream.write('second\n')
        update = cursor.read()
        self.assertFalse(update['reset'])
        self.assertEqual(update['content'], 'second\n')
        self.assertIsNone(cursor.read())

    def test_missing_created_truncated_and_replaced_file_reset(self):
        cursor = log_viewer.LogCursor('app')
        self.assertEqual(cursor.read()['content'], '')
        self.assertIsNone(cursor.read())
        self.path.write_text('original content\n')
        self.assertTrue(cursor.read()['reset'])
        self.path.write_text('short\n')
        self.assertEqual(cursor.read()['content'], 'short\n')
        replacement = self.path.with_suffix('.new')
        replacement.write_text('replacement\n')
        replacement.replace(self.path)
        self.assertTrue(cursor.read()['reset'])

    def test_daily_rotation_is_resolved_without_reconnecting(self):
        self.path.write_text('old day\n')
        cursor = log_viewer.LogCursor('app')
        cursor.read()
        next_day = self.path.with_name('next.log')
        next_day.write_text('new day\n')
        with patch.object(log_viewer, 'get_log_file', return_value=next_day):
            update = cursor.read()
        self.assertTrue(update['reset'])
        self.assertEqual(update['content'], 'new day\n')

    def test_partial_utf8_write_is_decoded_after_remaining_bytes_arrive(self):
        encoded = '한글'.encode()
        self.path.write_bytes(encoded[:2])
        cursor = log_viewer.LogCursor('llm')
        self.assertEqual(cursor.read()['content'], '')
        with self.path.open('ab') as stream:
            stream.write(encoded[2:])
        self.assertEqual(cursor.read()['content'], '한글')

    def test_initial_and_incremental_reads_are_bounded(self):
        self.path.write_bytes(b'x' * (log_viewer.MAX_LOG_BYTES * 2))
        cursor = log_viewer.LogCursor('app')
        self.assertEqual(len(cursor.read()['content']), log_viewer.MAX_LOG_BYTES)
        self.assertIsNone(cursor.read())
        with self.path.open('ab') as stream:
            stream.write(b'y' * (log_viewer.MAX_LOG_BYTES + 5))
        self.assertEqual(len(cursor.read()['content']), log_viewer.MAX_LOG_BYTES)
        self.assertEqual(cursor.read()['content'], 'yyyyy')

    def test_model_routing_never_uses_client_paths(self):
        self.assertEqual(log_viewer.log_names('llm', 'mlx/org/model'), ['llm', 'omlx'])
        self.assertEqual(log_viewer.log_names('llm', 'org/model.gguf'), ['llm', 'llama-swap'])
        self.assertEqual(log_viewer.log_names('llm', '../../secret'), ['llm'])

    def test_stream_can_be_closed_after_initial_event(self):
        async def check():
            self.path.write_text('test\n')
            stream = log_viewer.stream_logs('app', '')
            frame = await anext(stream)
            self.assertEqual(json.loads(frame.removeprefix('data: '))['files'][0]['content'], 'test\n')
            await stream.aclose()
        asyncio.run(check())
