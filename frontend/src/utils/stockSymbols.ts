import type {MarketSectorMap} from '../services/stockAnalysis';

export const MARKET_INDEX_CODES = ['KS11', 'KQ11', 'GSPC', 'IXIC', 'RUT'] as const;

export function isMarketIndexSymbol(symbol: string): boolean {
    return MARKET_INDEX_CODES.some(code => code === stockSymbolCode(symbol));
}

const KOREAN_YAHOO_SYMBOL = /^([0-9][A-Z0-9]{5})\.(KS|KQ)$/;

export function stockSymbolCode(symbol: string): string {
    const code = symbol.replace(/^\^/, '');
    return MARKET_INDEX_CODES.some(index => index === code) ? code : symbol.replace(KOREAN_YAHOO_SYMBOL, '$1');
}

export function normalizeStockSymbol<T extends {symbol: string}>(stock: T): T {
    const match = KOREAN_YAHOO_SYMBOL.exec(stock.symbol);
    return {...stock, symbol: stockSymbolCode(stock.symbol),
        ...(match ? {exchange: match[2] === 'KS' ? 'KOSPI' : 'KOSDAQ'} : {})};
}

export function normalizeStockSectorMap(snapshot: MarketSectorMap): MarketSectorMap {
    return {...snapshot, sectors: snapshot.sectors.map(sector => ({...sector, stocks: sector.stocks.map(normalizeStockSymbol)}))};
}

export function stockWatchlistKey(market: string, symbol: string): string {
    return `${market}:${market === 'KR' ? stockSymbolCode(symbol) : symbol}`;
}
