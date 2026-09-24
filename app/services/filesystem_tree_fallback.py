"""Recover a partial filesystem MCP tree when one child directory is inaccessible."""

import fnmatch
import json
import os

from logger import get_logger

logger = get_logger(__name__)
MAX_TREE_ENTRIES = 500


def _excluded(relative_path: str, name: str, patterns: list[str]) -> bool:
    for pattern in patterns:
        if "*" in pattern:
            if pattern.startswith("**/") and fnmatch.fnmatchcase(relative_path, pattern[3:]):
                return True
            if "/" not in pattern:
                if "/" not in relative_path and fnmatch.fnmatchcase(name, pattern):
                    return True
            elif fnmatch.fnmatchcase(relative_path, pattern):
                return True
        elif pattern in relative_path.split("/") or relative_path == pattern:
            return True
    return False


async def recover_directory_tree(session, root_path: str, exclude_patterns: list[str]) -> str | None:
    """Ask the existing MCP server to validate and list each directory separately.

    A root failure remains an error. A child failure is marked unavailable while
    sibling directories remain in the result. No direct filesystem access occurs.
    """
    entry_count = 0

    async def walk(directory: str, relative_directory: str, *, root: bool = False) -> list[dict] | None:
        nonlocal entry_count
        try:
            result = await session.call_tool("list_directory", {"path": directory})
        except Exception as error:
            logger.warning("[filesystem] Cannot list directory %s: %s", directory, error)
            return None
        if getattr(result, "isError", False):
            if not root:
                logger.warning("[filesystem] Skipping inaccessible directory: %s", directory)
            return None

        content = "\n".join(
            str(getattr(block, "text", ""))
            for block in getattr(result, "content", []) or []
            if getattr(block, "type", None) == "text"
        )
        children: list[dict] = []
        for line in content.splitlines():
            if line.startswith("[DIR] "):
                entry_type, name = "directory", line[6:]
            elif line.startswith("[FILE] "):
                entry_type, name = "file", line[7:]
            else:
                return None
            if not name or name in {".", ".."}:
                return None
            relative_path = f"{relative_directory}/{name}" if relative_directory else name
            if _excluded(relative_path.replace(os.sep, "/"), name, exclude_patterns):
                continue
            entry_count += 1
            if entry_count > MAX_TREE_ENTRIES:
                children.append({"name": "...", "type": "truncated"})
                break
            entry = {"name": name, "type": entry_type}
            if entry_type == "directory":
                nested = await walk(os.path.join(directory, name), relative_path)
                entry["children"] = nested if nested is not None else []
                if nested is None:
                    entry["unavailable"] = True
            children.append(entry)
        return children

    recovered = await walk(root_path, "", root=True)
    return json.dumps(recovered, ensure_ascii=False, indent=2) if recovered is not None else None
