"""Hugging Face GGUF discovery and safe resumeless downloads for Vyact."""
import asyncio
import json
import re
import shutil
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import httpx

from services.vyact_runtime import VYACT_MODELS_DIR, cache_downloaded_model

HF_API_URL = "https://huggingface.co/api"
HF_BASE_URL = "https://huggingface.co"
MLX_REPOSITORY_FILE = "__mlx_repository__"
MLX_DOWNLOAD_PATTERNS = (
    "*.json", "*.safetensors", "*.model", "*.txt", "*.tiktoken", "*.jinja", "*.py", "*.npz",
)
_REPO_ID_PATTERN = re.compile(r"^[\w.-]+/[\w.-]+$")
_F16_BYTES_PER_VALUE = 2
_Q8_BYTES_PER_VALUE = 1.0625
_KV_CACHE_QUANTIZATION_MIN_CONTEXT = 32768
_MINIMUM_RUNTIME_BUFFER_BYTES = 512 * 1024 ** 2
_RECOMMENDED_MEMORY_UTILIZATION = 0.60
_MINIMUM_PRACTICAL_CONTEXT_SIZE = 8192
_CONTEXT_SIZE_CANDIDATES = (131072, 65536, 32768, 16384, _MINIMUM_PRACTICAL_CONTEXT_SIZE)


def _headers(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def _safe_relative_file_path(filename: str) -> PurePosixPath:
    path = PurePosixPath(filename)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.suffix.lower() != ".gguf":
        raise ValueError("A GGUF filename inside the repository is required")
    return path


def _model_file_size_from_hub_item(item: dict, filename: str, runtime: str) -> int:
    siblings = [sibling for sibling in item.get("siblings", []) if isinstance(sibling, dict)]
    if runtime == "mlx":
        return sum(
            int(sibling.get("size") or sibling.get("lfs", {}).get("size") or 0)
            for sibling in siblings
            if any(PurePosixPath(str(sibling.get("rfilename", ""))).match(pattern) for pattern in MLX_DOWNLOAD_PATTERNS)
        )
    return next((
        int(sibling.get("size") or sibling.get("lfs", {}).get("size") or 0)
        for sibling in siblings if str(sibling.get("rfilename", "")) == filename
    ), 0)


async def get_model_file_size(
        repository: str, filename: str, runtime: str, token: str | None = None,
) -> int:
    """Fetch weight size for one selected model without slowing down search listing."""
    if not _REPO_ID_PATTERN.fullmatch(repository):
        raise ValueError("Invalid Hugging Face repository ID")
    if runtime not in {"gguf", "mlx"}:
        raise ValueError("Invalid model runtime")
    if runtime == "gguf":
        _safe_relative_file_path(filename)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            f"{HF_API_URL}/models/{quote(repository, safe='/')}",
            params={"blobs": "true"},
            headers=_headers(token),
        )
        response.raise_for_status()
    size = _model_file_size_from_hub_item(response.json(), filename, runtime)
    if size <= 0:
        raise ValueError("Model weight size is unavailable")
    return size


async def search_gguf_models(query: str, token: str | None = None, limit: int = 50) -> list[dict]:
    """Search public Hub repositories which declare GGUF as their library."""
    params = {
        "library": "gguf", "limit": max(1, min(limit, 50)),
        "full": "true", "blobs": "true", "sort": "downloads", "direction": "-1",
    }
    if query.strip():
        params["search"] = query.strip()
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{HF_API_URL}/models", params=params, headers=_headers(token))
        response.raise_for_status()
        search_items = response.json()
    models = [
        model for item in search_items
        if isinstance(item, dict)
        and "dflash2" not in str(item.get("id", "")).lower()
        and (model := _model_from_hub_item(item))
    ]
    return sorted(models, key=lambda model: model["downloads"], reverse=True)


async def search_mlx_models(query: str, token: str | None = None, limit: int = 50) -> list[dict]:
    """Search complete MLX repositories for the Apple Silicon runtime."""
    params = {
        "library": "mlx", "limit": max(1, min(limit, 50)), "full": "true", "blobs": "true",
        "sort": "downloads", "direction": "-1",
    }
    if query.strip():
        params["search"] = query.strip()
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{HF_API_URL}/models", params=params, headers=_headers(token))
        response.raise_for_status()
        search_items = response.json()
    models = [
        model for item in search_items
        if isinstance(item, dict)
        if "-mtp-" not in str(item.get("id", "")).lower()
        and ("dflash2" not in str(item.get("id", "")).lower() or _is_bundled_dflash2_mlx(item))
        and (model := _mlx_model_from_hub_item(item))
    ]
    return sorted(models, key=lambda model: model["downloads"], reverse=True)


def _dflash2_model_family(repository: str) -> str:
    name = repository.rsplit("/", 1)[-1].lower()
    name = re.sub(r"-(?:gguf|mlx)$", "", name)
    name = re.sub(r"-dflash2(?:-w\d+a\d+)?$", "", name)
    name = re.sub(r"-(?:mlx-)?(?:\d+(?:\.\d+)?bit|bf16|fp16|fp8|q\d(?:_[a-z0-9]+)*)$", "", name)
    name = re.sub(r"-(?:gguf|mlx)$", "", name)
    return name


def _select_dflash2_model(repository: str, candidates: list[dict]) -> dict | None:
    family = _dflash2_model_family(repository)
    matches = [candidate for candidate in candidates if _dflash2_model_family(candidate["repository"]) == family]
    if not matches:
        return None
    return min(matches, key=lambda candidate: (candidate.get("priority", 2), candidate["size"]))


async def _search_dflash2_models(query: str, token: str | None, runtime: str) -> list[dict]:
    params = {
        "search": f"{query.strip()} DFlash2".strip(), "limit": 50, "full": "true", "blobs": "true",
        "sort": "downloads", "direction": "-1",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{HF_API_URL}/models", params=params, headers=_headers(token))
        response.raise_for_status()
        search_items = response.json()
        repository_ids = [
            str(item.get("id", "")) for item in search_items
            if isinstance(item, dict) and _REPO_ID_PATTERN.fullmatch(str(item.get("id", "")))
        ]
        detailed_items = await _fetch_model_details(client, repository_ids, token)
    candidates = []
    for item in search_items:
        if not isinstance(item, dict):
            continue
        item = _merge_search_and_detail(item, detailed_items.get(str(item.get("id", ""))))
        repository = str(item.get("id", ""))
        if "dflash2" not in repository.lower() or not _REPO_ID_PATTERN.fullmatch(repository):
            continue
        siblings = [sibling for sibling in item.get("siblings", []) if isinstance(sibling, dict)]
        if runtime == "gguf":
            files = [
                str(sibling.get("rfilename", "")) for sibling in siblings
                if str(sibling.get("rfilename", "")).lower().endswith(".gguf")
            ]
            if not files:
                continue
            filename = min(files, key=lambda value: (0 if "q4_k_m" in value.lower() else 1, value))
            sibling = next(value for value in siblings if value.get("rfilename") == filename)
            size = int(sibling.get("size") or sibling.get("lfs", {}).get("size") or 0)
            candidates.append({
                "repository": repository, "revision": str(item.get("sha") or "main"),
                "filename": filename, "size": size, "priority": 0 if "q4_k_m" in filename.lower() else 1,
            })
        elif any(str(sibling.get("rfilename", "")).lower().endswith(".safetensors") for sibling in siblings):
            candidates.append({
                "repository": repository, "revision": str(item.get("sha") or "main"),
                "size": sum(int(s.get("size") or s.get("lfs", {}).get("size") or 0) for s in siblings),
                "priority": 0,
            })
    return candidates


def _mlx_model_family(repository: str) -> str:
    name = repository.rsplit("/", 1)[-1].lower()
    name = re.sub(r"-(?:mlx-)?(?:\d+(?:\.\d+)?bit|bf16|fp16|fp8)$", "", name)
    name = re.sub(r"-mtp$", "", name)
    return name


def _select_mlx_mtp_model(repository: str, candidates: list[dict]) -> dict | None:
    family = _mlx_model_family(repository)
    matches = [candidate for candidate in candidates if _mlx_model_family(candidate["repository"]) == family]
    if not matches:
        return None
    return min(matches, key=lambda candidate: (
        0 if candidate["repository"].lower().endswith("-bf16") else 1,
        candidate["size"],
    ))


async def _search_mlx_mtp_models(query: str, token: str | None) -> list[dict]:
    search_term = f"{query.strip()} MTP".strip()
    params = {
        "search": search_term, "library": "mlx", "limit": 50, "full": "true", "blobs": "true",
        "sort": "downloads", "direction": "-1",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{HF_API_URL}/models", params=params, headers=_headers(token))
        response.raise_for_status()
        search_items = response.json()
        repository_ids = [
            str(item.get("id", "")) for item in search_items
            if isinstance(item, dict) and _REPO_ID_PATTERN.fullmatch(str(item.get("id", "")))
        ]
        detailed_items = await _fetch_model_details(client, repository_ids, token)
    items = [
        _merge_search_and_detail(item, detailed_items.get(str(item.get("id", ""))))
        for item in search_items if isinstance(item, dict)
    ]
    return [
        {
            "repository": str(item.get("id")),
            "revision": str(item.get("sha") or "main"),
            "size": sum(
                int(sibling.get("size") or sibling.get("lfs", {}).get("size") or 0)
                for sibling in item.get("siblings", []) if isinstance(sibling, dict)
            ),
        }
        for item in items
        if isinstance(item, dict)
        and "-mtp-" in str(item.get("id", "")).lower()
        and _REPO_ID_PATTERN.fullmatch(str(item.get("id", "")))
        and any(
            str(sibling.get("rfilename", "")).lower().endswith(".safetensors")
            for sibling in item.get("siblings", []) if isinstance(sibling, dict)
        )
        and any(
            str(sibling.get("rfilename", "")).lower() == "config.json"
            for sibling in item.get("siblings", []) if isinstance(sibling, dict)
        )
    ]


async def _fetch_model_details(
        client: httpx.AsyncClient, repository_ids: list[str], token: str | None = None,
) -> dict[str, dict]:
    responses = await asyncio.gather(*(
        client.get(
            f"{HF_API_URL}/models/{quote(repository_id, safe='/')}",
            params={"blobs": "true"},
            headers=_headers(token),
        )
        for repository_id in repository_ids
    ), return_exceptions=True)
    return {
        repository_id: response.json()
        for repository_id, response in zip(repository_ids, responses)
        if not isinstance(response, Exception) and response.is_success
    }


async def _fetch_mlx_configs(
        client: httpx.AsyncClient, items: list[dict], token: str | None = None,
) -> dict[str, dict]:
    repositories = [
        (str(item.get("id", "")), str(item.get("sha") or "main"))
        for item in items
        if _REPO_ID_PATTERN.fullmatch(str(item.get("id", "")))
    ]
    responses = await asyncio.gather(*(
        client.get(
            f"{HF_BASE_URL}/{quote(repository, safe='/')}/resolve/{quote(revision, safe='')}/config.json",
            headers=_headers(token),
            follow_redirects=True,
        )
        for repository, revision in repositories
    ), return_exceptions=True)
    configs = {}
    for (repository, _), response in zip(repositories, responses):
        if isinstance(response, Exception) or not response.is_success:
            continue
        try:
            config = response.json()
        except ValueError:
            continue
        if isinstance(config, dict):
            configs[repository] = config
    return configs


def _merge_search_and_detail(search_item: dict, detailed_item: dict | None) -> dict:
    if not detailed_item:
        return search_item
    return {
        **search_item,
        **detailed_item,
        "downloads": search_item.get("downloads", detailed_item.get("downloads", 0)),
    }


def _mlx_quantization_label(config: dict) -> str:
    text_config = config.get("text_config") if isinstance(config.get("text_config"), dict) else {}
    for model_config in (text_config, config):
        for key in ("quantization_config", "quantization"):
            quantization = model_config.get(key)
            if not isinstance(quantization, dict):
                continue
            algorithms = [
                str(value).upper()
                for value_key, value in _walk_dict_values(quantization)
                if value_key in {"quant_algo", "quantization_method"} and isinstance(value, str)
            ]
            for algorithm in ("NVFP4", "MXFP8", "FP8", "GPTQ", "AWQ"):
                if any(algorithm in value for value in algorithms):
                    return algorithm
            bits = quantization.get("bits") or quantization.get("weight_bits")
            if not bits:
                bits = next((
                    value for value_key, value in _walk_dict_values(quantization)
                    if value_key == "num_bits" and isinstance(value, (int, float)) and value > 0
                ), 0)
            if isinstance(bits, (int, float)) and bits > 0:
                return f"{int(bits)}-bit"
    dtype = str(text_config.get("dtype") or config.get("dtype") or "").lower()
    return {
        "bfloat16": "BF16",
        "float16": "FP16",
        "float32": "FP32",
        "float8": "FP8",
    }.get(dtype, "")


def _mlx_quantization_label_from_repository(repository: str) -> str:
    name = repository.rsplit("/", 1)[-1].lower()
    if match := re.search(r"(?:^|[-_])(\d+(?:\.\d+)?)bit(?:$|[-_])", name):
        return f"{match.group(1)}-bit"
    for marker, label in (("bf16", "BF16"), ("fp16", "FP16"), ("fp8", "FP8")):
        if re.search(rf"(?:^|[-_]){marker}(?:$|[-_])", name):
            return label
    return ""


def _walk_dict_values(value: dict):
    for key, child in value.items():
        yield key, child
        if isinstance(child, dict):
            yield from _walk_dict_values(child)


def _mlx_model_from_hub_item(item: dict, config: dict | None = None) -> dict | None:
    repo_id = str(item.get("id", ""))
    if not _REPO_ID_PATTERN.fullmatch(repo_id):
        return None
    siblings = [sibling for sibling in item.get("siblings", []) if isinstance(sibling, dict)]
    has_weights = any(str(sibling.get("rfilename", "")).lower().endswith(".safetensors") for sibling in siblings)
    has_config = any(str(sibling.get("rfilename", "")).lower() == "config.json" for sibling in siblings)
    if not has_weights or not has_config:
        return None
    size = sum(
        int(sibling.get("size") or sibling.get("lfs", {}).get("size") or 0)
        for sibling in siblings
        if any(PurePosixPath(str(sibling.get("rfilename", ""))).match(pattern) for pattern in MLX_DOWNLOAD_PATTERNS)
    )
    bundled_dflash2 = _is_bundled_dflash2_mlx(item)
    return {
        "id": repo_id,
        "runtime": "mlx",
        "revision": str(item.get("sha") or "main"),
        "downloads": item.get("downloads", 0),
        "files": [MLX_REPOSITORY_FILE],
        "file_sizes": {MLX_REPOSITORY_FILE: size},
        "mtp_supported_files": [],
        "dflash2_supported_files": [MLX_REPOSITORY_FILE] if bundled_dflash2 else [],
        "dflash2_bundled": bundled_dflash2,
        "quantization": _mlx_quantization_label(config or {}) or _mlx_quantization_label_from_repository(repo_id),
    }


def _is_bundled_dflash2_mlx(item: dict) -> bool:
    filenames = {
        str(sibling.get("rfilename", "")).lower()
        for sibling in item.get("siblings", []) if isinstance(sibling, dict)
    }
    has_target = "config.json" in filenames and any(
        "/" not in filename and filename.endswith(".safetensors") for filename in filenames
    )
    has_drafter = "dflash/config.json" in filenames and any(
        filename.startswith("dflash/") and filename.endswith(".safetensors") for filename in filenames
    )
    return has_target and has_drafter


def calculate_mlx_metadata_from_config(
    config: dict, file_size: int, context_size: int, kv_cache_precision: str | None = None,
) -> dict:
    text_config = config.get("text_config") if isinstance(config.get("text_config"), dict) else {}
    model_config = {**config, **text_config}

    def number(*names: str) -> int:
        for name in names:
            value = model_config.get(name)
            if isinstance(value, (int, float)) and value > 0:
                return int(value)
        return 0

    block_count = number("num_hidden_layers", "num_layers", "n_layer")
    head_count = number("num_attention_heads", "n_head")
    kv_head_count = number("num_key_value_heads", "num_kv_heads") or head_count
    hidden_size = number("hidden_size", "d_model", "n_embd")
    head_dimension = number("head_dim") or (hidden_size // head_count if head_count else 0)
    model_context = number("max_position_embeddings", "model_max_length", "max_seq_len", "max_sequence_length")
    effective_context = min(context_size, model_context or context_size)
    kv_bytes_per_value = {
        "q4": 0.5625,
        "q8": _Q8_BYTES_PER_VALUE,
        "none": _F16_BYTES_PER_VALUE,
    }.get(
        kv_cache_precision,
        _Q8_BYTES_PER_VALUE if context_size >= _KV_CACHE_QUANTIZATION_MIN_CONTEXT else _F16_BYTES_PER_VALUE,
    )
    layer_types = model_config.get("layer_types")
    sliding_window = number("sliding_window")
    if (
        isinstance(layer_types, list)
        and len(layer_types) == block_count
        and sliding_window
    ):
        global_kv_head_count = number("num_global_key_value_heads") or kv_head_count
        global_head_dimension = number("global_head_dim") or head_dimension
        kv_cache_bytes = 0
        for layer_type in layer_types:
            normalized_layer_type = str(layer_type).lower()
            if "sliding" in normalized_layer_type or "local" in normalized_layer_type:
                cached_tokens = min(effective_context, sliding_window)
                layer_kv_head_count = kv_head_count
                layer_head_dimension = head_dimension
            else:
                cached_tokens = effective_context
                layer_kv_head_count = global_kv_head_count
                layer_head_dimension = global_head_dimension
            kv_cache_bytes += (
                cached_tokens
                * layer_kv_head_count
                * layer_head_dimension
                * 2
                * kv_bytes_per_value
            )
    else:
        kv_cache_bytes = (
            effective_context * block_count * kv_head_count * head_dimension * 2 * kv_bytes_per_value
        )
    runtime_buffer_bytes = max(_MINIMUM_RUNTIME_BUFFER_BYTES, int(file_size * .05))
    architectures = model_config.get("architectures") or config.get("architectures") or []
    architecture = str(architectures[0] if isinstance(architectures, list) and architectures else "MLX")
    return {
        "architecture": architecture,
        "parameter_count": 0,
        "context_length": model_context,
        "block_count": block_count,
        "quantization": _mlx_quantization_label(config) or "MLX",
        "kv_cache_bytes": kv_cache_bytes,
        "runtime_buffer_bytes": runtime_buffer_bytes,
        "estimated_memory_bytes": file_size + kv_cache_bytes + runtime_buffer_bytes,
        "file_size_bytes": file_size,
    }


def recommend_downloaded_mlx_context(model_path: Path, total_memory_bytes: int, fallback: int = 32768) -> int:
    """Choose a stable first-run context from the installed model and unified memory."""
    try:
        config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return fallback
    if not isinstance(config, dict) or total_memory_bytes <= 0:
        return fallback

    file_size = sum(
        path.stat().st_size
        for path in model_path.rglob("*")
        if path.is_file()
    )
    memory_budget = int(total_memory_bytes * _RECOMMENDED_MEMORY_UTILIZATION)
    for context_size in _CONTEXT_SIZE_CANDIDATES:
        metadata = calculate_mlx_metadata_from_config(config, file_size, context_size)
        model_limit = int(metadata.get("context_length") or context_size)
        if context_size <= model_limit and int(metadata["estimated_memory_bytes"]) <= memory_budget:
            return context_size
    # A 512-token profile leaves no useful room for a system prompt, user input,
    # and response. Keep the memory warning visible, but initialize a functional
    # profile when the model exceeds the conservative 60% recommendation budget.
    model_metadata = calculate_mlx_metadata_from_config(
        config, file_size, _MINIMUM_PRACTICAL_CONTEXT_SIZE,
    )
    model_limit = int(model_metadata.get("context_length") or _MINIMUM_PRACTICAL_CONTEXT_SIZE)
    return max(512, min(_MINIMUM_PRACTICAL_CONTEXT_SIZE, model_limit))


async def inspect_mlx_model_metadata(
        repository: str, revision: str, file_size: int, context_size: int,
        token: str | None = None,
) -> dict:
    """Inspect a small MLX config without downloading model weights."""
    if not _REPO_ID_PATTERN.fullmatch(repository):
        raise ValueError("Invalid Hugging Face repository ID")
    url = (
        f"https://huggingface.co/{quote(repository, safe='/')}/resolve/"
        f"{quote(revision, safe='')}/config.json"
    )
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        response = await client.get(url, headers=_headers(token))
        response.raise_for_status()
        config = response.json()
    if not isinstance(config, dict):
        raise ValueError("Invalid MLX config.json")
    return calculate_mlx_metadata_from_config(config, file_size, context_size)


def _model_from_hub_item(item: dict) -> dict | None:
    repo_id = str(item.get("id", ""))
    if not _REPO_ID_PATTERN.fullmatch(repo_id):
        return None
    gguf_siblings = [
        sibling for sibling in item.get("siblings", [])
        if isinstance(sibling, dict) and str(sibling.get("rfilename", "")).lower().endswith(".gguf")
    ]
    gguf_files = [sibling["rfilename"] for sibling in gguf_siblings]
    if not gguf_files:
        return None
    file_sizes = {
        sibling["rfilename"]: int(sibling.get("size") or sibling.get("lfs", {}).get("size") or 0)
        for sibling in gguf_siblings
    }
    mtp_supported_files = [
        filename for filename in gguf_files
        if not PurePosixPath(filename).name.lower().startswith("mtp-")
        and _select_mtp_sidecar(item, filename) is not None
    ]
    return {
        "id": repo_id,
        "runtime": "gguf",
        "revision": str(item.get("sha") or "main"),
        "downloads": item.get("downloads", 0),
        "files": gguf_files,
        "file_sizes": file_sizes,
        "mtp_supported_files": mtp_supported_files,
        "dflash2_supported_files": [],
    }


def _model_family(filename: str) -> str:
    basename = PurePosixPath(filename).name.lower()
    if basename.startswith("mtp-"):
        basename = basename[4:]
    return re.sub(r"-(?:ud-)?(?:i?q\d(?:_[a-z0-9]+)+|bf16)\.gguf$", "", basename)


def _select_mtp_sidecar(item: dict, main_filename: str) -> tuple[str, int] | None:
    """Select a small MTP sidecar only; never mistake a full MTP model for one."""
    main_family = _model_family(main_filename)
    candidates = []
    for sibling in item.get("siblings", []):
        if not isinstance(sibling, dict):
            continue
        filename = str(sibling.get("rfilename", ""))
        basename = PurePosixPath(filename).name.lower()
        if not basename.startswith("mtp-") or not basename.endswith(".gguf"):
            continue
        if _model_family(filename) != main_family:
            continue
        size = int(sibling.get("size") or sibling.get("lfs", {}).get("size") or 0)
        priority = 0 if "q4_0" in basename else 1 if "q8_0" in basename else 2
        candidates.append((priority, size or 2**63, filename, size))
    if not candidates:
        return None
    _, _, filename, size = min(candidates)
    return filename, size


def _select_vision_projector(item: dict, main_filename: str) -> tuple[str, int] | None:
    """Select the best llama.cpp vision projector published beside a model."""
    if PurePosixPath(main_filename).name.lower().startswith(("mtp-", "mmproj")):
        return None
    candidates = []
    for sibling in item.get("siblings", []):
        if not isinstance(sibling, dict):
            continue
        filename = str(sibling.get("rfilename", ""))
        basename = PurePosixPath(filename).name.lower()
        if not basename.startswith("mmproj") or not basename.endswith(".gguf"):
            continue
        if re.search(r"-\d{5}-of-\d{5}\.gguf$", basename):
            continue
        size = int(sibling.get("size") or sibling.get("lfs", {}).get("size") or 0)
        priority = 1 if "bf16" in basename else 0 if "f16" in basename else 2 if "q8" in basename else 3
        candidates.append((priority, size or 2**63, filename, size))
    if not candidates:
        return None
    _, _, filename, size = min(candidates)
    return filename, size


async def find_mtp_sidecar(
        repo_id: str, main_filename: str, token: str | None = None,
) -> tuple[str, int] | None:
    """Return a verified MTP sidecar from the selected model repository."""
    if not _REPO_ID_PATTERN.fullmatch(repo_id):
        raise ValueError("Invalid Hugging Face repository ID")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            f"{HF_API_URL}/models/{repo_id}", params={"blobs": "true"}, headers=_headers(token),
        )
        response.raise_for_status()
    return _select_mtp_sidecar(response.json(), main_filename)


async def find_vision_projector(
        repo_id: str, main_filename: str, token: str | None = None,
) -> tuple[str, int] | None:
    """Return a llama.cpp mmproj file from the selected model repository."""
    if not _REPO_ID_PATTERN.fullmatch(repo_id):
        raise ValueError("Invalid Hugging Face repository ID")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            f"{HF_API_URL}/models/{quote(repo_id, safe='/')}",
            params={"blobs": "true"},
            headers=_headers(token),
        )
        response.raise_for_status()
    return _select_vision_projector(response.json(), main_filename)


async def download_gguf_model(repo_id: str, filename: str, token: str | None = None):
    """Yield (bytes_received, total_bytes) while writing an atomically completed GGUF."""
    if not _REPO_ID_PATTERN.fullmatch(repo_id):
        raise ValueError("Invalid Hugging Face repository ID")
    relative_path = _safe_relative_file_path(filename)
    destination = VYACT_MODELS_DIR / repo_id / Path(*relative_path.parts)
    temporary = destination.with_suffix(destination.suffix + ".part")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        cache_downloaded_model(destination.relative_to(VYACT_MODELS_DIR).as_posix())
        file_size = destination.stat().st_size
        yield file_size, file_size
        return
    url = f"https://huggingface.co/{quote(repo_id, safe='/')}/resolve/main/{quote(filename, safe='/')}"
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30, read=120, write=30, pool=30), follow_redirects=True) as client:
        async with client.stream("GET", url, headers=_headers(token)) as response:
            response.raise_for_status()
            total_bytes = int(response.headers.get("content-length", 0)) or None
            if total_bytes and total_bytes > shutil.disk_usage(destination.parent).free:
                raise OSError("Insufficient disk space for this model")
            downloaded = 0
            with temporary.open("wb") as file:
                async for chunk in response.aiter_bytes(1024 * 1024):
                    file.write(chunk)
                    downloaded += len(chunk)
                    yield downloaded, total_bytes
    temporary.replace(destination)
    cache_downloaded_model(destination.relative_to(VYACT_MODELS_DIR).as_posix())
