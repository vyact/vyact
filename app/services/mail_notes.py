"""Account-scoped mail notes persisted in Elasticsearch."""
import hashlib
from datetime import datetime, timezone

from fastapi import HTTPException
from pydantic import BaseModel, Field
from services.db import GOOGLE_WORKSPACE_SETTINGS_INDEX, get_es

MAX_NOTE_LENGTH = 20000

class MailNotesQuery(BaseModel):
    ids: list[str] = Field(max_length=200)

class MailNoteRequest(BaseModel):
    id: str = Field(min_length=1, max_length=2048)
    content: str = Field(max_length=MAX_NOTE_LENGTH)

def document_id(account_key: str, mail_id: str) -> str:
    return 'mail_note:' + hashlib.sha256(f'{account_key}:{mail_id}'.encode()).hexdigest()

async def read_notes(account_key: str, request: MailNotesQuery) -> dict:
    if not request.ids:
        return {'notes': {}}
    es = get_es()
    try:
        result = await es.mget(index=GOOGLE_WORKSPACE_SETTINGS_INDEX,
                               ids=[document_id(account_key, item) for item in request.ids])
        if any('error' in doc for doc in result['docs']):
            raise HTTPException(503, 'Mail note storage unavailable')
        return {'notes': {item: doc['_source']['value'] for item, doc in zip(request.ids, result['docs']) if doc.get('found')}}
    finally:
        await es.close()

async def save_note(account_key: str, request: MailNoteRequest) -> dict:
    es = get_es()
    key = document_id(account_key, request.id)
    value = {'content': request.content.strip(), 'updated_at': datetime.now(timezone.utc).isoformat()}
    try:
        if value['content']:
            await es.index(index=GOOGLE_WORKSPACE_SETTINGS_INDEX, id=key,
                           document={'key': key, 'value': value}, refresh=True)
        elif await es.exists(index=GOOGLE_WORKSPACE_SETTINGS_INDEX, id=key):
            await es.delete(index=GOOGLE_WORKSPACE_SETTINGS_INDEX, id=key, refresh=True)
        return value
    finally:
        await es.close()
