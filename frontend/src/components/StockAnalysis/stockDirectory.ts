import type {StockMarket, StockSymbol} from '../../services/stockAnalysis';
import {MARKET_INDEX_LABELS} from './marketIndexLabels';

export function withMarketIndices(market: StockMarket, symbols: StockSymbol[], translate: (key: string) => string): StockSymbol[] {
    const indices = MARKET_INDEX_LABELS[market].map(({symbol, key}) => ({symbol, name: translate(key)}));
    return [...new Map([...indices, ...symbols].map(item => [item.symbol, item])).values()];
}
