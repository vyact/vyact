from functools import lru_cache
from time import time
from urllib.parse import urlparse

import yfinance as yf

from services.stock_analysis.symbols import yahoo_symbol

NEWS_CACHE_SECONDS = 300
NEWS_LIMIT = 30


def normalize_news(articles):
    rows = []
    seen = set()
    for article in articles:
        content = article.get('content') or {}
        title = content.get('title')
        url = (content.get('canonicalUrl') or {}).get('url') or (content.get('clickThroughUrl') or {}).get('url')
        if not title or not isinstance(url, str) or urlparse(url).scheme not in ('http', 'https') or url in seen:
            continue
        seen.add(url)
        rows.append({'title': title, 'url': url, 'publisher': (content.get('provider') or {}).get('displayName', ''),
                     'publishedAt': content.get('pubDate'), 'summary': content.get('summary') or ''})
    return sorted(rows, key=lambda row: row['publishedAt'] or '', reverse=True)


@lru_cache(maxsize=128)
def _fetch_news(symbol, cache_bucket):
    return normalize_news(yf.Ticker(yahoo_symbol(symbol)).get_news(count=NEWS_LIMIT, tab='all'))


def fetch_news(symbol):
    return _fetch_news(symbol, int(time() // NEWS_CACHE_SECONDS))
