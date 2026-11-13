"""Translate Nasdaq Trader's US directory codes to Yahoo Finance codes."""
import re

US_SYMBOL_PATTERN = re.compile(r'[A-Z]+(?:[.-][A-Z])?')
US_SECURITY_SUFFIXES = {'U': 'UN', 'W': 'WT', 'R': 'RI'}
# Nasdaq Trader's NE.A is a tranche A warrant (CQS NE.WS.A), not class A stock.
US_SYMBOL_OVERRIDES = {'NE.A': 'NE-WTA', 'NE-A': 'NE-WTA'}


def us_yahoo_symbol(symbol: str) -> str:
    if symbol in US_SYMBOL_OVERRIDES:
        return US_SYMBOL_OVERRIDES[symbol]
    if not US_SYMBOL_PATTERN.fullmatch(symbol):
        return symbol
    parts = re.split(r'[.-]', symbol)
    if len(parts) == 1:
        return symbol
    base, suffix = parts
    return f'{base}-{US_SECURITY_SUFFIXES.get(suffix, suffix)}'
