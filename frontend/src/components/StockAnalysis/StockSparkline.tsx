import {useEffect, useState} from 'react';
import {stockAnalysis} from '../../services/stockAnalysis';

export const SPARKLINE_TRADING_DAYS = 20;
const historyCache = new Map<string, {day: string; closes: number[]}>();

export function useSectorSparklines(symbols: string[], day: string) {
    const [histories, setHistories] = useState<Record<string, number[]>>({});
    const symbolsKey = symbols.join(',');
    useEffect(() => {
        const controller = new AbortController();
        const queue = symbolsKey.split(',').filter(Boolean);
        const run = async () => {
            while (queue.length && !controller.signal.aborted) {
                const symbol = queue.shift()!;
                let cached = historyCache.get(symbol);
                if (cached?.day !== day) {
                    try {
                        const closes = await stockAnalysis.sparkline(symbol, controller.signal);
                        cached = {day, closes};
                        historyCache.set(symbol, cached);
                    } catch {
                        continue;
                    }
                }
                if (!controller.signal.aborted) setHistories(current => ({...current, [symbol]: cached.closes}));
            }
        };
        void Promise.all(Array.from({length: 4}, run));
        return () => controller.abort();
    }, [symbolsKey, day]);
    return histories;
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
