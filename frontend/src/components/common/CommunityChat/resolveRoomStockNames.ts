import {STOCK_MARKETS, stockAnalysis, type StockMarket, type StockSymbol} from '../../../services/stockAnalysis';
import {MARKET_INDEX_LABELS} from '../../StockAnalysis/marketIndexLabels';

export function createRoomStockNameResolver(language: string, signal: AbortSignal, indexName: (key: string) => string) {
    const directories = new Map<StockMarket, Promise<Map<string, string>>>();
    const marketDirectory = (market: StockMarket) => {
        const pending = directories.get(market);
        if (pending) return pending;
        const request = stockAnalysis.symbols(market, signal, language).then((rows: StockSymbol[]) =>
            new Map(rows.map(({symbol, name}) => [symbol.toUpperCase(), name])));
        directories.set(market, request);
        void request.catch(() => directories.delete(market));
        return request;
    };
    return async (keys: unknown) => {
        if (!Array.isArray(keys) || keys.length > 200) return [];
        const names = await Promise.all([...new Set(keys)].map(async key => {
            if (typeof key !== 'string' || !/^(KR|US|JP|TW|HK|CN):[A-Z0-9^][A-Z0-9.:^=_-]{0,96}$/.test(key)) return null;
            const market = STOCK_MARKETS.find(item => key.startsWith(item + ':'));
            if (!market) return null;
            const symbol = key.slice(market.length + 1);
            const index = MARKET_INDEX_LABELS[market].find(item => item.symbol === symbol);
            const name = index ? indexName(index.key) : (await marketDirectory(market).catch(() => undefined))?.get(symbol);
            return name ? {key, name} : null;
        }));
        return names.filter(name => name !== null);
    };
}
