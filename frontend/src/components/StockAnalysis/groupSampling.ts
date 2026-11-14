import type {StockGroup} from './useStockGroups';

export const GROUP_SAMPLE_SIZES = [1, 2, 3, 5, 10] as const;
export const DEFAULT_GROUP_SAMPLE_SIZE = 3;

export function sampleGroupStocks(groups: StockGroup[], weights: Record<string, number>, limit: number): StockGroup[] {
    return groups.map(group => ({...group, totalStocks: group.symbols.length, selectionLimit: limit,
        symbols: [...group.symbols].filter(symbol => Number.isFinite(weights[symbol]) && weights[symbol] > 0)
            .sort((a, b) => weights[b] - weights[a] || a.localeCompare(b)).slice(0, limit)}));
}
