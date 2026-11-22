import {STOCK_MARKETS, type StockMarket} from '../../../services/stockAnalysis';

const STORAGE_KEY = 'vyact:stock-chat-scope';
export const STOCK_SYMBOL = /^[A-Z0-9^][A-Z0-9.:^=_-]{0,49}$/i;

export type StockChatScope = {
    market: StockMarket | '';
    symbol?: string;
    stockName?: string;
};

export function readStockChatScope(): StockChatScope {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        if (saved && typeof saved === 'object' && 'market' in saved) {
            const market = STOCK_MARKETS.find(candidate => candidate === saved.market);
            if (market) {
                const symbol = 'symbol' in saved && typeof saved.symbol === 'string' && STOCK_SYMBOL.test(saved.symbol)
                    ? saved.symbol : undefined;
                const stockName = symbol && 'stockName' in saved && typeof saved.stockName === 'string'
                    ? saved.stockName : undefined;
                return {market, symbol, stockName};
            }
        }
    } catch { /* Optional chat preference. */ }
    return {market: ''};
}

export function saveStockChatScope(scope: StockChatScope) {
    try {localStorage.setItem(STORAGE_KEY, JSON.stringify(scope));} catch { /* Optional chat preference. */ }
}
