import asyncio
import json

from services.stock_analysis.financial_store import get_financials
from services.stock_analysis.symbols import is_market_index


async def build_financial_chat_context(symbol):
    if is_market_index(symbol):
        return ""
    results = await asyncio.gather(
        *(get_financials(symbol, frequency) for frequency in ('yearly', 'quarterly')),
        return_exceptions=True,
    )
    context = []
    for frequency, result in zip(('yearly', 'quarterly'), results):
        if isinstance(result, BaseException):
            context.append(f"Financial statements for {symbol} ({frequency}): unavailable.")
            continue
        statements = {key: rows[:5] for key, rows in result['statements'].items()}
        context.append(f"Financial statements for {symbol} ({frequency}), source: Yahoo Finance, "
                       f"amounts in base currency units, EPS per share: "
                       + json.dumps({'currency': result['currency'], 'checkedAt': result.get('checkedAt'), 'refreshing': result.get('refreshing', False), 'refreshFailed': result.get('refreshFailed', False), 'statements': statements}, ensure_ascii=False, allow_nan=False))
    return "\n".join(context)
