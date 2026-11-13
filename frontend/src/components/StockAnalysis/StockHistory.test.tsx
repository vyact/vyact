import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import type {DailyPrice} from '../../services/stockAnalysis';
import StockHistory from './StockHistory';

vi.mock('react-i18next', () => ({useTranslation: () => ({
    t: (key: string) => key, i18n: {resolvedLanguage: 'en'},
})}));

const row: DailyPrice = {day: '2026-11-13', open: 100, high: 110, low: 90, close: 105, volume: 1000};
const render = (fields: Partial<DailyPrice>) => renderToStaticMarkup(<StockHistory market="KR" rows={[{...row, ...fields}]}/>);

describe('optional history columns', () => {
    it('hides absent or null market cap and loan balances', () => {
        for (const fields of [{}, {marketCap: null, loanBalanceVolume: null, loanBalanceAmount: null}]) {
            const html = render(fields);
            expect(html).not.toContain('stockAnalysis.history.marketCap');
            expect(html).not.toContain('stockAnalysis.history.loanBalanceVolume');
        }
    });

    it('shows zero balances and calculates ratios using that day’s shares', () => {
        const html = render({marketCap: 1000000, sharesOutstanding: 10000, loanBalanceVolume: 0, loanBalanceAmount: 0});
        expect(html).toContain('stockAnalysis.history.marketCap');
        expect(html).toContain('stockAnalysis.history.loanBalanceVolume');
        expect(html).toContain('(0%)');
        expect(render({sharesOutstanding: 10000, loanBalanceVolume: 568})).toContain('(5.68%)');
        expect(render({sharesOutstanding: null, loanBalanceVolume: 568})).not.toContain('(5.68%)');
    });
});
