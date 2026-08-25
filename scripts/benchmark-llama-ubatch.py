#!/usr/bin/env python3
"""Compare llama.cpp prefill throughput for 512 and 1024 token micro-batches."""
import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def wait_until_ready(port: int, process: subprocess.Popen) -> None:
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("llama-server stopped before becoming ready")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise TimeoutError("llama-server did not become ready")


def benchmark(server: Path, model: Path, port: int, ubatch: int, prompt_tokens: int) -> dict:
    command = [
        str(server), "--model", str(model), "--host", "127.0.0.1", "--port", str(port),
        "--ctx-size", str(max(8192, prompt_tokens + 512)), "--n-gpu-layers", "auto",
        "--flash-attn", "auto", "--batch-size", "2048", "--ubatch-size", str(ubatch),
        "--cache-type-k", "q8_0", "--cache-type-v", "q8_0", "--no-warmup",
    ]
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_until_ready(port, process)
        prompt = " benchmark" * prompt_tokens
        body = json.dumps({"prompt": prompt, "n_predict": 1, "cache_prompt": False}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/completion", data=body,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(request, timeout=300) as response:
            result = json.load(response)
        timings = result.get("timings", {})
        return {
            "ubatch": ubatch,
            "prompt_tokens": timings.get("prompt_n"),
            "prompt_ms": timings.get("prompt_ms"),
            "prompt_tokens_per_second": timings.get("prompt_per_second"),
        }
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    parser.add_argument("--server", type=Path, default=Path("/opt/homebrew/bin/llama-server"))
    parser.add_argument("--prompt-tokens", type=int, default=8192)
    parser.add_argument("--port", type=int, default=11436)
    args = parser.parse_args()
    results = [
        benchmark(args.server, args.model, args.port, ubatch, args.prompt_tokens)
        for ubatch in (512, 1024, 2048)
    ]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
