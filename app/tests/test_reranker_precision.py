import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import torch
import reranker


class RerankerPrecisionTests(unittest.TestCase):
    def tearDown(self):
        reranker._reranker = None

    def test_load_precision_and_fallback(self):
        for mps, failures, expected in [
            (True, False, [torch.float16]),
            (False, False, [torch.float32]),
            (True, True, [torch.float16, torch.float32]),
        ]:
            with self.subTest(mps=mps, failures=failures):
                results = [RuntimeError('FP16 unsupported'), Mock()] if failures else [Mock()]
                with patch.object(torch.backends.mps, 'is_available', return_value=mps), patch.object(reranker, '_create_reranker', side_effect=results) as create, patch.object(reranker, '_release_reranker'):
                    self.assertTrue(reranker.load_reranker())
                    self.assertEqual([call.args[1] for call in create.call_args_list], expected)

    def test_warmup_failure_retries_fp32(self):
        failed = Mock()
        failed.rank.side_effect = RuntimeError('FP16 inference failed')
        failed.model.parameters.return_value = iter([SimpleNamespace(dtype=torch.float16)])
        reranker._reranker = failed
        with patch.object(torch.backends.mps, 'is_available', return_value=True), patch.object(reranker, '_create_reranker') as create, patch.object(reranker, '_release_reranker'):
            self.assertTrue(reranker.warmup_reranker())
            create.assert_called_once_with('mps', torch.float32, False)
            create.return_value.rank.assert_called_once()

    def test_both_load_attempts_fail(self):
        with patch.object(torch.backends.mps, 'is_available', return_value=True), patch.object(reranker, '_create_reranker', side_effect=RuntimeError('unavailable')) as create, patch.object(reranker, '_release_reranker'):
            self.assertFalse(reranker.load_reranker())
            self.assertEqual(create.call_count, 2)
