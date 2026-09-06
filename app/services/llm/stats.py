"""Formatting shared generation statistics for completion logs."""


def format_generation_stats(stats: dict) -> str:
    fields = (
        ("input_tokens", stats.get("prompt_eval_count"), "count"),
        ("output_tokens", stats.get("eval_count"), "count"),
        ("cached_tokens", stats.get("cached_tokens"), "count"),
        ("input_time", stats.get("prompt_eval_duration"), "duration"),
        ("input_speed", stats.get("prompt_tokens_per_second"), "speed"),
        ("generation_speed", stats.get("completion_tokens_per_second"), "speed"),
        ("generation_time", stats.get("eval_duration"), "duration"),
        ("llm_total", stats.get("llm_total_duration") or stats.get("total_duration"), "duration"),
    )
    parts = []
    for name, value, kind in fields:
        if value is None:
            formatted = "n/a"
        elif kind == "duration":
            formatted = f"{value / 1_000_000_000:.2f}s"
        elif kind == "speed":
            formatted = f"{value:.1f}tok/s"
        else:
            formatted = str(value)
        parts.append(f"{name}={formatted}")
    return " ".join(parts)
