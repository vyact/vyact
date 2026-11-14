import {stockAnalysis, type StockMarket} from '../../services/stockAnalysis';
import {MARKET_TIME_ZONES, isMarketWeekend} from './marketRefresh';
import {MARKET_INDEX_LABELS} from './marketIndexLabels';

const RETRY_INTERVAL_MS = 5 * 60 * 1000;
const cache = new Map<StockMarket, {day: string; dates: string[]; fetchedAt: number}>();
const pending = new Map<StockMarket, Promise<string[]>>();

/** Cache only calendar dates; chart quotes continue to use their normal refresh policy. */
export function loadMarketContextDates(market: StockMarket): Promise<string[]> {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone: MARKET_TIME_ZONES[market], year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    const day = `${part('year')}-${part('month')}-${part('day')}`;
    const saved = cache.get(market);
    if (saved?.day === day && (saved.dates.includes(day) || isMarketWeekend(market, now) || now.getTime() - saved.fetchedAt < RETRY_INTERVAL_MS)) {
        return Promise.resolve(saved.dates);
    }
    const running = pending.get(market);
    if (running) return running;
    const request = stockAnalysis.prices(MARKET_INDEX_LABELS[market][0].symbol, new AbortController().signal)
        .then(rows => {
            const dates = [...new Set(rows.map(row => row.day))].sort();
            if (dates.length) cache.set(market, {day, dates, fetchedAt: now.getTime()});
            return dates;
        }).finally(() => pending.delete(market));
    pending.set(market, request);
    return request;
}
