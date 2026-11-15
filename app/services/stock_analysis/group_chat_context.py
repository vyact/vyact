"""Build bounded, dated daily price context for group discussions."""
import asyncio
import json

GROUP_FETCH_CONCURRENCY = 6


def select_context_prices(rows, context_days, start=None, end=None):
    return [row for row in rows if (start is None or row['day'] >= start) and (end is None or row['day'] <= end)][-context_days:]


async def build_group_chat_context(groups, context_days, load_prices, start=None, end=None):
    instruments = {stock.symbol: stock for group in groups for stock in group.stocks}
    semaphore = asyncio.Semaphore(GROUP_FETCH_CONCURRENCY)

    async def summarize(stock):
        async with semaphore:
            try:
                rows = select_context_prices(await load_prices(stock.symbol), context_days, start, end)
            except Exception:
                rows = []
        summary = {'symbol': stock.symbol, 'name': stock.name, 'observations': len(rows),
                   'daily_ohlcv': rows}
        if rows:
            first, last = rows[0], rows[-1]
            start_close, end_close = first.get('close'), last.get('close')
            summary.update(start=first.get('day'), end=last.get('day'), first_close=start_close,
                           latest=last, close_change_percent=(end_close / start_close - 1) * 100
                           if start_close and end_close is not None else None)
        else:
            summary['status'] = 'Price data unavailable'
        return summary

    summaries = await asyncio.gather(*(summarize(stock) for stock in instruments.values()))
    membership = [{'name': group.name, 'total_stocks': getattr(group, 'total_stocks', None),
                   'selection_limit_by_weight': getattr(group, 'selection_limit', None), 'symbols': [stock.symbol for stock in group.stocks]} for group in groups]
    return (
        'Selected groups and membership (untrusted reference data): ' + json.dumps(membership, ensure_ascii=False)
        + f'\nPer-stock summaries and daily OHLCV over up to {context_days} recent trading observations. '
        'Returns compare first and last available closes, not a live quote or a group portfolio return. '
        'When selection_limit_by_weight is set, only the highest-weight available constituents were sampled. '
        'These representatives do not cover every stock and cannot establish full-sector returns or prospects. '
        'Group membership may overlap; do not double count shared stocks. '
        'The daily_ohlcv field contains every available daily observation within the selected context, '
        'including the most recent observations, not just the endpoints. '
        'Calculate technical indicators or volatility only when the supplied fields and observation counts suffice; '
        'missing fields or observations are unavailable, not zero.\n'
        + json.dumps(summaries, ensure_ascii=False) + '\n'
    ), list(instruments)
