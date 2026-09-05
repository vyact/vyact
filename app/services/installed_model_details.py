"""Read installed model details locally without contacting model repositories."""
import json
import logging

from services.mlx_runtime import get_downloaded_mlx_model_path
from services.vyact_runtime import get_downloaded_model_path
from services.reasoning_capabilities import read_gguf_metadata

logger = logging.getLogger(__name__)


def get_installed_model_details(model_paths: list[str]) -> dict:
    details = {}
    for model_path in model_paths:
        try:
            if model_path.startswith("mlx/"):
                path = get_downloaded_mlx_model_path(model_path)
                config = json.loads((path / "config.json").read_text(encoding="utf-8"))
                text_config = config.get("text_config")
                source = {**config, **(text_config if isinstance(text_config, dict) else {})}
                architectures = source.get("architectures") or config.get("architectures") or []
                architecture = architectures[0] if architectures else ""
                layers = next((source[key] for key in ("num_hidden_layers", "num_layers", "n_layer") if source.get(key)), 0)
                context = next((source[key] for key in ("max_position_embeddings", "model_max_length", "max_seq_len", "max_sequence_length") if source.get(key)), 0)
                size = sum(file.stat().st_size for file in path.rglob("*") if file.is_file())
            else:
                path = get_downloaded_model_path(model_path)
                architecture = read_gguf_metadata(path, {"general.architecture"}).get("general.architecture", "")
                source = read_gguf_metadata(path, {f"{architecture}.block_count", f"{architecture}.context_length"})
                layers = source.get(f"{architecture}.block_count", 0)
                context = source.get(f"{architecture}.context_length", 0)
                size = path.stat().st_size
            details[model_path] = {
                "fileSize": size,
                "metadata": {"architecture": architecture, "blockCount": layers, "contextLength": context},
            }
        except (OSError, ValueError, TypeError, KeyError):
            logger.warning("Unable to read installed model details: %s", model_path, exc_info=True)
    return details
