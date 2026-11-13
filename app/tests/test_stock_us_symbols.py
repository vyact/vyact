import unittest

from services.stock_analysis.us_symbols import us_yahoo_symbol


class UsYahooSymbolTests(unittest.TestCase):
    def test_directory_security_types_and_legacy_codes(self):
        for source, expected in {
            'SOUL.U': 'SOUL-UN', 'SOUL-U': 'SOUL-UN',
            'AAC.W': 'AAC-WT', 'AAC-W': 'AAC-WT',
            'SOUL.R': 'SOUL-RI', 'SOUL-R': 'SOUL-RI',
            'BRK.B': 'BRK-B', 'BRK-B': 'BRK-B', 'MKC.V': 'MKC-V',
            'NE.A': 'NE-WTA', 'NE-A': 'NE-WTA', 'NE-WTA': 'NE-WTA',
            'SOUL-UN': 'SOUL-UN', 'AAC-WT': 'AAC-WT', 'SOUL-RI': 'SOUL-RI',
            'AAPL': 'AAPL', 'SOULU': 'SOULU', 'AACW': 'AACW',
        }.items():
            with self.subTest(source=source):
                self.assertEqual(us_yahoo_symbol(source), expected)

    def test_foreign_exchange_suffixes_and_futures_are_preserved(self):
        for symbol in ('005930.KS', '247540.KQ', '7203.T', '2330.TW', '6488.TWO',
                       '0700.HK', '600519.SS', '000001.SZ', '^GSPC', 'NQ=F'):
            with self.subTest(symbol=symbol):
                self.assertEqual(us_yahoo_symbol(symbol), symbol)
