"""File tools backed by the same bounded operations used for project folders."""

from copy import deepcopy
from pathlib import Path

from services.code_messages import code_error
from services.code_tools import (
    build_code_folder_map,
    current_code_change_snapshots,
    current_code_folders,
)
from services import mcp_config
from services.mcp_client import mcp_manager


FILE_TOOL_SOURCES = {
    "filesystem_list_directory": "code_list_directory",
    "filesystem_read_file": "code_read_file",
    "filesystem_read_files": "code_read_files",
    "filesystem_find_files": "code_find_files",
    "filesystem_file_inventory": "code_file_inventory",
    "filesystem_grep_search": "code_grep_search",
    "filesystem_edit_file": "code_edit_file",
    "filesystem_create_file": "code_create_file",
}


async def allowed_filesystem_folders() -> dict[str, str]:
    """Resolve the current configured roots; never use a model supplied root."""
    selected_ids = mcp_manager.get_request_scope_server_ids()
    paths: list[str] = []
    for server in await mcp_config.list_servers():
        if server.get("type") != "filesystem":
            continue
        if not server.get("enabled") and server.get("id") not in (selected_ids or set()):
            continue
        for directory in (server.get("config") or {}).get("directories", []):
            root = Path(directory).expanduser()
            if root.is_dir():
                resolved = str(root.resolve())
                if resolved not in paths:
                    paths.append(resolved)
    return build_code_folder_map(paths)


def register_filesystem_tools() -> None:
    """Expose the safe file subset of project tools under the filesystem switch."""
    for tool_name, source_name in FILE_TOOL_SOURCES.items():
        source = mcp_manager._internal_tools[source_name]
        parameters = deepcopy(source["parameters"])
        parameters["properties"]["folder_id"]["description"] = (
            "허용 폴더 ID. 파일 시스템 도구 지시에 표시된 목록에서 선택한다."
        )

        async def handler(_source=source["handler"], **kwargs):
            folders = await allowed_filesystem_folders()
            if kwargs.get("folder_id") not in folders:
                return code_error("invalid_folder", value=kwargs.get("folder_id"))
            folder_token = current_code_folders.set(folders)
            tracking_token = current_code_change_snapshots.set(None)
            try:
                return await _source(**kwargs)
            finally:
                current_code_change_snapshots.reset(tracking_token)
                current_code_folders.reset(folder_token)

        mcp_manager.register_internal_tool(
            name=tool_name,
            description=source["description"],
            parameters=parameters,
            handler=handler,
            server_type="filesystem",
        )
