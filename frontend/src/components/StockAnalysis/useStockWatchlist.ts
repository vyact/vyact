import {stockWatchlistKey} from '../../utils/stockSymbols';
import {useEffect, useState} from 'react';
import type {StockMarket} from '../../services/stockAnalysis';

const WATCHLIST_STORAGE_KEY = 'vyact:stock-analysis:watchlist:v1';
const watchlistKey = stockWatchlistKey;

function readWatchlist(): string[] {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY) ?? '[]');
        return Array.isArray(saved) ? [...new Set(saved.filter((value): value is string =>
            typeof value === 'string' && /^(KR|US|JP|TW|HK|CN):[A-Z0-9][A-Z0-9.-]{0,15}$/.test(value)).map(value => {
                const [market, symbol] = value.split(':');
                return watchlistKey(market, symbol);
            }))] : [];
    } catch {return [];}
}

export default function useStockWatchlist() {
    const [entries, setEntries] = useState(readWatchlist);
    useEffect(() => {
        try {localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(entries));} catch { /* Keep the current session usable. */ }
    }, [entries]);
    const contains = (market: StockMarket, symbol: string) => entries.includes(watchlistKey(market, symbol));
    const toggle = (market: StockMarket, symbol: string) => {
        const key = watchlistKey(market, symbol);
        setEntries(previous => previous.includes(key) ? previous.filter(entry => entry !== key) : [...previous, key]);
    };
    return {contains, toggle};
}
