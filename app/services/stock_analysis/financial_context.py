import asyncio
import json

from services.stock_analysis.financial_store import get_financials
from services.stock_analysis.symbols import is_market_index


async def build_financial_chat_context(symbol, *, with_status=False):
    if is_market_index(symbol):
        return ("", True) if with_status else ""
    results = await asyncio.gather(
        *(get_financials(symbol, frequency) for frequency in ('yearly', 'quarterly')),
        return_exceptions=True,
    )
    context = []
    available = True
    for frequency, result in zip(('yearly', 'quarterly'), results):
        if isinstance(result, BaseException):
            available = False
            context.append(f"Financial statements for {symbol} ({frequency}): unavailable.")
            continue
        statements = {key: rows[:5] for key, rows in result['statements'].items()}
        if not any(statements.values()):
            available = False
        context.append(f"Financial statements for {symbol} ({frequency}), source: Yahoo Finance, "
                       f"amounts in base currency units, EPS per share: "
                       + json.dumps({'currency': result['currency'], 'checkedAt': result.get('checkedAt'), 'refreshing': result.get('refreshing', False), 'refreshFailed': result.get('refreshFailed', False), 'statements': statements}, ensure_ascii=False, allow_nan=False))
    text = "\n".join(context)
    return (text, available) if with_status else text
