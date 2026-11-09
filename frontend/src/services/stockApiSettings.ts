import {stockSymbolCode} from '../utils/stockSymbols';
import {assertOk} from '../utils/apiError';
import {STOCK_MARKETS, type DailyPrice, type StockMarket} from './stockAnalysis';

export const STOCK_API_KINDS = ['symbols', 'quotes', 'prices', 'sparkline', 'marketIndices', 'sectorMap'] as const;
export type StockApiKind = typeof STOCK_API_KINDS[number];
export type StockApiEndpoint = {url: string; method: 'GET' | 'POST'; body: Record<string, unknown>};
export const STOCK_API_MARKETS = STOCK_MARKETS;
export type StockApiHeader = {name: string; value?: string; hasValue?: boolean};
export type StockApiSettings = {
    headers?: StockApiHeader[];
    endpoints: Partial<Record<StockApiKind, StockApiEndpoint>>;
    headerName: string;
    keyPrefix: string;
    hasApiKey: boolean;
    apiKey?: string;
    clearApiKey?: boolean;
};
export const EMPTY_STOCK_API_SETTINGS: StockApiSettings = {endpoints: {}, headerName: 'Authorization', keyPrefix: 'Bearer ', hasApiKey: false};

export type StockApiValidationResult = {
    ok: boolean;
    code: string;
    status: number | null;
    count?: number;
    fields: string[];
};

function settingsPayload(settings: StockApiSettings) {
    return {...settings, hasApiKey: undefined, headers: settings.headers?.length ? settings.headers : undefined};
}

async function settingsRequest(market: StockMarket, signal?: AbortSignal, settings?: StockApiSettings): Promise<StockApiSettings> {
    const response = await fetch(`/api/stock-analysis/api-settings/${market}`, {
        signal,
        ...(settings ? {method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(settingsPayload(settings))} : {}),
    });
    await assertOk(response);
    return response.json();
}
export const stockApiSettings = {
    async deleteKey(market: StockMarket): Promise<StockApiSettings> {
        const response = await fetch(`/api/stock-analysis/api-settings/${market}/key`, {method: 'DELETE'});
        await assertOk(response);
        return response.json();
    },
    load: (market: StockMarket, signal: AbortSignal) => settingsRequest(market, signal),
    save: (market: StockMarket, settings: StockApiSettings) => settingsRequest(market, undefined, settings),
    async validate(market: StockMarket, kind: StockApiKind, settings: StockApiSettings, symbol: string, language: string, signal: AbortSignal, testParameters?: {period?: string; interval?: string}): Promise<StockApiValidationResult> {
        const response = await fetch(`/api/stock-analysis/api-settings/${market}/validate/${kind}`, {
            method: 'POST', signal, headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({settings: settingsPayload(settings), ...((kind === 'sparkline' || kind === 'quotes') ? {symbols: symbol.split(',').map(value => stockSymbolCode(value.trim()))} : {symbol: stockSymbolCode(symbol)}), language, ...testParameters}),
        });
        if (response.status === 422) return {ok: false, code: 'invalid_config', status: 422, fields: []};
        await assertOk(response);
        return response.json();
    },
};

export function stockApiExamples(market: StockMarket, kind: StockApiKind, language = 'en') {
    const symbol = {KR: '005930', US: 'AAPL', JP: '7203.T'}[market];
    const secondSymbol = {KR: '000660', US: 'MSFT', JP: '6758.T'}[market];
    const indexSymbol = {KR: 'KS11', US: 'GSPC', JP: 'N225'}[market];
    const price = {
        day: '2026-11-06', open: 100, high: 105, low: 98, close: 103,
        volume: 1000000, tradingValue: 102500000, changePercent: 3,
        investors: {
            ind: {buyVolume: 400000, buyAmount: 41000000, sellVolume: -300000, sellAmount: -30750000, netVolume: 100000, netAmount: 10250000},
            for: {netVolume: -60000, netAmount: -6150000},
            ins: {netVolume: -40000, netAmount: -4100000},
        },
    } satisfies DailyPrice;
    const stock = {symbol, ...(market === 'KR' ? {exchange: 'KOSPI'} : {}), name: {KR: 'Samsung Electronics', US: 'Apple', JP: 'Toyota Motor'}[market], weight: 10, change: 1.2, price: 103};
    const responses = {
        quotes: [{symbol, date: '2026-11-06', price: 103, change: 3, marketCap: 500000000000}],
        symbols: [{symbol, name: stock.name, preferred: false, ...(market === 'KR' ? {exchange: 'KOSPI'} : {})}],
        prices: [price], sparkline: {[symbol]: [100, 101, 99, 103], [secondSymbol]: [98, 100, 102, 104]},
        marketIndices: [{symbol: indexSymbol, price: 103, change: 3, changePercent: 3, date: '2026-11-06', closes: [100, 101, 103]}],
        sectorMap: {date: '2026-11-06', quoteDate: '2026-11-06', sectors: [{name: 'Technology', weight: 10, change: 1.2, stocks: [stock]}]},
    };
    const query = kind === 'quotes' ? 'symbols={symbols}&market={market}' : kind === 'sparkline' ? 'symbols={symbols}&period={period}&interval={interval}' : kind === 'prices' ? 'symbol={symbol}&period={period}&interval={interval}' : 'market={market}&language={language}';
    const body = kind === 'quotes' ? {symbols: '{symbols}', market: '{market}'} : kind === 'sparkline' ? {symbols: '{symbols}', period: '{period}', interval: '{interval}'} : kind === 'prices'
        ? {symbol: '{symbol}', period: '{period}', interval: '{interval}'} : {market: '{market}', language: '{language}'};
    const values: Record<string, string> = {symbol, symbols: `${symbol},${secondSymbol}`, market, language: kind === 'marketIndices' ? 'en' : language, period: kind === 'sparkline' ? '3mo' : '10y', interval: '1d'};
    const actualBody = Object.fromEntries(Object.entries(body).map(([key]) => [key, key === 'symbols' ? values[key].split(',') : values[key]]));
    const url = `https://api.example.com/${kind}`;
    const actualUrl = `${url}?${query}`.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(values[key]));
    return {url, actualUrl, body, actualBody, values, response: responses[kind]};
}

export function prepareStockApiSettings(settings: StockApiSettings, bodies: Partial<Record<StockApiKind, string>>): StockApiSettings {
    const headerNames = (settings.headers ?? []).map(header => header.name.trim().toLowerCase());
    if (new Set(headerNames).size !== headerNames.length) throw new Error('invalid');
    return {...settings, headers: (settings.headers ?? []).map(header => {
        const name = header.name.trim();
        if (!/^[A-Za-z0-9-]+$/.test(name) || ['host', 'content-length', 'connection', 'transfer-encoding'].includes(name.toLowerCase())
            || /[\r\n]/.test(header.value ?? '') || (!header.value && !header.hasValue)) throw new Error('invalid');
        return {name, value: header.value || undefined};
    }), endpoints: Object.fromEntries(STOCK_API_KINDS.map(kind => {
        const endpoint = settings.endpoints[kind] ?? {url: '', method: 'GET', body: {}};
        const body: unknown = endpoint.method === 'POST' ? JSON.parse(bodies[kind] || '{}') : endpoint.body;
        if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid');
        if (endpoint.url.trim()) {
            const url = new URL(endpoint.url.trim());
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid');
        }
        return [kind, {...endpoint, url: endpoint.url.trim(), body}];
    }))};
}

export function stockApiDraftSignature(settings: StockApiSettings, bodies: Partial<Record<StockApiKind, string>>): string {
    const endpoints = STOCK_API_KINDS.map(kind => {
        const endpoint = settings.endpoints[kind];
        let body: unknown = endpoint?.body ?? {};
        if (endpoint?.method === 'POST') {
            try {body = JSON.parse(bodies[kind] || '{}');} catch {body = bodies[kind];}
        }
        return {kind, url: endpoint?.url ?? '', method: endpoint?.method ?? 'GET', body};
    });
    return JSON.stringify({endpoints, headerName: settings.headerName, keyPrefix: settings.keyPrefix,
        apiKey: settings.apiKey || '', clearApiKey: Boolean(settings.clearApiKey),
        headers: (settings.headers ?? []).map(header => ({name: header.name, value: header.value || '', hasValue: Boolean(header.hasValue)}))});
}
