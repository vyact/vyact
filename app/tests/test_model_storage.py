import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from services import model_storage as storage
from services.model_benchmark import BenchmarkGuard
from routers import model_storage as routes


class ModelStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = self.root / 'app' / 'model-storage.json'
        self.source = self.root / 'app' / 'models'
        self.destination = self.root / 'disk' / 'models'
        self.destination.mkdir(parents=True)
        for name, value in [('INSTALL_DIR', self.root / 'app'), ('STORAGE_CONFIG', self.config)]:
            patcher = patch.object(storage, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def model(self, name='owner/model/model.gguf', content=b'weights'):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def test_first_setup_persists_only_model_location(self):
        plan = storage.plan_move(str(self.destination))
        self.assertEqual(plan['total_bytes'], 0)
        storage.save_models_dir(self.destination)
        self.assertEqual(storage.get_models_dir(), self.destination)
        self.assertEqual(storage.get_mlx_models_dir(), self.destination / 'mlx')
        self.assertEqual(storage.INSTALL_DIR, self.root / 'app')
        self.assertEqual(json.loads(self.config.read_text())['path'], str(self.destination))

    def test_same_directory_alias_is_noop(self):
        self.source.mkdir(parents=True)
        alias = self.root / 'alias'
        alias.symlink_to(self.source, target_is_directory=True)
        for path in (str(self.source) + '/', str(alias), str(self.source / '..' / 'models')):
            self.assertTrue(storage.plan_move(path)['same'])
        self.assertFalse(self.config.exists())

    def test_rejects_nested_nonempty_and_insufficient_space(self):
        self.model()
        child = self.source / 'child'
        child.mkdir()
        for path in (child,):
            with self.assertRaisesRegex(ValueError, 'nested_storage_path'):
                storage.plan_move(str(path))
        (self.destination / 'keep').touch()
        with self.assertRaisesRegex(ValueError, 'storage_not_empty'):
            storage.plan_move(str(self.destination))
        (self.destination / 'keep').unlink()
        with patch.object(storage.shutil, 'disk_usage') as usage:
            usage.return_value.free = 0
            with self.assertRaisesRegex(ValueError, 'storage_space'):
                storage.plan_move(str(self.destination))

    def test_copy_verify_commit_preserves_app_data_and_embeddings(self):
        original = self.model()
        self.model('mlx/owner/model/model.safetensors', b'mlx weights')
        self.model('mlx/owner/model/.vyact-mlx-model.json', b'{}')
        embedding = self.model('embeddings/search.gguf', b'keep embedding')
        log = self.root / 'app' / 'log.txt'
        log.write_text('keep log')
        plan = storage.plan_move(str(self.destination))
        progress = []
        created = storage.copy_models(plan, lambda **value: progress.append(value))
        self.assertTrue(original.exists())
        self.assertEqual((self.destination / 'owner/model/model.gguf').read_bytes(), original.read_bytes())
        storage.save_models_dir(self.destination)
        self.assertTrue(storage.clean_source(plan, created))
        self.assertFalse(original.exists())
        self.assertTrue(embedding.exists())
        self.assertTrue(log.exists())
        self.assertFalse((self.destination / 'embeddings').exists())
        self.assertEqual(max(p.get('copied_bytes', 0) for p in progress), plan['total_bytes'])

    def test_copy_failure_keeps_original_and_rolls_back_own_files(self):
        original = self.model()
        plan = storage.plan_move(str(self.destination))
        with patch.object(storage.os, 'fsync', side_effect=OSError('unplugged')):
            with self.assertRaises(OSError):
                storage.copy_models(plan, lambda **_: None)
        self.assertEqual(original.read_bytes(), b'weights')
        self.assertEqual(list(self.destination.iterdir()), [])
        self.assertFalse(self.config.exists())

    def test_verification_failure_does_not_switch_location(self):
        self.model()
        plan = storage.plan_move(str(self.destination))
        with patch.object(storage.hashlib, 'file_digest') as digest:
            digest.return_value.digest.return_value = b'corrupt'
            with self.assertRaisesRegex(ValueError, 'storage_verification'):
                storage.copy_models(plan, lambda **_: None)
        self.assertEqual(storage.get_models_dir(), self.source)
        self.assertFalse(self.config.exists())

    def test_missing_external_storage_never_falls_back(self):
        storage.save_models_dir(self.destination)
        self.destination.rmdir()
        with self.assertRaisesRegex(ValueError, 'storage_unavailable'):
            storage.get_models_dir()
        self.assertEqual(storage.get_configured_models_dir(), self.destination)
        self.assertFalse(self.destination.exists())

    def test_cleanup_preserves_original_changed_after_copy(self):
        original = self.model()
        plan = storage.plan_move(str(self.destination))
        created = storage.copy_models(plan, lambda **_: None)
        original.write_bytes(b'new user content')
        storage.save_models_dir(self.destination)
        self.assertFalse(storage.clean_source(plan, created))
        self.assertEqual(original.read_bytes(), b'new user content')


    def test_parent_selection_uses_dedicated_root_without_adopting_siblings(self):
        original = self.model()
        parent = self.root / 'other-disk'
        parent.mkdir()
        personal = parent / 'personal.txt'
        personal.write_bytes(b'private notes')
        (parent / 'photos').mkdir()
        plan = storage.plan_move(str(parent))
        self.assertEqual(Path(plan['destination']), parent.resolve() / 'models')
        self.assertEqual(Path(plan['selected_directory']), parent.resolve())
        self.assertFalse((parent / 'models').exists())
        created = storage.copy_models(plan, lambda **_: None)
        storage.save_models_dir(Path(plan['destination']))
        self.assertTrue(storage.clean_source(plan, created))
        self.assertFalse(original.exists())
        self.assertEqual(personal.read_bytes(), b'private notes')
        # A second relocation only enumerates the dedicated root, never its siblings.
        next_plan = storage.plan_move(str(self.destination))
        next_created = storage.copy_models(next_plan, lambda **_: None)
        storage.save_models_dir(Path(next_plan['destination']))
        self.assertTrue(storage.clean_source(next_plan, next_created))
        self.assertFalse((self.destination / 'personal.txt').exists())
        self.assertFalse((self.destination / 'photos').exists())
        self.assertEqual(personal.read_bytes(), b'private notes')

    def test_round_trip_to_default_with_embeddings_and_no_nested_models(self):
        self.model()
        embedding = self.model('embeddings/search.gguf', b'embedding')
        outbound = storage.plan_move(str(self.destination.parent))
        copied = storage.copy_models(outbound, lambda **_: None)
        storage.save_models_dir(Path(outbound['destination']))
        self.assertTrue(storage.clean_source(outbound, copied))
        for selected in [self.source, self.source.parent]:
            inbound = storage.plan_move(str(selected))
            self.assertEqual(Path(inbound['destination']), self.source.resolve())
        copied = storage.copy_models(inbound, lambda **_: None)
        storage.save_models_dir(Path(inbound['destination']))
        self.assertTrue(storage.clean_source(inbound, copied))
        self.assertEqual(embedding.read_bytes(), b'embedding')
        self.assertEqual((self.source / 'owner/model/model.gguf').read_bytes(), b'weights')
        self.assertFalse((self.source / 'models').exists())
        self.assertTrue(storage.plan_move(str(self.source.parent))['same'])
        self.assertTrue(storage.plan_move(str(self.source))['same'])

    def test_populated_dedicated_root_is_not_adopted(self):
        self.model()
        personal = self.destination / 'personal.txt'
        personal.write_bytes(b'keep')
        for selected in [self.destination, self.destination.parent]:
            with self.assertRaisesRegex(ValueError, 'storage_not_empty'):
                storage.plan_move(str(selected))
        self.assertEqual(personal.read_bytes(), b'keep')

    def test_new_dedicated_root_rolls_back_on_copy_failure(self):
        original = self.model()
        self.destination.rmdir()
        plan = storage.plan_move(str(self.destination.parent))
        with patch.object(storage.os, 'fsync', side_effect=OSError('unplugged')):
            with self.assertRaises(OSError):
                storage.copy_models(plan, lambda **_: None)
        self.assertFalse(self.destination.exists())
        self.assertTrue(original.exists())

    def test_symlinked_child_models_is_not_followed(self):
        self.model()
        self.destination.rmdir()
        self.destination.symlink_to(self.source, target_is_directory=True)
        # Selecting the child alias itself is a same-directory noop.
        self.assertTrue(storage.plan_move(str(self.destination))['same'])
        # A parent containing a redirected models child is not a new managed root.
        with self.assertRaisesRegex(ValueError, 'storage_not_empty'):
            storage.plan_move(str(self.destination.parent))



class StorageJobTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        storage.active_move = False
        storage.move_status = {'phase': 'idle'}
        self.addCleanup(setattr, storage, 'active_move', False)

    async def test_inflight_request_blocks_move(self):
        with patch.object(routes.model_benchmark, 'active_requests', 1):
            with self.assertRaises(HTTPException) as caught:
                await routes.storage_move(routes.StorageRequest(path='/unused'))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertFalse(storage.active_move)

    async def test_detached_download_worker_blocks_move(self):
        with storage.download_operation():
            with self.assertRaises(HTTPException) as caught:
                await routes.storage_move(routes.StorageRequest(path='/unused'))
            self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(storage.active_downloads, 0)

    async def test_noop_never_stops_runtime(self):
        with patch.object(routes, '_plan', return_value={'same': True}), patch.object(routes, '_move') as move:
            self.assertEqual(await routes.storage_move(routes.StorageRequest(path='/same')), {'same': True})
            move.assert_not_called()
            self.assertFalse(storage.active_move)

    async def test_guard_blocks_external_inference_while_moving(self):
        storage.active_move = True
        messages = []
        app = AsyncMock()
        async def send(message):
            messages.append(message)
        await BenchmarkGuard(app)({'type': 'http', 'method': 'POST', 'path': '/v1/chat/completions'}, AsyncMock(), send)
        app.assert_not_awaited()
        self.assertEqual(messages[0]['status'], 409)

    async def test_job_commits_before_cleanup_and_reloads(self):
        events = []
        config = {'type': 'vyact', 'vyact_config': {'model_path': 'owner/model.gguf'}}
        plan = {'destination': '/new', 'total_bytes': 7}
        def event(name, result=None):
            def invoke(*args, **kwargs):
                events.append(name)
                return result
            return invoke
        with patch.object(routes, 'SETUP_DONE') as done, \
             patch.object(routes, 'load_config_async', AsyncMock(return_value=config)), \
             patch.object(routes, '_runtime_available', return_value=True), \
             patch.object(routes, 'stop_all_vyact_runtimes', side_effect=event('stop')), \
             patch.object(storage, 'copy_models', side_effect=event('copy', [])), \
             patch.object(storage, 'save_models_dir', side_effect=event('commit')), \
             patch.object(routes, 'initialize_downloaded_models_cache', side_effect=event('cache')), \
             patch.object(storage, 'clean_source', side_effect=event('clean', True)), \
             patch.object(routes, '_restore', AsyncMock(side_effect=event('reload'))):
            done.exists.return_value = True
            await routes._move(plan)
        self.assertEqual(events, ['stop', 'copy', 'commit', 'cache', 'clean', 'reload'])
        self.assertEqual(storage.move_status['phase'], 'complete')
        self.assertFalse(storage.active_move)


class StorageApiIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_actual_gguf_and_mlx_move_through_api_without_es(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, destination = root / "app/models", root / "disk/models"
            destination.parent.mkdir(parents=True)
            for relative, data in [("owner/model.gguf", b"gguf" * 1024),
                                   ("mlx/owner/model/weights.safetensors", b"mlx weights"),
                                   ("mlx/owner/model/.vyact-mlx-model.json", b"{}")]:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            app = FastAPI()
            app.add_middleware(BenchmarkGuard)
            app.include_router(routes.router, prefix="/api")
            with patch.object(storage, 'INSTALL_DIR', root / 'app'), \
                 patch.object(storage, 'STORAGE_CONFIG', root / 'app/model-storage.json'), \
                 patch.object(routes, 'SETUP_DONE', root / 'no-setup'), \
                 patch.object(routes, 'load_config_async', AsyncMock()) as load_config, \
                 patch.object(routes, 'stop_all_vyact_runtimes') as stop, \
                 patch('services.vyact_runtime._downloaded_models_cache', None):
                storage.active_move = False
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                    plan = await client.post('/api/vyact/model-storage/plan', json={'path': str(destination.parent)})
                    self.assertEqual(plan.status_code, 200)
                    self.assertEqual(plan.json()['file_count'], 3)
                    self.assertEqual(plan.json()['destination'], str(destination.resolve()))
                    self.assertFalse(destination.exists())
                    response = await client.post('/api/vyact/model-storage/move', json={'path': str(destination.parent)})
                    self.assertEqual(response.status_code, 200)
                    await routes._move_task
                    status = (await client.get('/api/vyact/model-storage')).json()
                    self.assertEqual(status['phase'], 'complete')
                    self.assertEqual(status['path'], str(destination.resolve()))
                    self.assertFalse(status['busy'])
                    self.assertEqual((destination / 'owner/model.gguf').read_bytes(), b'gguf' * 1024)
                    self.assertTrue((destination / 'mlx/owner/model/.vyact-mlx-model.json').exists())
                    self.assertFalse((source / 'owner/model.gguf').exists())
                    # The same directory does not create another job or unload a model.
                    stop.reset_mock()
                    response = await client.post('/api/vyact/model-storage/move', json={'path': str(destination)})
                    self.assertTrue(response.json()['same'])
                    stop.assert_not_called()
                load_config.assert_not_awaited()
