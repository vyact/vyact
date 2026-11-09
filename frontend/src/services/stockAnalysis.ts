import {normalizeStockSectorMap, normalizeStockSymbol, stockSymbolCode} from '../utils/stockSymbols';
import {assertOk} from '../utils/apiError';
import {localizeStockName} from '../utils/stockDisplayName';

export const STOCK_ANALYSIS_PANEL_ID = 'stock-analysis';
export const TOGGLE_STOCK_ANALYSIS_EVENT = 'vyact:toggle-stock-analysis';
export const STOCK_ANALYSIS_SHORTCUT_KEY = 'U';
export const STOCK_MARKETS = ['US', 'KR', 'JP'] as const;
export type StockMarket = typeof STOCK_MARKETS[number];
export interface StockSymbol {symbol: string; name: string; preferred?: boolean; exchange?: 'KOSPI' | 'KOSDAQ'}
export interface SectorStock extends StockSymbol {weight: number; change: number | null; price: number | null}
export interface MarketSector {name: string; weight: number; change: number | null; stocks: SectorStock[]}
export interface StockQuote {symbol: string; date: string; price: number; change: number; marketCap: number}
export interface MarketIndex {symbol: string; indexSymbol?: string; quoteTime?: number; nextRegularOpen?: number; price: number | null; change: number | null; changePercent: number | null; date: string | null; closes: number[]}
export interface MarketSectorMap {date: string; quoteDate: string; sectors: MarketSector[]}

export type StockInvestorGroup = 'ind' | 'for' | 'ins' | 'pen' | 'itc' | 'pef' | 'fin' | 'sur' | 'bng' | 'etc' | 'cor' | 'eor';
export interface StockInvestorTrade {
    buyVolume?: number | null;
    buyAmount?: number | null;
    sellVolume?: number | null;
    sellAmount?: number | null;
    netVolume?: number | null;
    netAmount?: number | null;
    averagePrice?: number | null;
}

export interface DailyPrice {
    day: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
    tradingValue?: number | null;
    changePercent?: number | null;
    investors?: Partial<Record<StockInvestorGroup, StockInvestorTrade>>;
}

export type StockMemoDraft = {title: string; content: string};
export type StockMemo = StockMemoDraft & {symbol: string; day: string};

async function request<T>(path: string, signal?: AbortSignal, options?: RequestInit): Promise<T> {
    const response = await fetch(`/api/stock-analysis/${path}`, {...options, signal});
    await assertOk(response);
    return response.json();
}

export const stockAnalysis = {
    tradingStatus: (symbol: string, signal: AbortSignal) => request<{open: boolean}>(
        `trading-status/${encodeURIComponent(stockSymbolCode(symbol))}`, signal, {cache: 'no-store'},
    ),
    groupQuotes: (symbols: string[], signal: AbortSignal) => request<StockQuote[]>('group-quotes', signal, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({symbols: symbols.map(stockSymbolCode)}),
    }),
    memos: (symbol: string, signal: AbortSignal) => request<StockMemo[]>(`memos/${encodeURIComponent(stockSymbolCode(symbol))}`, signal),
    deleteMemo: (symbol: string, day: string) => request<{deleted: boolean}>(`memos/${encodeURIComponent(stockSymbolCode(symbol))}/${day}`, undefined, {method: 'DELETE'}),
    saveMemo: (symbol: string, day: string, draft: StockMemoDraft) => request<StockMemo>(`memos/${encodeURIComponent(stockSymbolCode(symbol))}/${day}`, undefined, {
        method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(draft),
    }),
    marketIndices: async (signal: AbortSignal, market: StockMarket = 'US') => (await request<MarketIndex[]>(`market-indices?market=${market}`, signal)).map(normalizeStockSymbol),
    sparkline: (symbol: string, signal: AbortSignal) => request<number[]>(`sparkline/${encodeURIComponent(stockSymbolCode(symbol))}`, signal),
    sparklines: (symbols: string[], signal: AbortSignal) => request<Record<string, number[]>>('sparklines', signal, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({symbols: symbols.map(stockSymbolCode)}),
    }),
    sectorMap: async (market: StockMarket, signal: AbortSignal, language = 'en') => normalizeStockSectorMap(await request<MarketSectorMap>(`sector-map/${market}?language=${encodeURIComponent(language)}`, signal)),
    async symbols(market: StockMarket, signal: AbortSignal, language = 'en'): Promise<StockSymbol[]> {
        const symbols = await request<StockSymbol[]>(`symbols/${market}?language=${encodeURIComponent(language)}`, signal);
        return symbols.map(item => ({...normalizeStockSymbol(item), name: localizeStockName(item.name, language)}));
    },
    prices: (symbol: string, signal: AbortSignal) => request<DailyPrice[]>(
        `prices/${encodeURIComponent(stockSymbolCode(symbol))}`, signal, {cache: 'no-store'},
    ),
};
