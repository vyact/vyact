"""Shared helpers for distributing a bounded text-context budget."""


def allocate_text_content_limits(contents: list[str], total_budget: int) -> list[int]:
    """Distribute a total character budget and reassign unused shares from short texts."""
    if not contents:
        return []

    remaining_budget = max(total_budget, 0)
    remaining_indexes = set(range(len(contents)))
    content_limits: dict[int, int] = {}
    while remaining_indexes:
        fair_share = remaining_budget // len(remaining_indexes)
        completed_indexes = {
            index for index in remaining_indexes
            if len(contents[index]) <= fair_share
        }
        if not completed_indexes:
            ordered_indexes = sorted(remaining_indexes)
            remainder = remaining_budget % len(ordered_indexes)
            for position, index in enumerate(ordered_indexes):
                content_limits[index] = fair_share + (1 if position < remainder else 0)
            break
        for index in completed_indexes:
            content_length = len(contents[index])
            content_limits[index] = content_length
            remaining_budget -= content_length
        remaining_indexes -= completed_indexes

    return [content_limits[index] for index in range(len(contents))]
