"""Elasticsearch-backed stock groups and watchlist settings."""
from typing import Annotated

from elasticsearch import NotFoundError
from fastapi import APIRouter, Response
from pydantic import BaseModel, Field, StringConstraints, model_validator

from services.db import SETTINGS_INDEX, get_es
from services.stock_analysis.catalog import Market
from services.stock_analysis.symbols import public_symbol

router = APIRouter()
StockCode = Annotated[str, Field(pattern=r'^[A-Z0-9][A-Z0-9.-]{0,15}$')]


class StockGroupPreference(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    market: Market
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    symbols: list[StockCode] = Field(max_length=100)

    @model_validator(mode='after')
    def normalize_symbols(self):
        self.symbols = list(dict.fromkeys(public_symbol(symbol) for symbol in self.symbols))
        return self


class StockGroupPreferences(BaseModel):
    items: list[StockGroupPreference] = Field(max_length=1000)

    @model_validator(mode='after')
    def unique_ids(self):
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError('Duplicate group id')
        return self


class StockWatchlistPreferences(BaseModel):
    items: list[Annotated[str, Field(pattern=r'^(KR|US|JP|TW|HK|CN):[A-Z0-9][A-Z0-9.-]{0,15}$')]] = Field(max_length=10000)

    @model_validator(mode='after')
    def normalize_items(self):
        self.items = list(dict.fromkeys(f'{market}:{public_symbol(symbol)}' for market, symbol in
                                       (item.split(':', 1) for item in self.items)))
        return self


async def load_preferences(key, model):
    es = get_es()
    try:
        try:
            result = await es.get(index=SETTINGS_INDEX, id=key)
        except NotFoundError:
            return {'items': None}
        return model.model_validate(result['_source']['value']).model_dump()
    finally:
        await es.close()


async def store_preferences(key, body):
    es = get_es()
    try:
        await es.index(index=SETTINGS_INDEX, id=key, document={'key': key, 'value': body.model_dump()}, refresh='wait_for')
        return {'ok': True}
    finally:
        await es.close()


@router.get('/groups')
async def get_groups(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return await load_preferences('stock_analysis_groups', StockGroupPreferences)


@router.put('/groups')
async def put_groups(body: StockGroupPreferences):
    return await store_preferences('stock_analysis_groups', body)


@router.get('/watchlist')
async def get_watchlist(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return await load_preferences('stock_analysis_watchlist', StockWatchlistPreferences)


@router.put('/watchlist')
async def put_watchlist(body: StockWatchlistPreferences):
    return await store_preferences('stock_analysis_watchlist', body)
