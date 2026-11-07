import type {StockMarket} from '../../services/stockAnalysis';

const MARKET_STORAGE_KEY = 'vyact:stock-analysis:market';
let sessionMarket: StockMarket | undefined;

export function getInitialMarket(language: string | undefined): StockMarket {
    try {
        const saved = localStorage.getItem(MARKET_STORAGE_KEY);
        if (saved === 'KR' || saved === 'US') return saved;
    } catch {
        // Keep the last selection for this session when storage is unavailable.
    }
    return sessionMarket ?? (language?.toLowerCase().split(/[-_]/)[0] === 'ko' ? 'KR' : 'US');
}

export function saveMarketPreference(market: StockMarket): void {
    sessionMarket = market;
    try {localStorage.setItem(MARKET_STORAGE_KEY, market);} catch { /* Session preference remains available. */ }
}
