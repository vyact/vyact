"""Bounded benchmarks of user-visible model controls; never persist trial profiles."""
import asyncio
import copy
import hashlib
import json
import math
import platform
import shutil
import statistics
import time
import uuid
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import httpx
from elasticsearch import NotFoundError
from starlette.responses import JSONResponse

from services.db import MODEL_BENCHMARK_RESULTS_INDEX, get_es
from services.hardware_info import get_local_hardware_info
from logger import get_logger
from services.mlx_runtime import get_downloaded_mlx_model_path
from services.model_runtime_profiles import build_model_profile_id, normalize_model_profile
from services.vyact_runtime import VYACT_RUNTIME_URL, get_downloaded_model_path, get_runtime_paths, start_configured_runtime, stop_all_vyact_runtimes

INDEX = MODEL_BENCHMARK_RESULTS_INDEX
VERSION = 2
OUTPUT_TOKENS = 256
WORKLOADS = ("short", "long", "followup")
TUNABLE_FIELDS = ("performance_mode", "kv_cache_precision", "mtp_enabled")
FIXED_FIELDS = ("runtime", "context_size", "max_output_tokens", "history_token_budget", "temperature", "top_k", "top_p", "seed", "cpu_threads", "gpu_split_percentages", "gpu_manual_split_enabled")
logger = get_logger(__name__)
active_job = None
last_job = None
active_requests = 0
_job_task = None
_stop = asyncio.Event()


class BenchmarkGuard:
    """Keep streaming writes and external inference out of an exclusive benchmark."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        global active_requests
        guarded = scope["type"] == "http" and scope.get("method") not in ("GET", "HEAD", "OPTIONS")
        benchmark = scope.get("path", "").startswith("/api/vyact/models/benchmark")
        if guarded and not benchmark:
            if active_job is not None and scope.get("path") != "/api/shutdown":
                await JSONResponse({"code": "model_benchmark_busy", "detail": "model_benchmark_busy"}, status_code=409)(scope, receive, send)
                return
            active_requests += 1
            try:
                await self.app(scope, receive, send)
            finally:
                active_requests -= 1
        else:
            await self.app(scope, receive, send)


def fingerprint(profile):
    hardware = get_local_hardware_info()
    try:
        omlx_version = version("omlx")
    except PackageNotFoundError:
        omlx_version = None
    # Stable capacities/identities, not transient free-memory readings.
    model_path = (get_downloaded_mlx_model_path(profile["model_path"]) if profile["runtime"] == "mlx"
                  else get_downloaded_model_path(profile["model_path"]))
    model_files = sorted(model_path.glob("*")) if model_path.is_dir() else [model_path]
    executable = shutil.which("omlx") if profile["runtime"] == "mlx" else get_runtime_paths().llama_server
    if executable:
        model_files.append(Path(executable))
    files = [(str(path), path.stat().st_size, path.stat().st_mtime_ns) for path in model_files if path.is_file()]
    identity = {"platform": platform.platform(), "cpu": platform.processor(), "files": files,
                "gpus": [{key: gpu.get(key) for key in ("name", "total_bytes", "backend")}
                         for gpu in hardware.get("gpus", [])], "omlx": omlx_version,
                "memory": hardware.get("system_memory", {}).get("total_bytes"),
                "fixed": {key: profile.get(key) for key in FIXED_FIELDS}, "version": VERSION}
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def candidate(profile, **changes):
    value = {**profile, **changes}
    value["cache_quantization"] = value.get("kv_cache_precision", "none") != "none"
    return normalize_model_profile(value)


def unique_candidates(profiles):
    seen = set()
    result = []
    for profile in profiles:
        key = tuple(profile.get(field) for field in TUNABLE_FIELDS)
        if key not in seen:
            seen.add(key)
            result.append(profile)
    return result


def initial_candidates(profile, mtp, dflash):
    profile = {**profile, "mtp_enabled": bool(profile.get("mtp_enabled")) if mtp and not dflash else False}
    if profile["runtime"] == "mlx":
        return unique_candidates([profile] if dflash or not mtp else [
            profile, candidate(profile, mtp_enabled=False), candidate(profile, mtp_enabled=True)])
    kv = "none" if dflash else "q8"
    return unique_candidates([profile] + [candidate(profile, performance_mode=mode,
        mtp_enabled=False, kv_cache_precision=kv) for mode in ("auto", "performance", "memory")])


def planned_candidates(profile, mtp, dflash):
    values = initial_candidates(profile, mtp, dflash)
    if profile["runtime"] == "gguf" and not dflash:
        values.append(candidate(profile, performance_mode="auto", kv_cache_precision="none", mtp_enabled=False))
        if mtp:
            values.append(candidate(profile, performance_mode="auto", kv_cache_precision="none", mtp_enabled=True))
    return unique_candidates(values)


def plan_identifier(profile, mtp, dflash):
    identity = {"fingerprint": fingerprint(profile), "cases": [{key: value.get(key) for key in TUNABLE_FIELDS} for value in planned_candidates(profile, mtp, dflash)]}
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


async def delete_result(model_path):
    try:
        await get_es().delete(index=INDEX, id=build_model_profile_id(model_path), refresh="wait_for")
    except NotFoundError:
        pass


def metrics(usage, timings, ttft, total, runtime="gguf"):
    """Do not substitute TTFT for server-side prefill time."""
    prompt_s = usage.get("prompt_eval_duration")
    # oMLX 0.6.4 aliases prompt_eval_duration to server TTFT. Only accept
    # a separately reported prefill duration; never mislabel queue/first-token time.
    if runtime == "mlx":
        prompt_s = usage.get("prefill_duration")
    generation_s = usage.get("generation_duration")
    prompt_n = usage.get("prompt_tokens")
    output_n = usage.get("completion_tokens")
    cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", usage.get("cached_tokens"))
    if timings:
        prompt_s = timings.get("prompt_ms")
        prompt_s = prompt_s / 1000 if isinstance(prompt_s, (int, float)) else None
        generation_s = timings.get("predicted_ms")
        generation_s = generation_s / 1000 if isinstance(generation_s, (int, float)) else None
        prompt_n = timings.get("prompt_n")
        output_n = timings.get("predicted_n")
        cached = timings.get("cache_n", cached)
    else:
        prompt_n = max(0, prompt_n - cached) if isinstance(prompt_n, (int, float)) and isinstance(cached, (int, float)) else None
    result = {"prefill_s": prompt_s, "prefill_tps": prompt_n / prompt_s if prompt_n is not None and prompt_s and prompt_s > 0 else None,
            "decode_tps": output_n / generation_s if output_n is not None and generation_s and generation_s > 0 else None,
            "ttft_s": ttft, "total_s": total, "cached_tokens": cached, "output_tokens": output_n,
            "input_tokens": usage.get("prompt_tokens"), "processed_tokens": prompt_n}
    return {key: value if value is None or isinstance(value, (int, float)) and math.isfinite(value) and value >= 0 else None
            for key, value in result.items()}


async def _stream_sample(client, model, profile, messages):
    body = {"model": model, "messages": messages, "stream": True,
            "stream_options": {"include_usage": True}, "max_tokens": min(OUTPUT_TOKENS, profile["max_output_tokens"]),
            "temperature": profile["temperature"]}
    for key in ("top_k", "top_p", "seed"):
        if profile.get(key) is not None:
            body[key] = profile[key]
    started = time.perf_counter()
    first = None
    usage, timings = {}, {}
    finish = None
    async with client.stream("POST", f"{VYACT_RUNTIME_URL}/chat/completions", json=body) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if _stop.is_set():
                raise InterruptedError("cancelled")
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            data = json.loads(line[6:])
            if data.get("error"):
                raise RuntimeError("inference_failed")
            usage.update(data.get("usage") or {})
            timings.update(data.get("timings") or {})
            for choice in data.get("choices", []):
                delta = choice.get("delta") or {}
                if first is None and (delta.get("content") or delta.get("reasoning_content")):
                    first = time.perf_counter() - started
                finish = choice.get("finish_reason") or finish
    if first is None or finish is None:
        raise RuntimeError("incomplete_response")
    return {**metrics(usage, timings, first, time.perf_counter() - started, profile["runtime"]), "finish_reason": finish}


async def request_sample(client, model, profile, messages):
    """Cancel an in-flight prefill too, even before the server sends SSE data."""
    request = asyncio.create_task(_stream_sample(client, model, profile, messages))
    cancelled = asyncio.create_task(_stop.wait())
    try:
        done, _ = await asyncio.wait((request, cancelled), timeout=180, return_when=asyncio.FIRST_COMPLETED)
        if cancelled in done:
            raise InterruptedError("cancelled")
        if request not in done:
            raise TimeoutError("request_timeout")
        return request.result()
    finally:
        for task in (request, cancelled):
            if not task.done():
                task.cancel()
        await asyncio.gather(request, cancelled, return_exceptions=True)


def score(row):
    if row.get("error") or any(not row["samples"].get(w) for w in WORKLOADS):
        return float("inf")
    # Normalize to the same output budget so early EOS does not win by doing less work.
    values = []
    for workload in WORKLOADS:
        samples = row["samples"][workload]
        if any(not s.get("decode_tps") or s.get("ttft_s") is None for s in samples):
            return float("inf")
        values.append(statistics.median(s["ttft_s"] + OUTPUT_TOKENS / s["decode_tps"] for s in samples))
    return sum(values)


async def read_result(model_path):
    try:
        response = await get_es().get(index=INDEX, id=build_model_profile_id(model_path))
        return response["_source"]
    except NotFoundError:
        return None


async def save_result(job):
    es = get_es()
    if not await es.indices.exists(index=INDEX):
        await es.indices.create(index=INDEX, settings={"number_of_shards": 1, "number_of_replicas": 0},
                                mappings={"dynamic": False, "properties": {"model_path": {"type": "keyword"}}})
    await es.index(index=INDEX, id=build_model_profile_id(job["model_path"]), document=job, refresh="wait_for")


def start_job(profile, previous, mtp, dflash, selected_case_ids=None):
    global active_job, last_job, _job_task
    if active_job is not None or active_requests:
        raise ValueError("model_benchmark_busy")
    candidates = planned_candidates(profile, mtp, dflash)
    ids = selected_case_ids if selected_case_ids is not None else [str(i + 1) for i in range(len(candidates))]
    if not ids or len(ids) != len(set(ids)) or any(i not in {str(n + 1) for n in range(len(candidates))} for i in ids):
        raise ValueError("invalid_benchmark_selection")
    selected = [{"id": str(i + 1), "profile": value} for i, value in enumerate(candidates) if str(i + 1) in ids]
    _stop.clear()
    active_job = {"id": uuid.uuid4().hex, "model_path": profile["model_path"], "status": "running",
                  "phase": "loading", "rows": [], "completed": 0, "total": len(selected) * len(WORKLOADS),
                  "cases_completed": 0, "cases_total": len(selected), "selected_cases": selected,
                  "created_at": datetime.now(timezone.utc).isoformat(), "fingerprint": fingerprint(profile),
                  "base_profile": copy.deepcopy(profile), "recommended": None, "mtp_supported": mtp,
                  "estimated_remaining_s": None}
    last_job = active_job
    _job_task = asyncio.create_task(run_job(active_job, copy.deepcopy(previous), mtp, dflash))
    return active_job


def stop_job():
    _stop.set()


async def shutdown():
    stop_job()
    if _job_task and not _job_task.done():
        await asyncio.shield(_job_task)


async def run_job(job, previous, mtp, dflash):
    global active_job
    profile = job["base_profile"]
    candidates = job["selected_cases"]
    runtime_touched = False
    previous_deleted = False
    try:
        # The reserved active job blocks competing starts while ES is awaited.
        await delete_result(profile["model_path"])
        previous_deleted = True
        await save_result(copy.deepcopy(job))
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=10)) as client:
            async def measure(row, repetitions=1):
                if _stop.is_set():
                    raise InterruptedError("cancelled")
                job.update(phase="loading", current=row["id"])
                effective = copy.deepcopy(row["profile"])
                status = {}
                nonlocal runtime_touched
                runtime_touched = True
                await asyncio.to_thread(stop_all_vyact_runtimes)
                model = await asyncio.to_thread(start_configured_runtime, effective, False, status)
                if status.get("mtp_fallback") or effective["context_size"] != profile["context_size"]:
                    raise RuntimeError("settings_changed")
                row["effective_profile"] = effective
                job["phase"] = "warmup"
                await request_sample(client, model, profile, [{"role": "user", "content": "Count from one to ten."}])
                for repetition in range(repetitions):
                    # A unique prefix prevents accidental reuse between candidates/repeats.
                    nonce = uuid.uuid4().hex
                    unit = "The observatory records temperature, rainfall and wind each morning. Measurements are checked and stored for comparison. "
                    long_text = unit * min(160, max(16, profile["context_size"] // 80))
                    short_text = unit * 20
                    prefix = {"role": "system", "content": f"Benchmark {nonce}. Follow the instruction and answer in English."}
                    short_prefix = {"role": "system", "content": f"Short benchmark {uuid.uuid4().hex}. Follow the instruction and answer in English."}
                    long_messages = [prefix, {"role": "user", "content": long_text + "\nExplain this monitoring process in detail."}]
                    workloads = {"short": [short_prefix, {"role": "user", "content": short_text + "\nExplain in detail."}],
                                 "long": long_messages,
                                 "followup": [*long_messages, {"role": "assistant", "content": "The observations are recorded daily."},
                                              {"role": "user", "content": "Describe how to validate these observations in detail."}]}
                    for workload, messages in workloads.items():
                        job.update(phase=workload)
                        sample = await request_sample(client, model, profile, messages)
                        row["samples"][workload].append(sample)
                        job["completed"] += 1
                        await save_result(copy.deepcopy(job))
                        durations = [s["total_s"] for r in job["rows"] for samples in r["samples"].values() for s in samples]
                        job["estimated_remaining_s"] = statistics.mean(durations) * max(0, job["total"] - job["completed"])

            async def add_candidate(value):
                row = {"id": value["id"], "profile": value["profile"],
                       "samples": {w: [] for w in WORKLOADS}, "error": None}
                job["rows"].append(row)
                try:
                    await measure(row)
                except InterruptedError:
                    raise
                except Exception as error:
                    logger.exception("[benchmark] case %s failed", row["id"])
                    row["error"] = str(error) if str(error) == "settings_changed" else "case_failed"
                job["cases_completed"] += 1
                await save_result(copy.deepcopy(job))
                return row

            for value in candidates:
                await add_candidate(value)
            valid = [r for r in job["rows"] if score(r) < float("inf")]
            job["recommended"] = min(valid, key=score)["id"] if valid and len(job["rows"]) > 1 else None
            job["status"] = "completed" if any(not r["error"] and all(r["samples"].get(w) for w in WORKLOADS) for r in job["rows"]) else "failed"
    except InterruptedError:
        job["status"] = "cancelled"
    except Exception:
        logger.exception("[benchmark] run failed")
        job["status"] = "failed"
    finally:
        job["phase"] = "restoring"
        try:
            if not runtime_touched:
                pass
            elif previous.get("model_path"):
                restore_status = {}
                original_context = previous.get("context_size")
                restored_model = await asyncio.to_thread(start_configured_runtime, previous, False, restore_status)
                if restore_status.get("mtp_fallback") or previous.get("context_size") != original_context:
                    raise RuntimeError("restore_settings_changed")
                _stop.clear()
                async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=10)) as restore_client:
                    await request_sample(restore_client, restored_model, normalize_model_profile(previous),
                                         [{"role": "user", "content": "Reply with OK."}])
            else:
                await asyncio.to_thread(stop_all_vyact_runtimes)
        except Exception:
            logger.exception("[benchmark] model restoration failed")
            job["status"] = "restore_failed"
        job["phase"] = "done"
        job["finished_at"] = datetime.now(timezone.utc).isoformat()
        try:
            if previous_deleted:
                await save_result(copy.deepcopy(job))
        except Exception:
            logger.exception("[benchmark] result persistence failed")
            job["unsaved_status"] = job["status"]
            job["status"] = "save_failed"
        active_job = None
