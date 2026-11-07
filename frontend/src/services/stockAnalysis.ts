import {assertOk} from '../utils/apiError';
import {localizeStockName} from '../utils/stockDisplayName';

export const STOCK_ANALYSIS_PANEL_ID = 'stock-analysis';
export const TOGGLE_STOCK_ANALYSIS_EVENT = 'vyact:toggle-stock-analysis';
export const STOCK_ANALYSIS_SHORTCUT_KEY = 'U';
export type StockMarket = 'KR' | 'US';
export interface StockSymbol {symbol: string; name: string; preferred?: boolean}
export interface SectorStock extends StockSymbol {weight: number; change: number | null; price: number | null}
export interface MarketSector {name: string; weight: number; change: number | null; stocks: SectorStock[]}
export interface MarketIndex {symbol: string; price: number | null; change: number | null; changePercent: number | null; date: string | null; closes: number[]}
export interface MarketSectorMap {date: string; quoteDate: string; sectors: MarketSector[]}

export interface DailyPrice {
    day: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
}

export type StockMemoDraft = {title: string; content: string};
export type StockMemo = StockMemoDraft & {symbol: string; day: string};

type PriceSnapshot = {symbol: string; fetchedAt: number; rows: DailyPrice[]};
const PRICE_CACHE_KEY = 'vyact:stock-prices:v3';
const PRICE_CACHE_TTL = 15 * 60 * 1000;
const PRICE_CACHE_LIMIT = 8;

function readPriceCache(): PriceSnapshot[] {
    try {
        const snapshots: unknown = JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) ?? '[]');
        if (!Array.isArray(snapshots)) return [];
        const now = Date.now();
        return snapshots.filter((item): item is PriceSnapshot => item && typeof item.symbol === 'string'
            && typeof item.fetchedAt === 'number' && item.fetchedAt <= now
            && now - item.fetchedAt < PRICE_CACHE_TTL && Array.isArray(item.rows) && item.rows.length > 0);
    } catch {
        return [];
    }
}

async function request<T>(path: string, signal?: AbortSignal, options?: RequestInit): Promise<T> {
    const response = await fetch(`/api/stock-analysis/${path}`, {...options, signal});
    await assertOk(response);
    return response.json();
}

export const stockAnalysis = {
    memos: (symbol: string, signal: AbortSignal) => request<StockMemo[]>(`memos/${encodeURIComponent(symbol)}`, signal),
    deleteMemo: (symbol: string, day: string) => request<{deleted: boolean}>(`memos/${encodeURIComponent(symbol)}/${day}`, undefined, {method: 'DELETE'}),
    saveMemo: (symbol: string, day: string, draft: StockMemoDraft) => request<StockMemo>(`memos/${encodeURIComponent(symbol)}/${day}`, undefined, {
        method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(draft),
    }),
    marketIndices: (signal: AbortSignal, market: StockMarket = 'US') => request<MarketIndex[]>(`market-indices?market=${market}`, signal),
    sparkline: (symbol: string, signal: AbortSignal) => request<number[]>(`sparkline/${encodeURIComponent(symbol)}`, signal),
    sectorMap: (market: StockMarket, signal: AbortSignal, language = 'en') => request<MarketSectorMap>(`sector-map/${market}?language=${encodeURIComponent(language)}`, signal),
    async symbols(market: StockMarket, signal: AbortSignal, language = 'en'): Promise<StockSymbol[]> {
        const symbols = await request<StockSymbol[]>(`symbols/${market}?language=${encodeURIComponent(language)}`, signal);
        return symbols.map(item => ({...item, name: localizeStockName(item.name, language)}));
    },
    async prices(symbol: string, signal: AbortSignal, refresh: boolean): Promise<DailyPrice[]> {
        const cached = readPriceCache().find(item => item.symbol === symbol);
        if (!refresh && cached && !symbol.startsWith('^')) return cached.rows;
        const rows = await request<DailyPrice[]>(`prices/${encodeURIComponent(symbol)}`, signal);
        if (rows.length && !symbol.startsWith('^')) {
            try {
                const snapshots = readPriceCache().filter(item => item.symbol !== symbol);
                snapshots.unshift({symbol, fetchedAt: Date.now(), rows});
                localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(snapshots.slice(0, PRICE_CACHE_LIMIT)));
            } catch {
                // The chart still works when browser storage is unavailable or full.
            }
        }
        return rows;
    },
};
