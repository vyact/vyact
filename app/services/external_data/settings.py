"""Persistent settings for external data connections."""

from services.db import SETTINGS_INDEX, get_es

EXTERNAL_DATA_SETTINGS_DOC_ID = "external_data_connections"


async def load_external_data_connections() -> dict:
    es = get_es()
    try:
        result = await es.get(
            index=SETTINGS_INDEX,
            id=EXTERNAL_DATA_SETTINGS_DOC_ID,
            ignore=[404],
        )
        if not result.get("found"):
            return {}
        value = result["_source"].get("value", {})
        return value if isinstance(value, dict) else {}
    finally:
        await es.close()


async def save_external_data_connections(connections: dict) -> None:
    es = get_es()
    try:
        await es.index(
            index=SETTINGS_INDEX,
            id=EXTERNAL_DATA_SETTINGS_DOC_ID,
            document={"key": EXTERNAL_DATA_SETTINGS_DOC_ID, "value": connections},
            refresh=True,
        )
    finally:
        await es.close()
