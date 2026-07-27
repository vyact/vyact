"""
history.py – 대화 히스토리 CRUD
"""
from datetime import datetime, timezone

from elasticsearch import NotFoundError

from services.db import HIST_INDEX, get_es


async def create_conversation_stub(conv_id: str, title: str, project_id: str | None = None) -> None:
    """새 대화방 첫 응답 시, 무거운 메시지 저장(save_conversation)을 백그라운드로 미루기 전에
    사이드바 목록(GET /api/history)에서 바로 조회 가능하도록 최소 필드만 담아 먼저 색인한다.
    이후 _save_history_bg의 save_conversation이 messages를 포함한 전체 문서로 덮어쓴다.
    (save_conversation은 기존 문서의 created_at을 이어받으므로 순서가 바뀌어도 안전)
    """
    es = get_es()
    try:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        await es.index(
            index=HIST_INDEX,
            id=conv_id,
            document={
                "conv_id": conv_id,
                "title": title,
                "messages": [],
                "created_at": now,
                "updated_at": now,
                **({"project_id": project_id} if project_id else {}),
            },
            refresh=True,
        )
    finally:
        await es.close()


async def save_conversation(conv_id: str, messages: list[dict], title: str = "", project_id: str | None = None) -> str:
    es = get_es()
    try:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        # conv_summary/attachment_summaries는 messages와 별개 필드라, es.index()가 문서를
        # 통째로 교체하기 전에 기존 값을 읽어와 같이 실어보내야 한다. 안 그러면 이 필드들이
        # 없는 턴(예: 파일 재첨부 없는 후속 질문)마다 이전 값이 사라진다.
        created_at = now
        conv_summary = None
        attachment_summaries = None
        existing_project_id = None
        existing_title = None
        try:
            existing = await es.get(index=HIST_INDEX, id=conv_id)
            created_at = existing["_source"]["created_at"]
            existing_title = existing["_source"].get("title")
            conv_summary = existing["_source"].get("conv_summary")
            attachment_summaries = existing["_source"].get("attachment_summaries")
            existing_project_id = existing["_source"].get("project_id")
        except NotFoundError:
            pass
        # title 우선순위: 명시적 전달 > 기존 제목(사용자 rename 포함) > 자동 생성
        if not title:
            if existing_title:
                title = existing_title
            else:
                first = next((m["content"] for m in messages if m["role"] == "user"), "대화")
                title = first[:30] + ("..." if len(first) > 30 else "")
        document = {
            "conv_id": conv_id,
            "title": title,
            "messages": messages,
            "created_at": created_at,
            "updated_at": now,
        }
        if conv_summary is not None:
            document["conv_summary"] = conv_summary
        if attachment_summaries is not None:
            document["attachment_summaries"] = attachment_summaries
        if project_id or existing_project_id:
            document["project_id"] = existing_project_id or project_id
        await es.index(
            index=HIST_INDEX,
            id=conv_id,
            document=document,
            refresh=True,
        )
        return conv_id
    finally:
        await es.close()


async def list_conversations(
    size: int = 50, offset: int = 0, project_id: str | None = None,
    exclude_project: bool = False,
) -> dict:
    """대화 목록을 페이징으로 반환. {conversations, total} 형태."""
    es = get_es()
    try:
        res = await es.search(index=HIST_INDEX, body={
            "query": (
                {"term": {"project_id.keyword": project_id}}
                if project_id else {"bool": {"must_not": {"exists": {"field": "project_id"}}}}
                if exclude_project else {"match_all": {}}
            ),
            "sort": [{"updated_at": {"order": "desc"}}],
            "from": offset,
            "size": size,
            "track_total_hits": True,
            "_source": ["conv_id", "title", "updated_at", "created_at", "project_id", "conv_summary"],
        })
        total_raw = res["hits"].get("total", 0)
        total = total_raw.get("value", 0) if isinstance(total_raw, dict) else total_raw
        return {
            "conversations": [{
                "conv_id": h["_source"]["conv_id"],
                "title": h["_source"]["title"],
                "updated_at": h["_source"]["updated_at"],
                "project_id": h["_source"].get("project_id"),
                "has_summary": bool(h["_source"].get("conv_summary")),
            } for h in res["hits"]["hits"]],
            "total": total,
        }
    except Exception:
        return {"conversations": [], "total": 0}
    finally:
        await es.close()


async def get_conversation(conv_id: str) -> dict | None:
    es = get_es()
    try:
        res = await es.get(index=HIST_INDEX, id=conv_id)
        return res["_source"]
    except NotFoundError:
        return None
    finally:
        await es.close()


async def delete_conversation(conv_id: str):
    es = get_es()
    try:
        # PDF 파일 연관 삭제
        try:
            res = await es.get(index=HIST_INDEX, id=conv_id)
            messages = res["_source"].get("messages", [])
            _delete_conv_files(messages)
        except Exception:
            pass

        # 채팅 첨부(zip/파일) 청크 삭제 — conv_id 종속 인덱스라 방과 같이 정리
        try:
            from services.chat_file_index import delete_chat_files_for_conv
            await delete_chat_files_for_conv(conv_id)
        except Exception:
            pass

        await es.delete(index=HIST_INDEX, id=conv_id, ignore=[404], refresh=True)
    finally:
        await es.close()


def _delete_conv_files(messages: list[dict]):
    """대화 메시지에서 pdf_file 및 업로드 첨부파일을 찾아 삭제."""
    from pathlib import Path
    from config import INSTALL_DIR

    files_dir = INSTALL_DIR / "temp"
    upload_dirs = [
        INSTALL_DIR / "uploads" / "files",
        INSTALL_DIR / "uploads" / "images",
    ]

    for msg in messages:
        # 생성된 PDF 파일 삭제
        pdf_file = msg.get("pdf_file")
        if pdf_file:
            try:
                (files_dir / Path(pdf_file).name).unlink(missing_ok=True)
            except Exception:
                pass

        # 업로드 첨부파일 삭제 (saved_name 또는 filename 기준)
        for att in (msg.get("attachments") or []):
            fname = att.get("saved_name") or att.get("filename")
            if not fname:
                continue
            for d in upload_dirs:
                p = d / fname
                try:
                    p.unlink(missing_ok=True)
                except Exception:
                    pass


async def clear_conversation_messages(conv_id: str):
    """방과 제목은 유지하고 messages만 비운다."""
    es = get_es()
    try:
        existing = await es.get(index=HIST_INDEX, id=conv_id)
        messages = existing["_source"].get("messages", [])
        _delete_conv_files(messages)

        # 채팅 첨부 청크 삭제
        try:
            from services.chat_file_index import delete_chat_files_for_conv
            await delete_chat_files_for_conv(conv_id)
        except Exception:
            pass

        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        await es.update(
            index=HIST_INDEX,
            id=conv_id,
            body={"doc": {
                "messages": [],
                "updated_at": now,
                "conv_summary": "",
                "attachment_summaries": [],
            }},
            refresh=True,
        )
    except NotFoundError:
        pass
    finally:
        await es.close()


async def rename_conversation(conv_id: str, title: str):
    es = get_es()
    try:
        await es.update(
            index=HIST_INDEX,
            id=conv_id,
            body={"doc": {"title": title}},
            refresh=True,
        )
    finally:
        await es.close()


async def set_conversation_project(conv_id: str, project_id: str | None):
    es = get_es()
    try:
        await es.update(index=HIST_INDEX, id=conv_id, body={"doc": {"project_id": project_id}, "doc_as_upsert": False}, refresh=True)
    except NotFoundError:
        pass
    finally:
        await es.close()


async def delete_all_conversations():
    es = get_es()
    try:
        # 모든 대화의 PDF 파일 먼저 삭제
        try:
            res = await es.search(index=HIST_INDEX, body={
                "query": {"match_all": {}},
                "size": 1000,
                "_source": ["messages"],
            })
            for hit in res["hits"]["hits"]:
                _delete_conv_files(hit["_source"].get("messages", []))
        except Exception:
            pass

        # 채팅 첨부 청크 인덱스도 전부 비움 (대화 전체 삭제이므로 conv_id 필터 불필요)
        try:
            from services.db import CHAT_FILE_CHUNKS_INDEX
            await es.delete_by_query(
                index=CHAT_FILE_CHUNKS_INDEX,
                body={"query": {"match_all": {}}},
                refresh=True,
            )
        except Exception:
            pass

        await es.delete_by_query(
            index=HIST_INDEX,
            body={"query": {"match_all": {}}},
            refresh=True,
        )
    finally:
        await es.close()
