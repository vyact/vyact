import {describe, expect, it} from 'vitest';
import {buildGroupSectors} from './groupMapData';
import type {StockQuote} from '../../services/stockAnalysis';
const group = {id: 'g', market: 'KR' as const, name: 'Group', symbols: ['005930', '000660', '000020']};
const quotes: StockQuote[] = [
    {symbol: '005930', marketCap: 300, price: 100, change: 2, date: '2026-11-06'},
    {symbol: '000660', marketCap: 100, price: 200, change: -4, date: '2026-11-06'},
];

describe('group heatmap market caps', () => {
    it('uses market cap as area and computes a cap-weighted group change', () => {
        const result = buildGroupSectors([group], quotes, [{symbol: '005930', name: 'Samsung'}])[0];
        expect(result.weight).toBe(400);
        expect(result.stocks.map(stock => stock.weight)).toEqual([300, 100]);
        expect(result.change).toBe(.5);
        expect(result.stocks[0].name).toBe('Samsung');
    });
    it('excludes missing, nonpositive and nonfinite caps instead of assigning equal areas', () => {
        expect(buildGroupSectors([group], [], [])).toEqual([]);
        expect(buildGroupSectors([group], quotes.map(quote => ({...quote, marketCap: 0})), [])).toEqual([]);
        expect(buildGroupSectors([group], quotes.map(quote => ({...quote, marketCap: NaN})), [])).toEqual([]);
    });
    it('allows the same stock in different groups without mixing group totals', () => {
        const result = buildGroupSectors([group, {...group, id: 'g2', name: 'Other', symbols: ['000660']}], quotes, []);
        expect(result.map(item => item.weight)).toEqual([400, 100]);
    });
});
