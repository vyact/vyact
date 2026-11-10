"""Parse and fetch GICS sub-industries; market_group_cache owns the daily snapshot."""
import csv

import httpx

CLASSIFICATION_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv'
MINIMUM_CLASSIFIED_SYMBOLS = 400


def parse_industries(text: str) -> dict[str, str]:
    reader = csv.DictReader(text.lstrip('\ufeff').splitlines())
    if not {'Symbol', 'GICS Sub-Industry'}.issubset(reader.fieldnames or []):
        raise ValueError('Missing industry classification columns')
    result = {}
    for row in reader:
        symbol = (row.get('Symbol') or '').strip().replace('.', '-')
        industry = (row.get('GICS Sub-Industry') or '').strip()
        if symbol and industry:
            result[symbol] = industry
    return result


def fetch_us_industries(client: httpx.Client) -> dict[str, str]:
    response = client.get(CLASSIFICATION_URL)
    response.raise_for_status()
    fresh = parse_industries(response.text)
    if len(fresh) < MINIMUM_CLASSIFIED_SYMBOLS:
        raise ValueError('Incomplete S&P 500 industry classification')
    return fresh
