"""Concise model-facing descriptions for the built-in Keenable tools."""

_SESSION_ID = "Reuse the same ID across requests in one agent session to group them."
_OUTPUT_FORMAT = "Readable text (default) or raw JSON for programmatic parsing."

_TOOL_DESCRIPTIONS = {
    "search_web_pages": (
        "Search the live web for current information. Returns ranked titles, URLs, citable snippets, "
        "and publication dates when available. Use fetch_page_content for full pages. "
        'Example: {"query":"release notes for the latest Node.js LTS","published_after":"30d"}. '
        'Date filters accept YYYY-MM-DD, ISO 8601 timestamps, or offsets such as "30min", "2h", "7d", "1mo", "1y".'
    ),
    "fetch_page_content": (
        "Fetch a web page as clean Markdown with title, URL, and publication date when known. "
        "Use prompt to extract specific information from long pages."
    ),
}

_PARAMETER_DESCRIPTIONS = {
    "search_web_pages": {
        "query": 'Describe the ideal page in natural language, e.g. "blog post comparing React and Vue performance".',
        "site": 'Limit results to one site, e.g. "techcrunch.com".',
        "exclude_domains": (
            'Exclude up to 1,000 hosts and their subdomains. Use host names or a leading-dot suffix such as ".gov"; '
            "omit paths and wildcards."
        ),
        "acquired_after": "Include pages indexed by Keenable after this date or offset.",
        "acquired_before": "Include pages indexed by Keenable before this date or offset.",
        "published_after": 'Lower publication-time bound. Use "7d" for pages published in the last 7 days.',
        "published_before": "Upper publication-time bound.",
        "query_time": (
            'Upper time bound for an as-of search. "7d" means as of 7 days ago; use published_after for the last 7 days. '
            "Also accepts a Unix epoch. Omit for normal search."
        ),
        "snippet_max_length": "Maximum snippet characters per result. Omit to use the server default.",
        "max_results": "Maximum results. Defaults to 10.",
        "objective": (
            "Optional, at most 1,000 characters. In 2–3 standalone sentences on one line without labels, "
            "name the facts and entities needed, relevant context, acceptable or excluded sources, and what is "
            "known or missing. Avoid references to earlier messages, pasted conversation, and sensitive data."
        ),
        "disable_cards": "Omit cards from search results.",
    },
    "fetch_page_content": {
        "url": 'Page URL, e.g. "https://example.com".',
        "max_chars": "Cap returned content characters. Defaults to 20,000. Reports the original length when truncated.",
        "live": "Fetch the live source for frequently updated or unindexed pages. Defaults to the indexed copy.",
        "prompt": (
            'Instruction for extracting information from this page. Returns only the extracted answer, '
            'e.g. "List pricing tiers and monthly prices".'
        ),
    },
}


def compact_keenable_tool(name: str, description: str, schema: dict) -> tuple[str, dict]:
    parameter_descriptions = _PARAMETER_DESCRIPTIONS.get(name)
    properties = schema.get("properties")
    if parameter_descriptions is None or not isinstance(properties, dict) or not properties:
        return description, schema

    descriptions = {**parameter_descriptions, "session_id": _SESSION_ID, "output_format": _OUTPUT_FORMAT}
    return _TOOL_DESCRIPTIONS[name], {
        **schema,
        "properties": {
            key: {**value, "description": descriptions[key]}
            if key in descriptions and isinstance(value, dict) and "description" in value else value
            for key, value in properties.items()
        },
    }
