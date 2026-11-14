import unittest
from unittest.mock import patch

from services.stock_analysis.news import _fetch_news, fetch_news, normalize_news


class StockNewsTests(unittest.TestCase):
    def test_filters_unsafe_links_and_duplicates_and_orders_latest_first(self):
        rows = normalize_news([
            {'content': {'title': 'Older', 'canonicalUrl': {'url': 'https://example.com/old'}, 'pubDate': '2026-11-13T01:00:00Z'}},
            {'content': {'title': 'Unsafe', 'canonicalUrl': {'url': 'javascript:alert(1)'}}},
            {'content': None},
            {'content': {'title': 'Newer', 'clickThroughUrl': {'url': 'https://example.com/new'}, 'pubDate': '2026-11-14T01:00:00Z', 'provider': {'displayName': 'Publisher'}}},
            {'content': {'title': 'Duplicate', 'canonicalUrl': {'url': 'https://example.com/old'}}},
        ])
        self.assertEqual([row['title'] for row in rows], ['Newer', 'Older'])
        self.assertEqual(rows[0]['publisher'], 'Publisher')

    @patch('services.stock_analysis.news.yf.Ticker')
    @patch('services.stock_analysis.news.yahoo_symbol', return_value='005930.KS')
    def test_requests_all_news_with_yahoo_symbol_and_caches(self, convert_symbol, ticker):
        _fetch_news.cache_clear()
        ticker.return_value.get_news.return_value = []
        self.assertEqual(fetch_news('005930'), [])
        fetch_news('005930')
        ticker.assert_called_once_with('005930.KS')
        convert_symbol.assert_called_once_with('005930')
        ticker.return_value.get_news.assert_called_once_with(count=30, tab='all')
