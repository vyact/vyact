"""지식 컬렉션에 저장된 외부 소스 참조를 정리하는 공통 기능."""
from datetime import datetime, timezone
from typing import Iterable

from services.db import KNOWLEDGE_COLLECTIONS_INDEX


async def remove_source_references_from_collections(es, source_type: str, source_ids: Iterable[str]) -> int:
    """삭제된 소스를 가리키는 모든 지식 컬렉션 항목을 제거한다."""
    normalized_source_ids = list({source_id for source_id in source_ids if source_id})
    if not normalized_source_ids:
        return 0

    result = await es.update_by_query(
        index=KNOWLEDGE_COLLECTIONS_INDEX,
        body={
            "query": {
                "nested": {
                    "path": "items",
                    "query": {
                        "bool": {
                            "filter": [
                                {"term": {"items.source_type": source_type}},
                                {"terms": {"items.source_id": normalized_source_ids}},
                            ]
                        }
                    },
                }
            },
            "script": {
                "lang": "painless",
                "source": """
                    for (int index = ctx._source.items.size() - 1; index >= 0; index--) {
                        def item = ctx._source.items.get(index);
                        if (item.source_type == params.source_type && params.source_ids.contains(item.source_id)) {
                            ctx._source.items.remove(index);
                        }
                    }
                    ctx._source.updated_at = params.updated_at;
                """,
                "params": {
                    "source_type": source_type,
                    "source_ids": normalized_source_ids,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            },
        },
        conflicts="proceed",
        refresh=True,
    )
    return result.get("updated", 0)
