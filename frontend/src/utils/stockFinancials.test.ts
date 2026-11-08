import {describe, it, expect} from 'vitest';
import {financialChange, formatFinancialAmount} from './stockFinancials';
import type {FinancialPeriod} from '../services/stockFinancials';

describe('financial formatting and comparisons', () => {
    it('uses Korean hundred millions while keeping EPS unscaled', () => {
        expect(formatFinancialAmount(171499470000000, 'revenue', 'ko', '억')).toBe('1,714,994.7억');
        expect(formatFinancialAmount(10733, 'eps', 'ko', '억')).toBe('10,733');
        expect(formatFinancialAmount(1500000000, 'revenue', 'en', '100M')).toBe('1.5B');
    });
    it('matches actual quarters instead of adjacent available rows', () => {
        const periods: FinancialPeriod[] = [
            {period: '2026-06-30', values: {revenue: 150}},
            {period: '2025-12-31', values: {revenue: 120}},
            {period: '2025-06-30', values: {revenue: 100}},
        ];
        expect(financialChange(periods, periods[0], 'revenue', 'qoq', 'quarterly')).toBeNull();
        expect(financialChange(periods, periods[0], 'revenue', 'yoy', 'quarterly')).toBe(50);
    });
    it('handles negative and zero baselines without inverted signs or infinity', () => {
        const periods: FinancialPeriod[] = [
            {period: '2026-06-30', values: {netIncome: -50, revenue: 10}},
            {period: '2026-03-31', values: {netIncome: -100, revenue: 0}},
        ];
        expect(financialChange(periods, periods[0], 'netIncome', 'qoq', 'quarterly')).toBe(50);
        expect(financialChange(periods, periods[0], 'revenue', 'qoq', 'quarterly')).toBeNull();
        expect(financialChange(periods, periods[0], 'netIncome', 'qoq', 'yearly')).toBeNull();
    });
});
