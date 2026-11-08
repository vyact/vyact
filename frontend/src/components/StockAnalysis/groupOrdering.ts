import type {StockMarket} from '../../services/stockAnalysis';
import type {StockGroup} from './useStockGroups';

export function reorderItems<T>(items: T[], source: T, target: T, after: boolean): T[] {
    if (source === target || !items.includes(source) || !items.includes(target)) return items;
    const next = items.filter(item => item !== source);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source);
    return next;
}

export function reorderGroups(groups: StockGroup[], market: StockMarket, source: string, target: string, after: boolean): StockGroup[] {
    const ids = groups.filter(group => group.market === market).map(group => group.id);
    const ordered = reorderItems(ids, source, target, after);
    const byId = new Map(groups.map(group => [group.id, group]));
    let index = 0;
    return groups.map(group => group.market === market ? byId.get(ordered[index++])! : group);
}
