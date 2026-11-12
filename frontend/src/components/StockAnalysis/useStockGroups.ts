import useCachedStockPreferences from './useCachedStockPreferences';
import {reorderGroups, reorderItems} from './groupOrdering';
import {STOCK_MARKETS, type StockMarket} from '../../services/stockAnalysis';

export type StockGroup = {id: string; market: StockMarket; name: string; symbols: string[]};
export const STOCK_GROUP_NAME_LIMIT = 60;
export const STOCK_GROUP_SIZE_LIMIT = 100;
const STORAGE_KEY = 'vyact:stock-analysis:groups:v1';

export function normalizeStockGroups(value: unknown): StockGroup[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value.flatMap(item => {
        if (!item || typeof item.id !== 'string' || ids.has(item.id) || !STOCK_MARKETS.includes(item.market)
            || typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.symbols)) return [];
        ids.add(item.id);
        return [{id: item.id, market: item.market as StockMarket, name: item.name.trim().slice(0, STOCK_GROUP_NAME_LIMIT),
            symbols: [...new Set<string>(item.symbols.filter((symbol: unknown): symbol is string =>
                typeof symbol === 'string' && /^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(symbol)))].slice(0, STOCK_GROUP_SIZE_LIMIT)}];
    });
}
export default function useStockGroups() {
    const {items: groups, setItems: setGroups, failed, retry} = useCachedStockPreferences('groups', STORAGE_KEY, normalizeStockGroups);
    return {groups, failed, retry,
        reorder: (market: StockMarket, source: string, target: string, after: boolean) => setGroups(current => reorderGroups(current, market, source, target, after)),
        reorderStock: (groupId: string, source: string, target: string, after: boolean) => setGroups(current => current.map(group => group.id === groupId
            ? {...group, symbols: reorderItems(group.symbols, source, target, after)} : group)),
        save: (group: StockGroup) => setGroups(current => normalizeStockGroups(current.some(item => item.id === group.id)
            ? current.map(item => item.id === group.id ? group : item) : [...current, group])),
        removeStock: (id: string, symbol: string) => setGroups(current => current.map(group => group.id === id
            ? {...group, symbols: group.symbols.filter(value => value !== symbol)} : group)),
        remove: (id: string) => setGroups(current => current.filter(item => item.id !== id)),
    };
}
