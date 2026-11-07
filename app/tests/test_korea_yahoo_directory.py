import unittest
from unittest.mock import patch

from services.stock_analysis import korea_yahoo


class KoreaYahooDirectoryTests(unittest.TestCase):
    @patch.object(korea_yahoo, '_directory', return_value={
        '005930.KS': {'longName': '삼성전자(주)', 'shortName': 'SamsungElec'},
        '005935.KS': {'longName': '삼성전자(주)', 'shortName': 'SamsungElec(1P)'},
    })
    def test_preferred_share_is_identified_from_provider_metadata(self, directory):
        self.assertEqual(korea_yahoo.korea_preferred_symbols('ko'), {'005935.KS'})
        self.assertEqual(korea_yahoo.korea_display_names('ko')['005930.KS'], '삼성전자(주)')
        self.assertEqual(directory.call_args.args[1], 'ko')

    @patch.object(korea_yahoo, '_screen', return_value={'quotes': [
        {'symbol': '005935.KS'}, {'symbol': '005930.KS'}, {'symbol': '000660.KS'},
    ], 'total': 3})
    def test_sector_members_exclude_preferred_shares(self, screen):
        _, symbols = korea_yahoo._sector_members('Technology')
        self.assertEqual(symbols, ['005930.KS', '000660.KS'])

    @patch.object(korea_yahoo, 'YfData')
    def test_directory_requests_korean_names_directly(self, data):
        data.return_value.post.return_value.json.return_value = {'finance': {'result': [{'quotes': []}]}}
        korea_yahoo._screen(language='ko')
        self.assertEqual(data.return_value.post.call_args.kwargs['params']['lang'], 'ko-KR')
