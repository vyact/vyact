import {describe, expect, it} from 'vitest';
import type {DailyPrice, StockInvestorTrade} from '../../services/stockAnalysis';
import {availableInvestorGroups, historyChangePercent, investorPeriodStats, investorSummary, tradeValue} from './historyData';

const row = (day: string, trade?: StockInvestorTrade): DailyPrice => ({day, open: 10, high: 12, low: 9, close: 11, volume: 100, investors: trade ? {ind: trade} : undefined});

describe('investor history statistics', () => {
    it('weights average prices by volume using only matched dates and handles signed sell data', () => {
        const rows = [row('2026-01-01', {buyAmount: 100, buyVolume: 10, sellAmount: -120, sellVolume: -10}),
            row('2026-01-02', {buyAmount: 600, buyVolume: 30, sellAmount: -300, sellVolume: -20}),
            row('2026-01-03', {buyAmount: 9999}), row('2026-01-04', {buyVolume: 0, buyAmount: 100}), row('2026-01-05')];
        expect(investorSummary(rows, 'ind', 'buyAverage')).toEqual({value: 17.5, days: 2});
        expect(investorSummary(rows, 'ind', 'sellAverage')).toEqual({value: 14, days: 2});
    });
    it('preserves reported net values and derives missing net values only with both sides', () => {
        expect(tradeValue({netVolume: 0, buyVolume: 10, sellVolume: 4}, 'netVolume')).toBe(0);
        expect(tradeValue({buyAmount: 100, sellAmount: -140}, 'netAmount')).toBe(-40);
        expect(tradeValue({buyAmount: 100}, 'netAmount')).toBeNull();
        expect(investorSummary([row('2026-01-01', {netAmount: 0}), row('2026-01-02'), row('2026-01-03', {netAmount: -30})], 'ind', 'netAmount')).toEqual({value: -30, days: 2});
    });
    it('distinguishes unavailable data from zero and ignores nonfinite values', () => {
        const rows = [row('2026-01-01'), row('2026-01-02', {netVolume: NaN})];
        expect(availableInvestorGroups(rows)).toEqual([]);
        expect(investorSummary(rows, 'ind', 'netAmount')).toEqual({value: null, days: 0});
        expect(availableInvestorGroups([row('2026-01-01', {netVolume: 0})])).toEqual(['ind']);
    });
});


describe('history daily change', () => {
    it('prefers the provider rate, including zero', () => {
        expect(historyChangePercent({...row('2026-01-02'), changePercent: -6.35}, row('2026-01-01'))).toBe(-6.35);
        expect(historyChangePercent({...row('2026-01-02'), changePercent: 0})).toBe(0);
    });
    it('derives from the preceding session and leaves the first observation unavailable', () => {
        expect(historyChangePercent({...row('2026-01-02'), close: 121}, {...row('2026-01-01'), close: 110})).toBeCloseTo(10);
        expect(historyChangePercent(row('2026-01-01'))).toBeNull();
    });
});


describe('period summary table', () => {
    it('uses the buy average for net buying and the negative sell average for net selling', () => {
        expect(investorPeriodStats([row('2026-01-01', {netVolume: 10, netAmount: 105, buyVolume: 20, buyAmount: 210, sellVolume: -10, sellAmount: -120})], 'ind'))
            .toEqual({netVolume: 10, netAmount: 105, averagePrice: 11});
        expect(investorPeriodStats([row('2026-01-01', {netVolume: -10, netAmount: -120, buyVolume: 10, buyAmount: 105, sellVolume: -20, sellAmount: -240})], 'ind'))
            .toEqual({netVolume: -10, netAmount: -120, averagePrice: -12});
    });
    it('distinguishes a missing average from zero net volume', () => {
        expect(investorPeriodStats([row('2026-01-01', {netVolume: -10})], 'ind').averagePrice).toBeNull();
        expect(investorPeriodStats([row('2026-01-01', {netVolume: 0})], 'ind').averagePrice).toBe(0);
    });
});
