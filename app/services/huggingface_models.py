"""Hugging Face GGUF discovery and safe resumeless downloads for Vyact."""
import asyncio
import re
import shutil
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import httpx

from services.vyact_runtime import VYACT_MODELS_DIR, cache_downloaded_model

HF_API_URL = "https://huggingface.co/api"
RECOMMENDED_GGUF_REPOSITORIES = (
    "unsloth/Qwen3.5-4B-GGUF",
    "unsloth/Qwen3.5-9B-GGUF",
    "unsloth/Qwen3.8-27B-GGUF",
)
_REPO_ID_PATTERN = re.compile(r"^[\w.-]+/[\w.-]+$")


def _headers(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def _safe_relative_file_path(filename: str) -> PurePosixPath:
    path = PurePosixPath(filename)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.suffix.lower() != ".gguf":
        raise ValueError("A GGUF filename inside the repository is required")
    return path


async def search_gguf_models(query: str, token: str | None = None, limit: int = 20) -> list[dict]:
    """Search public Hub repositories which declare GGUF as their library."""
    if not query.strip():
        return await get_recommended_gguf_models(token)
    params = {
        "search": query.strip(), "library": "gguf", "limit": max(1, min(limit, 50)),
        "full": "true", "blobs": "true", "sort": "downloads", "direction": "-1",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{HF_API_URL}/models", params=params, headers=_headers(token))
        response.raise_for_status()
    models = [model for item in response.json() if (model := _model_from_hub_item(item))]
    return sorted(models, key=lambda model: model["downloads"], reverse=True)


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
    return {
        "id": repo_id,
        "revision": str(item.get("sha") or "main"),
        "downloads": item.get("downloads", 0),
        "files": gguf_files,
        "file_sizes": file_sizes,
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


async def get_recommended_gguf_models(token: str | None = None) -> list[dict]:
    """Resolve the curated local-model choices while keeping their files current."""
    async with httpx.AsyncClient(timeout=20) as client:
        responses = await asyncio.gather(*(
            client.get(f"{HF_API_URL}/models/{repo_id}", params={"blobs": "true"}, headers=_headers(token))
            for repo_id in RECOMMENDED_GGUF_REPOSITORIES
        ), return_exceptions=True)
    models = []
    for response in responses:
        if isinstance(response, Exception) or not response.is_success:
            continue
        model = _model_from_hub_item(response.json())
        if model:
            models.append(model)
    return sorted(models, key=lambda model: model["downloads"], reverse=True)


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
