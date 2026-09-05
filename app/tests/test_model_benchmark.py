import asyncio
import copy
from unittest.mock import AsyncMock

import pytest

from services import model_benchmark as bench
from services.model_runtime_profiles import recommended_model_profile


@pytest.fixture(autouse=True)
def mock_delete(monkeypatch):
    monkeypatch.setattr(bench, "delete_result", AsyncMock())
    monkeypatch.setattr(bench, "stop_all_vyact_runtimes", lambda: None)


def profile(runtime="gguf"):
    value = recommended_model_profile("test/model", runtime, None, 32768)
    return {**value, "cpu_threads": 3, "gpu_split_percentages": [60, 40], "gpu_manual_split_enabled": True, "seed": 42}


def test_only_visible_controls_change_and_candidates_are_deduplicated():
    original = profile()
    candidates = bench.initial_candidates(original, True, False)
    assert len(candidates) == 3
    for value in candidates:
        for key in original.keys() - {*bench.TUNABLE_FIELDS, "cache_quantization"}:
            assert value[key] == original[key]
        assert not value["mtp_enabled"]
        assert value["kv_cache_precision"] == "q8"


def test_mlx_and_dflash_skip_hidden_controls():
    original = profile("mlx")
    assert len(bench.initial_candidates(original, False, False)) == 1
    assert len(bench.initial_candidates(original, True, False)) == 2
    assert len(bench.initial_candidates(original, True, True)) == 1
    for item in bench.initial_candidates(profile(), True, True)[1:]:
        assert item["mtp_enabled"] is False
        assert item["kv_cache_precision"] == "none"


def test_prefill_never_uses_ttft_and_cache_tokens_are_excluded():
    missing = bench.metrics({}, {}, 3.2, 5)
    assert missing["prefill_s"] is None
    measured = bench.metrics({"prompt_tokens": 1000, "cached_tokens": 800,
        "prompt_eval_duration": 2, "generation_duration": 4, "completion_tokens": 80}, {}, 3, 6)
    assert measured["prefill_s"] == 2
    assert measured["prefill_tps"] == 100
    assert measured["decode_tps"] == 20
    llama = bench.metrics({}, {"prompt_ms": 500, "prompt_n": 100, "predicted_ms": 1000,
        "predicted_n": 40, "cache_n": 900}, 1, 2)
    assert llama["prefill_tps"] == 200


@pytest.mark.asyncio
async def test_runner_restores_and_never_mutates_original(monkeypatch):
    original = profile()
    snapshot = copy.deepcopy(original)
    calls = []
    def start(value, *args):
        calls.append(copy.deepcopy(value))
        return "model"
    monkeypatch.setattr(bench, "start_configured_runtime", start)
    monkeypatch.setattr(bench, "fingerprint", lambda p: "test")
    monkeypatch.setattr(bench, "save_result", AsyncMock())
    monkeypatch.setattr(bench, "request_sample", AsyncMock(return_value={"total_s": 1, "decode_tps": 50, "ttft_s": .1}))
    job = bench.start_job(original, original, True, False)
    await bench._job_task
    assert job["status"] == "completed"
    assert job["completed"] == job["total"] == 15
    assert job["cases_completed"] == job["cases_total"] == 5
    assert calls[-1] == original == snapshot
    assert bench.active_job is None
    assert bench.save_result.await_count > 1


@pytest.mark.asyncio
async def test_cancel_before_loading_saves_cancelled_state_without_reloading(monkeypatch):
    original = profile("mlx")
    monkeypatch.setattr(bench, "fingerprint", lambda p: "test")
    restore = []
    monkeypatch.setattr(bench, "start_configured_runtime", lambda p, *args: restore.append(p) or "model")
    monkeypatch.setattr(bench, "save_result", AsyncMock())
    monkeypatch.setattr(bench, "request_sample", AsyncMock(return_value={"total_s": 1}))
    job = bench.start_job(original, original, False, False)
    bench.stop_job()
    await bench._job_task
    assert job["status"] == "cancelled"
    assert restore == []
    assert bench.save_result.await_count >= 1


@pytest.mark.asyncio
async def test_fallback_is_not_ranked_as_requested_mtp(monkeypatch):
    original = profile("mlx")
    def start(p, debug=False, status=None):
        if p.get("mtp_enabled") and status is not None:
            status["mtp_fallback"] = True
        return "model"
    monkeypatch.setattr(bench, "start_configured_runtime", start)
    monkeypatch.setattr(bench, "fingerprint", lambda p: "test")
    monkeypatch.setattr(bench, "request_sample", AsyncMock(return_value={"total_s": 1, "decode_tps": 50, "ttft_s": .1}))
    monkeypatch.setattr(bench, "save_result", AsyncMock())
    job = bench.start_job(original, original, True, False)
    await bench._job_task
    assert job["rows"][1]["error"] == "settings_changed"
    assert job["recommended"] == "1"


def test_active_requests_block_start():
    bench.active_requests = 1
    try:
        with pytest.raises(ValueError, match="busy"):
            bench.start_job(profile(), {}, True, False)
    finally:
        bench.active_requests = 0


def test_omlx_ttft_alias_is_not_presented_as_prefill():
    result = bench.metrics({"prompt_eval_duration": 4, "generation_duration": 2,
        "prompt_tokens": 100, "completion_tokens": 20, "cached_tokens": 0}, {}, 4.2, 6.2, "mlx")
    assert result["prefill_s"] is None
    assert result["prefill_tps"] is None
    assert result["decode_tps"] == 10


def test_shorter_answers_do_not_win_by_doing_less_work():
    quick_short = {"error": None, "samples": {w: [{"total_s": 1, "ttft_s": .1, "decode_tps": 10}] for w in bench.WORKLOADS}}
    longer_fast = {"error": None, "samples": {w: [{"total_s": 5, "ttft_s": .1, "decode_tps": 50}] for w in bench.WORKLOADS}}
    assert bench.score(longer_fast) < bench.score(quick_short)


@pytest.mark.asyncio
async def test_stop_interrupts_prefill_before_first_sse_chunk(monkeypatch):
    entered = asyncio.Event()
    exited = asyncio.Event()
    async def blocked(*args):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            exited.set()
    monkeypatch.setattr(bench, "_stream_sample", blocked)
    bench._stop.clear()
    task = asyncio.create_task(bench.request_sample(None, "model", profile(), []))
    await entered.wait()
    bench.stop_job()
    with pytest.raises(InterruptedError):
        await asyncio.wait_for(task, 1)
    assert exited.is_set()
    bench._stop.clear()


@pytest.mark.asyncio
async def test_restore_failure_is_explicit_and_persisted(monkeypatch):
    original = profile("mlx")
    monkeypatch.setattr(bench, "fingerprint", lambda p: "test")
    calls = 0
    def start(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("cannot_restore")
        return "model"
    monkeypatch.setattr(bench, "start_configured_runtime", start)
    monkeypatch.setattr(bench, "request_sample", AsyncMock(return_value={"total_s": 1, "ttft_s": .1, "decode_tps": 50}))
    monkeypatch.setattr(bench, "save_result", AsyncMock())
    job = bench.start_job(original, original, False, False)
    await bench._job_task
    assert job["status"] == "restore_failed"
    assert bench.active_job is None
    assert bench.save_result.await_count >= 1


def test_mlx_null_mtp_does_not_create_a_third_candidate():
    original = {**profile("mlx"), "mtp_enabled": None}
    candidates = bench.initial_candidates(original, True, False)
    assert [value["mtp_enabled"] for value in candidates] == [False, True]


@pytest.mark.asyncio
async def test_guard_keeps_streaming_request_exclusive(monkeypatch):
    messages = []
    entered = asyncio.Event()
    release = asyncio.Event()
    async def app(scope, receive, send):
        entered.set()
        await release.wait()
    async def send(message):
        messages.append(message)
    async def receive():
        return {"type": "http.request"}
    guard = bench.BenchmarkGuard(app)
    request = asyncio.create_task(guard({"type": "http", "method": "POST", "path": "/api/chat"}, receive, send))
    await entered.wait()
    assert bench.active_requests == 1
    with pytest.raises(ValueError, match="busy"):
        bench.start_job(profile(), {}, False, False)
    release.set()
    await request
    assert bench.active_requests == 0
    monkeypatch.setattr(bench, "active_job", {"status": "running"})
    await guard({"type": "http", "method": "POST", "path": "/v1/chat/completions"}, receive, send)
    assert messages[0]["status"] == 409


@pytest.mark.asyncio
async def test_selected_cases_checkpoint_before_next_case_and_restore(monkeypatch):
    original = profile()
    previous = {**original, "model_path": "previous/model"}
    monkeypatch.setattr(bench, "fingerprint", lambda p: "test")
    calls = []
    snapshots = []
    monkeypatch.setattr(bench, "start_configured_runtime", lambda p, *args: calls.append(copy.deepcopy(p)) or "model")
    async def save(job):
        snapshots.append(copy.deepcopy(job))
    monkeypatch.setattr(bench, "save_result", save)
    monkeypatch.setattr(bench, "request_sample", AsyncMock(return_value={"total_s": 1, "decode_tps": 50, "ttft_s": .1}))
    job = bench.start_job(original, previous, True, False, ["2", "4"])
    await bench._job_task
    assert [row["id"] for row in job["rows"]] == ["2", "4"]
    assert all(item["total"] == 6 for item in snapshots)
    assert any(item["completed"] == 1 and item["status"] == "running" for item in snapshots)
    assert calls[-1] == previous
    assert job["cases_completed"] == 2
    bench.delete_result.assert_awaited_once_with(original["model_path"])


@pytest.mark.asyncio
async def test_delete_failure_never_unloads_model(monkeypatch):
    monkeypatch.setattr(bench, "fingerprint", lambda p: "test")
    monkeypatch.setattr(bench, "delete_result", AsyncMock(side_effect=RuntimeError("ES unavailable")))
    runtime = AsyncMock()
    monkeypatch.setattr(bench, "start_configured_runtime", runtime)
    save = AsyncMock()
    monkeypatch.setattr(bench, "save_result", save)
    job = bench.start_job(profile(), {}, False, False, ["1"])
    await bench._job_task
    assert job["status"] == "failed"
    runtime.assert_not_called()
    save.assert_not_awaited()


@pytest.mark.parametrize("ids", [[], ["1", "1"], ["99"]])
def test_invalid_selection_rejected_before_deleting(ids):
    with pytest.raises(ValueError, match="invalid_benchmark_selection"):
        bench.start_job(profile(), {}, False, False, ids)
    bench.delete_result.assert_not_called()


def test_preview_identity_changes_with_capability_and_hardware(monkeypatch):
    monkeypatch.setattr(bench, "fingerprint", lambda p: "metal")
    first = bench.plan_identifier(profile(), False, False)
    assert first == bench.plan_identifier({**profile(), "plan_id": "ignored", "capabilities": {"free_bytes": 123}}, False, False)
    assert first != bench.plan_identifier(profile(), True, False)
    monkeypatch.setattr(bench, "fingerprint", lambda p: "cuda")
    assert first != bench.plan_identifier(profile(), False, False)


@pytest.mark.asyncio
async def test_stop_retains_completed_case_and_restores_previous_model(monkeypatch):
    monkeypatch.setattr(bench, "fingerprint", lambda p: "test")
    previous = {**profile("mlx"), "model_path": "previous/mlx"}
    loaded = []
    monkeypatch.setattr(bench, "start_configured_runtime", lambda p, *args: loaded.append(copy.deepcopy(p)) or "model")
    monkeypatch.setattr(bench, "request_sample", AsyncMock(return_value={"total_s": 1, "decode_tps": 50, "ttft_s": .1}))
    saved = []
    async def checkpoint(job):
        saved.append(copy.deepcopy(job))
        if job["cases_completed"] == 1 and job["phase"] != "done":
            bench.stop_job()
    monkeypatch.setattr(bench, "save_result", checkpoint)
    job = bench.start_job(profile(), previous, False, False, ["1", "2"])
    await bench._job_task
    assert job["status"] == "cancelled"
    assert job["completed"] == 3
    assert saved[-1]["completed"] == 3
    assert saved[-1]["status"] == "cancelled"
    assert loaded[-1] == previous
