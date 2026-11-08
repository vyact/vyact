import {useEffect, useState} from 'react';
import {stockAnalysis} from '../../services/stockAnalysis';

export const SPARKLINE_TRADING_DAYS = 20;
const historyCache = new Map<string, {day: string; closes: number[]}>();

export function useSectorSparklines(symbols: string[], day: string) {
    const [histories, setHistories] = useState<{day: string; values: Record<string, number[]>}>({day, values: {}});
    const symbolsKey = symbols.join(',');
    useEffect(() => {
        const controller = new AbortController();
        const requested = symbolsKey.split(',').filter(Boolean);
        const cached = Object.fromEntries(requested.filter(symbol => historyCache.get(symbol)?.day === day)
            .map(symbol => [symbol, historyCache.get(symbol)!.closes]));
        const missing = requested.filter(symbol => !(symbol in cached));
        const run = async () => {
            const batchSize = 50;
            for (let start = 0; start < missing.length && !controller.signal.aborted; start += batchSize) {
                try {
                    const batch = await stockAnalysis.sparklines(missing.slice(start, start + batchSize), controller.signal);
                    if (controller.signal.aborted) return;
                    Object.entries(batch).forEach(([symbol, closes]) => historyCache.set(symbol, {day, closes}));
                    setHistories(current => ({day, values: {...(current.day === day ? current.values : {}), ...batch}}));
                } catch {
                    // Keep available mini charts when a batch cannot be loaded.
                }
            }
        };
        void run();
        return () => controller.abort();
    }, [symbolsKey, day]);
    return Object.fromEntries(symbols.flatMap(symbol => {
        const cached = historyCache.get(symbol);
        const closes = cached?.day === day ? cached.closes : histories.day === day ? histories.values[symbol] : undefined;
        return closes ? [[symbol, closes]] : [];
    }));
}

export default function StockSparkline({closes, change}: {closes?: number[]; change?: number | null}) {
    if (!closes || closes.length < 2) return <span className="stock-sparkline-empty" aria-hidden="true">—</span>;
    const low = Math.min(...closes);
    const range = Math.max(...closes) - low;
    const points = closes.map((close, index) => `${2 + index / (closes.length - 1) * 76},${range ? 26 - (close - low) / range * 24 : 14}`).join(' ');
    return <svg className="stock-sparkline" data-direction={change == null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down'} viewBox="0 0 80 28" aria-hidden="true">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>;
}
