"""지식 컬렉션 CRUD — 문서·메모를 복제하지 않고 ID로만 묶는다."""
import uuid
import shutil
from datetime import datetime, timezone

from elasticsearch import NotFoundError
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.db import EMAIL_THREADS_INDEX, FILES_INDEX, KNOWLEDGE_COLLECTIONS_INDEX, MEMO_INDEX, find_document_index, get_es
from config import INSTALL_DIR

router = APIRouter()
KNOWLEDGE_MAIL_IMAGES_DIR = INSTALL_DIR / "uploads" / "knowledge_mail_images"


async def _delete_orphaned_email_thread(es, source_id: str) -> None:
    collections = await es.search(index=KNOWLEDGE_COLLECTIONS_INDEX, size=200, _source=["items"])
    is_referenced = any(
        item.get("source_type") == "email_thread" and item.get("source_id") == source_id
        for hit in collections["hits"]["hits"]
        for item in hit["_source"].get("items", [])
    )
    if is_referenced:
        return
    try:
        index = await find_document_index(es, EMAIL_THREADS_INDEX, source_id)
        if index:
            await es.delete(index=index, id=source_id, refresh=True)
    except NotFoundError:
        pass
    image_dir = KNOWLEDGE_MAIL_IMAGES_DIR / source_id
    if image_dir.is_dir():
        shutil.rmtree(image_dir)


class KnowledgeCollectionItem(BaseModel):
    source_type: str = Field(pattern="^(document|memo|email_thread)$")
    source_id: str = Field(min_length=1, max_length=512)


class KnowledgeCollectionBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    instruction: str = Field(default="", max_length=4000)
    items: list[KnowledgeCollectionItem] = Field(default_factory=list)


class KnowledgeCollectionOrderBody(BaseModel):
    collection_ids: list[str] = Field(min_length=1, max_length=200)


def _normalized_items(items: list[KnowledgeCollectionItem]) -> list[dict]:
    unique_items: dict[tuple[str, str], dict] = {}
    for item in items:
        source_id = item.source_id.strip()
        if source_id:
            unique_items[(item.source_type, source_id)] = {"source_type": item.source_type, "source_id": source_id}
    return list(unique_items.values())


async def _validate_members(es, items: list[dict]) -> None:
    document_ids = [item["source_id"] for item in items if item["source_type"] == "document"]
    memo_ids = [item["source_id"] for item in items if item["source_type"] == "memo"]
    email_thread_ids = [item["source_id"] for item in items if item["source_type"] == "email_thread"]
    if document_ids:
        found = await es.mget(index=FILES_INDEX, ids=document_ids)
        missing = [item_id for item_id, item in zip(document_ids, found["docs"]) if not item.get("found")]
        if missing:
            raise HTTPException(status_code=400, detail="존재하지 않는 문서가 포함되어 있습니다.")
    if memo_ids:
        found = await es.search(index=MEMO_INDEX, size=len(memo_ids), query={"ids": {"values": memo_ids}}, _source=False)
        found_ids = {hit["_id"] for hit in found["hits"]["hits"]}
        missing = [item_id for item_id in memo_ids if item_id not in found_ids]
        if missing:
            raise HTTPException(status_code=400, detail="존재하지 않는 메모가 포함되어 있습니다.")
    if email_thread_ids:
        found = await es.search(index=EMAIL_THREADS_INDEX, size=len(email_thread_ids), query={"ids": {"values": email_thread_ids}}, _source=False)
        found_ids = {hit["_id"] for hit in found["hits"]["hits"]}
        missing = [item_id for item_id in email_thread_ids if item_id not in found_ids]
        if missing:
            raise HTTPException(status_code=400, detail="존재하지 않는 이메일 스레드가 포함되어 있습니다.")


@router.get("/knowledge-collections")
async def list_knowledge_collections():
    es = get_es()
    try:
        response = await es.search(index=KNOWLEDGE_COLLECTIONS_INDEX, size=200, sort=[{"sort_order": {"order": "asc", "missing": "_last"}}, {"updated_at": {"order": "desc"}}])
        return {"collections": [{**hit["_source"], "id": hit["_id"]} for hit in response["hits"]["hits"]]}
    finally:
        await es.close()


@router.post("/knowledge-collections")
async def create_knowledge_collection(body: KnowledgeCollectionBody):
    es = get_es()
    try:
        items = _normalized_items(body.items)
        await _validate_members(es, items)
        now = datetime.now(timezone.utc).isoformat()
        collection_id = str(uuid.uuid4())
        existing_collections = await es.search(index=KNOWLEDGE_COLLECTIONS_INDEX, size=1, sort=[{"sort_order": {"order": "asc", "missing": "_last"}}], _source=["sort_order"])
        first_collection = existing_collections["hits"]["hits"]
        sort_order = first_collection[0]["_source"].get("sort_order", 0) - 1 if first_collection else 0
        document = {"id": collection_id, "name": body.name.strip(), "description": body.description.strip(),
                    "instruction": body.instruction.strip(), "items": items,
                    "created_at": now, "updated_at": now, "sort_order": sort_order}
        await es.index(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id, document=document, refresh=True)
        return document
    finally:
        await es.close()


@router.put("/knowledge-collections/order")
async def reorder_knowledge_collections(body: KnowledgeCollectionOrderBody):
    es = get_es()
    try:
        collection_ids = body.collection_ids
        if len(collection_ids) != len(set(collection_ids)):
            raise HTTPException(status_code=400, detail="중복된 지식 컬렉션 ID가 포함되어 있습니다.")
        response = await es.mget(index=KNOWLEDGE_COLLECTIONS_INDEX, ids=collection_ids)
        if any(not collection.get("found") for collection in response["docs"]):
            raise HTTPException(status_code=404, detail="지식 컬렉션을 찾을 수 없습니다.")
        operations = []
        for index, collection_id in enumerate(collection_ids):
            operations.extend([{"update": {"_index": KNOWLEDGE_COLLECTIONS_INDEX, "_id": collection_id}}, {"doc": {"sort_order": index}}])
        await es.bulk(operations=operations, refresh=True)
        return {"ok": True}
    finally:
        await es.close()


@router.patch("/knowledge-collections/{collection_id}")
async def update_knowledge_collection(collection_id: str, body: KnowledgeCollectionBody):
    es = get_es()
    try:
        existing = await es.get(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id)
        items = _normalized_items(body.items)
        await _validate_members(es, items)
        document = {"name": body.name.strip(), "description": body.description.strip(), "instruction": body.instruction.strip(),
                    "items": items, "updated_at": datetime.now(timezone.utc).isoformat()}
        await es.update(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id, doc=document, refresh=True)
        previous_email_ids = {
            item.get("source_id")
            for item in existing["_source"].get("items", [])
            if item.get("source_type") == "email_thread" and item.get("source_id")
        }
        current_email_ids = {
            item["source_id"]
            for item in items
            if item["source_type"] == "email_thread"
        }
        for source_id in previous_email_ids - current_email_ids:
            await _delete_orphaned_email_thread(es, source_id)
        result = await es.get(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id)
        return {**result["_source"], "id": result["_id"]}
    except NotFoundError:
        raise HTTPException(status_code=404, detail="지식 컬렉션을 찾을 수 없습니다.")
    finally:
        await es.close()


@router.get("/knowledge-collections/{collection_id}/items")
async def get_knowledge_collection_items(collection_id: str):
    """컬렉션 항목을 실제 소스 메타데이터와 함께 반환한다."""
    es = get_es()
    try:
        collection = await es.get(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id)
        items = collection["_source"].get("items", [])
        index_by_type = {"document": FILES_INDEX, "memo": MEMO_INDEX, "email_thread": EMAIL_THREADS_INDEX}
        resolved_items = []
        for item in items:
            source_type, source_id = item.get("source_type"), item.get("source_id")
            index_name = index_by_type.get(source_type)
            if not index_name or not source_id:
                continue
            try:
                resolved_index = index_name if source_type == "document" else await find_document_index(es, index_name, source_id)
                if not resolved_index:
                    continue
                result = await es.get(index=resolved_index, id=source_id)
            except NotFoundError:
                continue
            source = result["_source"]
            if source_type == "document":
                resolved_items.append({"source_type": source_type, "source_id": source_id, "title": source.get("filename", ""), "summary": source.get("file_ext", ""), "updated_at": source.get("indexed_at", ""), "chunk_count": source.get("chunk_count", 0)})
            elif source_type == "memo":
                resolved_items.append({"source_type": source_type, "source_id": source_id, "title": source.get("title", ""), "summary": source.get("content", "")[:300], "updated_at": source.get("updated_at", ""), "content_html": source.get("content_html", "")})
            else:
                content = source.get("content", "")
                display_messages = source.get("display_messages", [])
                resolved_items.append({"source_type": source_type, "source_id": source_id, "title": source.get("title", ""), "summary": content[:300], "updated_at": source.get("updated_at", source.get("indexed_at", "")), "content": content, "messages": display_messages, "message_count": source.get("message_count", 0)})
        return {"items": resolved_items}
    except NotFoundError:
        raise HTTPException(status_code=404, detail="지식 컬렉션을 찾을 수 없습니다.")
    finally:
        await es.close()


@router.delete("/knowledge-collections/{collection_id}/items/{source_type}/{source_id}")
async def remove_knowledge_collection_item(collection_id: str, source_type: str, source_id: str):
    """컬렉션의 참조를 제거한다. 고아가 된 메일 인덱스와 이미지는 함께 정리한다."""
    es = get_es()
    try:
        collection = await es.get(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id)
        items = collection["_source"].get("items", [])
        remaining_items = [item for item in items if not (item.get("source_type") == source_type and item.get("source_id") == source_id)]
        if len(remaining_items) != len(items):
            await es.update(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id, doc={"items": remaining_items, "updated_at": datetime.now(timezone.utc).isoformat()}, refresh=True)
            if source_type == "email_thread":
                await _delete_orphaned_email_thread(es, source_id)
        return {"ok": True, "items": remaining_items}
    except NotFoundError:
        raise HTTPException(status_code=404, detail="지식 컬렉션을 찾을 수 없습니다.")
    finally:
        await es.close()


@router.delete("/knowledge-collections/{collection_id}")
async def delete_knowledge_collection(collection_id: str):
    es = get_es()
    try:
        collection = await es.get(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id)
        email_thread_ids = [
            item.get("source_id", "")
            for item in collection["_source"].get("items", [])
            if item.get("source_type") == "email_thread"
        ]
        await es.delete(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id, refresh=True)
        for source_id in email_thread_ids:
            await _delete_orphaned_email_thread(es, source_id)
        return {"ok": True}
    except NotFoundError:
        raise HTTPException(status_code=404, detail="지식 컬렉션을 찾을 수 없습니다.")
    finally:
        await es.close()
