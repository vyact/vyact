import {useEffect, useState} from 'react';
import type {StockMarket} from '../../services/stockAnalysis';

const WATCHLIST_STORAGE_KEY = 'vyact:stock-analysis:watchlist:v1';
const watchlistKey = (market: StockMarket, symbol: string) => `${market}:${symbol}`;

function readWatchlist(): string[] {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY) ?? '[]');
        return Array.isArray(saved) ? [...new Set(saved.filter((value): value is string =>
            typeof value === 'string' && /^(KR|US):[A-Z0-9][A-Z0-9.-]{0,15}$/.test(value)))] : [];
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
