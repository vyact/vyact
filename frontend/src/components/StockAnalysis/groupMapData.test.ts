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

it('shows the first 15 in user order rather than the 15 largest market caps', () => {
    const symbols = Array.from({length: 16}, (_, i) => `S${i}`);
    const allQuotes = symbols.map((symbol, i) => ({symbol, marketCap: i + 1, price: 100, change: 1, date: '2026-11-09'}));
    const first = buildGroupSectors([{...group, symbols}], allQuotes, [])[0];
    expect(first.stocks.map(stock => stock.symbol)).toEqual(symbols.slice(0, 15));
    const reordered = [symbols[15], ...symbols.slice(0, 15)];
    const second = buildGroupSectors([{...group, symbols: reordered}], allQuotes, [])[0];
    expect(second.stocks.map(stock => stock.symbol)).toEqual(reordered.slice(0, 15));
});

it('keeps every group and applies the 15-stock limit independently', () => {
    const symbols = Array.from({length: 20}, (_, i) => `S${i}`);
    const allQuotes = symbols.map(symbol => ({symbol, marketCap: 100, price: 100, change: 1, date: '2026-11-09'}));
    const result = buildGroupSectors([{...group, symbols}, {...group, id: 'other', name: 'Other', symbols: [...symbols].reverse()}], allQuotes, []);
    expect(result.map(item => item.stocks.length)).toEqual([15, 15]);
    expect(result[0].stocks[0].symbol).toBe('S0');
    expect(result[1].stocks[0].symbol).toBe('S19');
});
