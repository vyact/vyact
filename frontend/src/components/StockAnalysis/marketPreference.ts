import type {StockMarket} from '../../services/stockAnalysis';

const MARKET_STORAGE_KEY = 'vyact:stock-analysis:market';
let sessionMarket: StockMarket | undefined;

export function getInitialMarket(language: string | undefined): StockMarket {
    try {
        const saved = localStorage.getItem(MARKET_STORAGE_KEY);
        if (saved === 'KR' || saved === 'US' || saved === 'JP') return saved;
    } catch {
        // Keep the last selection for this session when storage is unavailable.
    }
    const locale = language?.toLowerCase().split(/[-_]/)[0];
    return sessionMarket ?? (locale === 'ko' ? 'KR' : locale === 'ja' ? 'JP' : 'US');
}

export function saveMarketPreference(market: StockMarket): void {
    sessionMarket = market;
    try {localStorage.setItem(MARKET_STORAGE_KEY, market);} catch { /* Session preference remains available. */ }
}
