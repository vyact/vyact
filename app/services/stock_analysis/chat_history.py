import re
from datetime import datetime, timezone

from elasticsearch import BadRequestError

from services.db import get_es
from services.stock_analysis.symbols import public_symbol

STOCK_CONVERSATIONS_INDEX = 'stock_analysis_conversations'


def conversation_scope(symbol):
    legacy = re.fullmatch(r'G-(KR|US|JP|TW|HK|CN)-[0-9a-f]+', symbol)
    return f'MARKET-{legacy[1]}' if legacy else public_symbol(symbol)


def scope_query(symbol):
    scope = conversation_scope(symbol)
    if re.fullmatch(r'MARKET-(KR|US|JP|TW|HK|CN)', scope):
        return {'bool': {'should': [{'term': {'symbol': scope}},
                                    {'prefix': {'symbol': f'G-{scope[7:]}-'}}], 'minimum_should_match': 1}}
    return {'term': {'symbol': scope}}



async def ensure_chat_index(es):
    if await es.indices.exists(index=STOCK_CONVERSATIONS_INDEX):
        return
    try:
        await es.indices.create(index=STOCK_CONVERSATIONS_INDEX, settings={'number_of_shards': 1, 'number_of_replicas': 0}, mappings={'dynamic': 'strict', 'properties': {
            'symbol': {'type': 'keyword'}, 'title': {'type': 'text', 'index': False},
            'updated_at': {'type': 'date'}, 'messages': {'type': 'object', 'enabled': False},
        }})
    except BadRequestError as error:
        if error.error != 'resource_already_exists_exception':
            raise


async def list_stock_conversations(symbol):
    es = get_es()
    await ensure_chat_index(es)
    result = await es.search(index=STOCK_CONVERSATIONS_INDEX, query=scope_query(symbol),
                             sort=[{'updated_at': 'desc'}], size=100, source_excludes=['messages'])
    return [{'id': hit['_id'], **hit['_source']} for hit in result['hits']['hits']]


async def get_stock_conversation(symbol, conversation_id):
    es = get_es()
    await ensure_chat_index(es)
    result = await es.get(index=STOCK_CONVERSATIONS_INDEX, id=conversation_id)
    if conversation_scope(result['_source']['symbol']) != conversation_scope(symbol):
        return None
    return {'id': result['_id'], **result['_source']}


async def append_stock_conversation(symbol, conversation_id, question, answer, question_timestamp=None, stats=None, model=None, attachments=None):
    es = get_es()
    await ensure_chat_index(es)
    symbol = conversation_scope(symbol)
    legacy_prefix = f'G-{symbol[7:]}-' if symbol.startswith('MARKET-') else None
    now = datetime.now(timezone.utc).isoformat()
    messages = [{'role': 'user', 'content': question, 'timestamp': question_timestamp or now},
                {'role': 'assistant', 'content': answer, 'timestamp': now}]
    if attachments:
        messages[0]['attachments'] = attachments
    if stats is not None:
        for message in messages:
            message['stats'] = stats
    if model:
        messages[-1]['model'] = model
    await es.update(index=STOCK_CONVERSATIONS_INDEX, id=conversation_id, refresh='wait_for', retry_on_conflict=3,
                    script={'lang': 'painless', 'source': '''
                        if (ctx._source.symbol != params.symbol && (params.legacy_prefix == null || !ctx._source.symbol.startsWith(params.legacy_prefix))) { throw new IllegalArgumentException('symbol_mismatch'); }
                        ctx._source.symbol = params.symbol;
                        ctx._source.messages.addAll(params.messages);
                        ctx._source.updated_at = params.now;
                    ''', 'params': {'symbol': symbol, 'legacy_prefix': legacy_prefix, 'messages': messages, 'now': now}},
                    upsert={'symbol': symbol, 'title': question[:100], 'updated_at': now, 'messages': messages})
