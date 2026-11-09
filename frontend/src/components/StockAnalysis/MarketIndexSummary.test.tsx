import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {MarketIndex} from '../../services/stockAnalysis';
import MarketIndexSummary from './MarketIndexSummary';

const state = vi.hoisted(() => ({indices: [] as MarketIndex[]}));
vi.mock('../../services/stockSnapshotCache', () => ({stockSnapshotCache: {
    readIndices: () => state.indices,
}}));
vi.mock('react-i18next', () => ({useTranslation: () => ({
    t: (key: string) => key,
    i18n: {resolvedLanguage: 'en'},
})}));

beforeEach(() => {state.indices = [];});

describe('market summary instrument labels', () => {
    it('places futures in the corresponding cash-index slots with distinct names', () => {
        state.indices = [
            {symbol: 'ES=F', indexSymbol: 'GSPC', price: 7400, change: 20, changePercent: 0.27, date: '2026-11-09', closes: [7380, 7400]},
            {symbol: 'NQ=F', indexSymbol: 'IXIC', price: 27000, change: 50, changePercent: 0.19, date: '2026-11-09', closes: [26950, 27000]},
            {symbol: 'RTY=F', indexSymbol: 'RUT', price: 2700, change: 10, changePercent: 0.37, date: '2026-11-09', closes: [2690, 2700]},
        ];
        const html = renderToStaticMarkup(<MarketIndexSummary market="US" refreshSeconds={30} onOpen={vi.fn()}/>);
        expect(html).toContain('stockAnalysis.indexSp500Futures');
        expect(html).toContain('stockAnalysis.indexNasdaq100Futures');
        expect(html).toContain('stockAnalysis.indexRussell2000Futures');
        expect(html).toContain('27,000.00');
        expect(html.match(/class="stock-market-index"/g)).toHaveLength(3);
    });

    it('keeps Korean cash-index labels and ignores cached US futures', () => {
        state.indices = [{symbol: 'ES=F', indexSymbol: 'GSPC', price: 7400, change: 20, changePercent: 0.27, date: '2026-11-09', closes: []}];
        const html = renderToStaticMarkup(<MarketIndexSummary market="KR" refreshSeconds={30} onOpen={vi.fn()}/>);
        expect(html).toContain('stockAnalysis.indexKospi');
        expect(html).not.toContain('indexSp500Futures');
        expect(html.match(/class="stock-market-index"/g)).toHaveLength(2);
    });
    it('shows the Nikkei 225 in a Japanese market card', () => {
        state.indices = [{symbol: 'N225', price: 58775.5, change: 1340.73, changePercent: 2.33, date: '2026-11-09', closes: [58000, 58775.5]}];
        const html = renderToStaticMarkup(<MarketIndexSummary market="JP" refreshSeconds={30} onOpen={vi.fn()}/>);
        expect(html).toContain('stockAnalysis.indexNikkei225');
        expect(html).toContain('58,775.50');
        expect(html.match(/class="stock-market-index"/g)).toHaveLength(1);
        expect(html).not.toContain('stock-market-index-cash');
    });

});
