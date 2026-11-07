import type {StockMarket} from '../../services/stockAnalysis';

const MARKET_TIME_ZONES: Record<StockMarket, string> = {KR: 'Asia/Seoul', US: 'America/New_York'};

export function isMarketWeekend(market: StockMarket, now = new Date()): boolean {
    const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: MARKET_TIME_ZONES[market], weekday: 'short',
    }).format(now);
    return weekday === 'Sat' || weekday === 'Sun';
}
