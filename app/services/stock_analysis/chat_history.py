from datetime import datetime, timezone

from elasticsearch import BadRequestError

from services.db import get_es
from services.stock_analysis.symbols import public_symbol

STOCK_CONVERSATIONS_INDEX = 'stock_analysis_conversations'


async def ensure_chat_index(es):
    if await es.indices.exists(index=STOCK_CONVERSATIONS_INDEX):
        return
    try:
        await es.indices.create(index=STOCK_CONVERSATIONS_INDEX, mappings={'dynamic': 'strict', 'properties': {
            'symbol': {'type': 'keyword'}, 'title': {'type': 'text', 'index': False},
            'updated_at': {'type': 'date'}, 'messages': {'type': 'object', 'enabled': False},
        }})
    except BadRequestError as error:
        if error.error != 'resource_already_exists_exception':
            raise


async def list_stock_conversations(symbol):
    es = get_es()
    await ensure_chat_index(es)
    result = await es.search(index=STOCK_CONVERSATIONS_INDEX, query={'term': {'symbol': public_symbol(symbol)}},
                             sort=[{'updated_at': 'desc'}], size=100, source_excludes=['messages'])
    return [{'id': hit['_id'], **hit['_source']} for hit in result['hits']['hits']]


async def get_stock_conversation(symbol, conversation_id):
    es = get_es()
    await ensure_chat_index(es)
    result = await es.get(index=STOCK_CONVERSATIONS_INDEX, id=conversation_id)
    if result['_source']['symbol'] != public_symbol(symbol):
        return None
    return {'id': result['_id'], **result['_source']}


async def append_stock_conversation(symbol, conversation_id, question, answer):
    es = get_es()
    await ensure_chat_index(es)
    symbol = public_symbol(symbol)
    messages = [{'role': 'user', 'content': question}, {'role': 'assistant', 'content': answer}]
    now = datetime.now(timezone.utc).isoformat()
    await es.update(index=STOCK_CONVERSATIONS_INDEX, id=conversation_id, refresh='wait_for', retry_on_conflict=3,
                    script={'lang': 'painless', 'source': '''
                        if (ctx._source.symbol != params.symbol) { throw new IllegalArgumentException('symbol_mismatch'); }
                        ctx._source.messages.addAll(params.messages);
                        ctx._source.updated_at = params.now;
                    ''', 'params': {'symbol': symbol, 'messages': messages, 'now': now}},
                    upsert={'symbol': symbol, 'title': question[:100], 'updated_at': now, 'messages': messages})
