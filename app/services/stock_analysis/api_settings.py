"""Per-market external API adapters using the stock workspace's JSON contracts."""
import json
import re
from datetime import date
from dataclasses import dataclass
from typing import Annotated, Literal
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import httpx
from elasticsearch import NotFoundError
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, model_validator

from services.db import SETTINGS_INDEX, get_es
from services.stock_analysis.symbols import is_market_index, normalize_market_indices, normalize_stock, normalize_sector_map, public_symbol, symbol_market

EndpointKind = Literal['symbols', 'prices', 'sparkline', 'marketIndices', 'sectorMap']
STOCK_SYMBOL_PATTERN = r'^(?:[A-Z0-9][A-Z0-9.-]{0,15}|\^(?:GSPC|IXIC|RUT|KS11|KQ11))$'
TOKEN_PATTERN = re.compile(r'\{(symbols|symbol|market|language|period|interval)\}')


class ApiEndpoint(BaseModel):
    url: str = Field(default='', max_length=4000)
    method: Literal['GET', 'POST'] = 'GET'
    body: dict = Field(default_factory=dict)

    @model_validator(mode='after')
    def validate_url(self):
        if self.url:
            parsed = urlsplit(self.url)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError('Use an HTTP(S) URL without embedded credentials')
        return self


class ApiHeader(BaseModel):
    name: str = Field(pattern=r'^[A-Za-z0-9-]+$', max_length=100)
    value: str | None = Field(default=None, max_length=8000)

    @model_validator(mode='after')
    def validate_header(self):
        if self.name.lower() in ('host', 'content-length', 'connection', 'transfer-encoding') or any(character in (self.value or '') for character in ('\r', '\n')):
            raise ValueError('Invalid HTTP header')
        return self


class MarketApiSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    endpoints: dict[EndpointKind, ApiEndpoint] = Field(default_factory=dict)
    apiKey: str | None = Field(default=None, max_length=8000)
    clearApiKey: bool = False
    headers: list[ApiHeader] = Field(default_factory=list, max_length=64)
    headerName: str = Field(default='Authorization', pattern=r'^[A-Za-z0-9-]+$', max_length=100)
    keyPrefix: str = Field(default='Bearer ', max_length=100)

    @model_validator(mode='after')
    def validate_headers(self):
        names = [header.name.lower() for header in self.headers]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate HTTP header')
        if any('\r' in value or '\n' in value for value in (self.apiKey or '', self.keyPrefix)):
            raise ValueError('Invalid header value')
        if self.headerName.lower() in ('host', 'content-length', 'connection', 'transfer-encoding'):
            raise ValueError('Reserved HTTP header')
        return self


class StockSymbolResponse(BaseModel):
    symbol: str = Field(pattern=STOCK_SYMBOL_PATTERN)
    name: str
    preferred: bool = False
    exchange: Literal['KOSPI', 'KOSDAQ'] | None = None


InvestorGroup = Literal['ind', 'for', 'ins', 'pen', 'itc', 'pef', 'fin', 'sur', 'bng', 'etc', 'cor', 'eor']


class InvestorTradeResponse(BaseModel):
    buyVolume: int | None = None
    buyAmount: int | None = None
    sellVolume: int | None = None
    sellAmount: int | None = None
    netVolume: int | None = None
    netAmount: int | None = None
    averagePrice: int | None = None


class PriceResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    day: date
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float | None = Field(default=None, ge=0)
    tradingValue: float | None = Field(default=None, ge=0)
    changePercent: float | None = None
    investors: dict[InvestorGroup, InvestorTradeResponse] | None = None


class IndexResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    symbol: str = Field(pattern=STOCK_SYMBOL_PATTERN)
    price: float | None
    change: float | None
    changePercent: float | None
    date: date | None
    closes: list[float]


class SectorStockResponse(StockSymbolResponse):
    model_config = ConfigDict(allow_inf_nan=False)
    weight: float = Field(ge=0)
    change: float | None
    price: float | None


class SectorResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    name: str
    weight: float = Field(ge=0)
    change: float | None
    stocks: list[SectorStockResponse]


class SectorMapResponse(BaseModel):
    date: date
    quoteDate: date
    sectors: list[SectorResponse]


RESPONSE_ADAPTERS = {
    'symbols': TypeAdapter(list[StockSymbolResponse]),
    'prices': TypeAdapter(list[PriceResponse]),
    'sparkline': TypeAdapter(Annotated[list[Annotated[float, Field(gt=0)]], Field(max_length=20)], config=ConfigDict(allow_inf_nan=False)),
    'marketIndices': TypeAdapter(list[IndexResponse]),
    'sectorMap': TypeAdapter(SectorMapResponse),
}


async def load_api_settings(market: str) -> MarketApiSettings:
    es = get_es()
    try:
        result = await es.get(index=SETTINGS_INDEX, id=f'stock_api:{market}')
        return MarketApiSettings.model_validate(result['_source']['value'])
    except NotFoundError:
        return MarketApiSettings()
    finally:
        await es.close()


def public_settings(settings: MarketApiSettings) -> dict:
    return {**settings.model_dump(exclude={'apiKey', 'clearApiKey', 'headers'}), 'hasApiKey': bool(settings.apiKey),
            'headers': [{'name': header.name, 'hasValue': bool(header.value)} for header in settings.headers]}


def resolve_api_secrets(settings: MarketApiSettings, previous: MarketApiSettings) -> MarketApiSettings:
    settings = settings.model_copy(deep=True)
    settings.apiKey = '' if settings.clearApiKey else settings.apiKey if settings.apiKey is not None else previous.apiKey
    previous_headers = {header.name.lower(): header.value for header in previous.headers}
    for header in settings.headers:
        if header.value is None:
            if header.name.lower() not in previous_headers:
                raise HTTPException(422, 'missing_header_value')
            header.value = previous_headers[header.name.lower()]
    settings.clearApiKey = False
    return settings


async def save_api_settings(market: str, settings: MarketApiSettings) -> dict:
    settings = resolve_api_secrets(settings, await load_api_settings(market))
    es = get_es()
    try:
        key = f'stock_api:{market}'
        await es.index(index=SETTINGS_INDEX, id=key, document={'key': key, 'value': settings.model_dump()}, refresh='wait_for')
    finally:
        await es.close()
    return public_settings(settings)


def render_template(value, tokens: dict, *, url: bool = False):
    if isinstance(value, str):
        return TOKEN_PATTERN.sub(lambda match: quote(tokens[match[1]], safe='') if url else tokens[match[1]], value)
    if isinstance(value, dict):
        return {key: render_template(item, tokens) for key, item in value.items()}
    if isinstance(value, list):
        return [render_template(item, tokens) for item in value]
    return value


def build_api_request(endpoint: ApiEndpoint, kind: EndpointKind, tokens: dict[str, str]) -> tuple[str, dict]:
    keys = ('symbol', 'period', 'interval') if kind in ('prices', 'sparkline') else ('market', 'language')
    if kind == 'sparkline' and tokens.get('symbols'):
        keys = ('symbols', 'period', 'interval')
    parts = urlsplit(render_template(endpoint.url, tokens, url=True))
    query = parse_qsl(parts.query, keep_blank_values=True)
    query_keys = {key for key, _ in query}
    query = [(key, tokens[key] if key in keys else value) for key, value in query]
    url_tokens = set(TOKEN_PATTERN.findall(endpoint.url))
    body = render_template(endpoint.body, tokens)
    body_tokens = set(TOKEN_PATTERN.findall(json.dumps(endpoint.body)))
    for key in keys:
        if endpoint.method == 'GET':
            if key not in query_keys and key not in url_tokens:
                query.append((key, tokens[key]))
        elif key in body or (key not in query_keys and key not in url_tokens and key not in body_tokens):
            body[key] = tokens[key].split(',') if key == 'symbols' else tokens[key]
    url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    return url, {'json': body} if endpoint.method == 'POST' else {}


class ApiValidationRequest(BaseModel):
    settings: MarketApiSettings
    symbol: str | None = Field(default=None, pattern=STOCK_SYMBOL_PATTERN)
    symbols: list[Annotated[str, Field(pattern=STOCK_SYMBOL_PATTERN)]] | None = Field(default=None, min_length=1, max_length=100)
    language: str = Field(default='en', max_length=35)
    period: str | None = Field(default=None, min_length=1, max_length=24, pattern=r'^[A-Za-z0-9_-]+$')
    interval: str | None = Field(default=None, min_length=1, max_length=24, pattern=r'^[A-Za-z0-9_-]+$')


@dataclass
class ApiResult:
    data: list | dict
    status: int


class ApiValidationFailure(Exception):
    def __init__(self, code: str, status: int | None = None, fields: list[str] | None = None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.fields = fields or []


async def execute_api_request(settings: MarketApiSettings, market: str, kind: EndpointKind, *, symbol: str = '', language: str = 'en', period: str | None = None, interval: str | None = None, symbols: list[str] | None = None) -> ApiResult:
    endpoint = settings.endpoints.get(kind)
    if endpoint is None or not endpoint.url.strip():
        raise ApiValidationFailure('url_required')
    tokens = {'market': market, 'symbol': public_symbol(symbol), 'language': language,
              'period': period or ('3mo' if kind == 'sparkline' else 'max' if is_market_index(symbol) else '10y'), 'interval': interval or '1d'}
    if symbols is not None:
        tokens['symbols'] = ','.join(dict.fromkeys(public_symbol(item) for item in symbols))
    headers = {header.name: header.value or '' for header in settings.headers}
    if settings.apiKey:
        headers = {name: value for name, value in headers.items() if name.lower() != settings.headerName.lower()}
        headers[settings.headerName] = settings.keyPrefix + settings.apiKey
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False, trust_env=False) as client:
            url, payload = build_api_request(endpoint, kind, tokens)
            response = await client.request(endpoint.method, url, headers=headers, **payload)
            response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise ApiValidationFailure('timeout') from exc
    except httpx.HTTPStatusError as exc:
        raise ApiValidationFailure('http_error', exc.response.status_code) from exc
    except (httpx.RequestError, httpx.InvalidURL, UnicodeError) as exc:
        raise ApiValidationFailure('connection_error') from exc
    try:
        payload = response.json()
    except ValueError as exc:
        raise ApiValidationFailure('invalid_json', response.status_code) from exc
    adapter = (TypeAdapter(dict[str, Annotated[list[Annotated[float, Field(gt=0)]], Field(max_length=20)]],
                           config=ConfigDict(allow_inf_nan=False))
               if kind == 'sparkline' and symbols is not None else RESPONSE_ADAPTERS[kind])
    try:
        result = adapter.validate_python(payload)
    except ValidationError as exc:
        fields = ['.'.join(str(part) for part in error['loc']) or '$' for error in exc.errors()[:5]]
        raise ApiValidationFailure('invalid_schema', response.status_code, fields) from exc
    normalized = json.loads(adapter.dump_json(result))
    if kind == 'sparkline' and symbols is not None:
        expected = {public_symbol(item) for item in symbols}
        normalized = {public_symbol(key): value for key, value in normalized.items()}
        if set(normalized) != expected:
            raise ApiValidationFailure('invalid_schema', response.status_code, ['symbols'])
    if kind == 'symbols':
        normalized = [normalize_stock(stock) for stock in normalized]
        symbols = [stock['symbol'] for stock in normalized]
        if len(symbols) != len(set(symbols)):
            raise ApiValidationFailure('invalid_schema', response.status_code, ['symbol'])
    elif kind == 'marketIndices':
        normalized = normalize_market_indices(normalized)
    elif kind == 'sectorMap':
        normalized = normalize_sector_map(normalized)
    if kind == 'prices':
        for row in normalized:
            investors = {group: {key: value for key, value in trade.items() if value is not None}
                         for group, trade in (row.get('investors') or {}).items()}
            investors = {group: trade for group, trade in investors.items() if trade}
            if investors:
                row['investors'] = investors
            else:
                row.pop('investors', None)
        days = [row['day'] for row in normalized]
        if days != sorted(set(days)):
            raise ApiValidationFailure('invalid_dates', response.status_code)
    return ApiResult(normalized, response.status_code)


async def custom_data(market: str, kind: EndpointKind, *, symbol: str = '', language: str = 'en', symbols: list[str] | None = None):
    settings = await load_api_settings(market)
    endpoint = settings.endpoints.get(kind)
    if endpoint is None or not endpoint.url.strip():
        return None
    try:
        return (await execute_api_request(settings, market, kind, symbol=symbol, language=language, symbols=symbols)).data
    except Exception as exc:
        # Never expose credentials, URLs, request bodies, or provider responses.
        raise HTTPException(502, 'custom_stock_api_failed') from exc


async def validate_api_settings(market: str, kind: EndpointKind, draft: ApiValidationRequest) -> dict:
    endpoint = draft.settings.endpoints.get(kind)
    if endpoint is None or not endpoint.url.strip():
        return {'ok': False, 'code': 'url_required', 'status': None, 'fields': []}
    settings = resolve_api_secrets(draft.settings, await load_api_settings(market))
    symbol = draft.symbol or ('005930' if market == 'KR' else 'AAPL')
    try:
        result = await execute_api_request(settings, market, kind, symbol=symbol, language=draft.language, period=draft.period, interval=draft.interval, symbols=draft.symbols)
    except ApiValidationFailure as exc:
        return {'ok': False, 'code': exc.code, 'status': exc.status, 'fields': exc.fields}
    if kind == 'sectorMap':
        count = sum(len(sector['stocks']) for sector in result.data['sectors'])
    elif kind == 'marketIndices':
        count = sum(item['price'] is not None for item in result.data)
    else:
        count = len(result.data)
    return {'ok': True, 'code': 'valid' if count else 'empty', 'status': result.status, 'count': count, 'fields': []}
