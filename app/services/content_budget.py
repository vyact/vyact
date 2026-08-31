"""Shared helpers for distributing a bounded content budget."""


def allocate_content_limits(content_sizes: list[int], total_budget: int) -> list[int]:
    """Distribute a budget fairly and reassign shares unused by small items."""
    if not content_sizes:
        return []

    normalized_sizes = [max(int(size), 0) for size in content_sizes]
    remaining_budget = max(int(total_budget), 0)
    remaining_indexes = set(range(len(normalized_sizes)))
    content_limits: dict[int, int] = {}
    while remaining_indexes:
        fair_share = remaining_budget // len(remaining_indexes)
        completed_indexes = {
            index for index in remaining_indexes
            if normalized_sizes[index] <= fair_share
        }
        if not completed_indexes:
            ordered_indexes = sorted(remaining_indexes)
            remainder = remaining_budget % len(ordered_indexes)
            for position, index in enumerate(ordered_indexes):
                content_limits[index] = fair_share + (1 if position < remainder else 0)
            break
        for index in completed_indexes:
            content_size = normalized_sizes[index]
            content_limits[index] = content_size
            remaining_budget -= content_size
        remaining_indexes -= completed_indexes

    return [content_limits[index] for index in range(len(normalized_sizes))]


def allocate_text_content_limits(contents: list[str], total_budget: int) -> list[int]:
    """Distribute a total character budget and reassign unused shares from short texts."""
    return allocate_content_limits([len(content) for content in contents], total_budget)
