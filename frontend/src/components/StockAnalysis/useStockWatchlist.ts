import {stockWatchlistKey} from '../../utils/stockSymbols';
import useCachedStockPreferences from './useCachedStockPreferences';
import type {StockMarket} from '../../services/stockAnalysis';

const WATCHLIST_STORAGE_KEY = 'vyact:stock-analysis:watchlist:v1';
const watchlistKey = stockWatchlistKey;

export function normalizeWatchlist(saved: unknown): string[] {
    return Array.isArray(saved) ? [...new Set(saved.filter((value): value is string =>
        typeof value === 'string' && /^(KR|US|JP|TW|HK|CN):[A-Z0-9][A-Z0-9.-]{0,15}$/.test(value)).map(value => {
            const [market, symbol] = value.split(':');
            return watchlistKey(market, symbol);
        }))] : [];
}

export default function useStockWatchlist() {
    const {items: entries, setItems: setEntries, failed, retry} = useCachedStockPreferences('watchlist', WATCHLIST_STORAGE_KEY, normalizeWatchlist);
    const contains = (market: StockMarket, symbol: string) => entries.includes(watchlistKey(market, symbol));
    const toggle = (market: StockMarket, symbol: string) => {
        const key = watchlistKey(market, symbol);
        setEntries(previous => previous.includes(key) ? previous.filter(entry => entry !== key) : [...previous, key]);
    };
    return {contains, toggle, failed, retry};
}
