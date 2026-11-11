import {STOCK_MARKETS, type StockMarket, type PinnedMarketIndex} from '../../services/stockAnalysis';
import {MARKET_INDEX_LABELS} from './marketIndexLabels';

export const INDEX_DRAG_TYPE = 'application/x-vyact-market-index';
export const PINNED_INDICES_KEY = 'vyact:stock-analysis:pinned-indices:v1';
export type {PinnedMarketIndex} from '../../services/stockAnalysis';
export type MarketIndexDrag = PinnedMarketIndex & {pinned?: boolean};
export const pinnedIndexId = (item: PinnedMarketIndex) => `${item.market}:${item.symbol}`;
export function normalizePinnedIndices(value: unknown): PinnedMarketIndex[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.flatMap(item => {
        if (!item || !STOCK_MARKETS.includes(item.market)
            || !MARKET_INDEX_LABELS[item.market as StockMarket].some(label => label.symbol === item.symbol)) return [];
        const id = pinnedIndexId(item);
        if (seen.has(id)) return [];
        seen.add(id);
        return [{market: item.market as StockMarket, symbol: item.symbol as string}];
    });
}
export function parseIndexDrag(value: string): MarketIndexDrag | undefined {
    try {
        const raw = JSON.parse(value);
        const item = normalizePinnedIndices([raw])[0];
        return item ? {...item, pinned: raw.pinned === true} : undefined;
    } catch {return;}
}
export function movePinnedIndex(items: PinnedMarketIndex[], item: PinnedMarketIndex, target?: string, after = false): PinnedMarketIndex[] {
    const id = pinnedIndexId(item);
    if (target === id) return items;
    const next = items.filter(entry => pinnedIndexId(entry) !== id);
    const index = target ? next.findIndex(entry => pinnedIndexId(entry) === target) : -1;
    next.splice(index < 0 ? next.length : index + Number(after), 0, item);
    return next;
}
