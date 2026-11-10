import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import type {SectorStock} from '../../services/stockAnalysis';
import {SectorPreview} from './StockSectorMap';

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key, i18n: {resolvedLanguage: 'en'}})}));
vi.mock('./StockSparkline', async importOriginal => {
    const actual = await importOriginal<typeof import('./StockSparkline')>();
    return {...actual, useSectorSparklines: () => ({NVDA: [186.64, 178.67]})};
});

const stock: SectorStock = {symbol: 'NVDA', name: 'NVIDIA', weight: 1000, price: 179.38, change: 0.4,
    regularPrice: 178.67, regularChange: -4.27, quoteTime: '2026-11-10T11:40:00Z'};
function preview(item = stock, premarket = true) {
    return renderToStaticMarkup(<SectorPreview market="US" day="2026-11-09" premarket={premarket}
        sector={{name: 'Technology', weight: 1000, change: item.change, stocks: [item]}} focused={item}/>);
}

describe('premarket sector preview', () => {
    it('separates regular-close history from premarket prices and changes', () => {
        const html = preview();
        expect(html).toContain('stockAnalysis.mapTrendDays');
        expect(html).toContain('stockAnalysis.premarket.regularClose');
        expect(html).toContain('$178.67');
        expect(html).toContain('$179.38');
        expect(html).toContain('+0.40%');
        expect(html.match(/class="stock-sparkline" data-direction="down"/g)).toHaveLength(2);
        expect(html).toContain('data-direction="up"');
    });
    it('does not substitute a regular close when premarket quotes are missing', () => {
        const html = preview({...stock, price: null, change: null, quoteTime: undefined});
        const selectedQuote = html.split('stock-sector-preview-selected-quote')[1].split('stock-sector-preview-regular-price')[0];
        expect(selectedQuote).not.toContain('$178.67');
        expect(selectedQuote).toContain('—');
        expect(html).not.toContain('+0.40%');
    });
    it('keeps the regular preview layout outside premarket', () => {
        const html = preview({...stock, price: 178.67, change: -4.27}, false);
        expect(html).toContain('stockAnalysis.mapTrendDays');
        expect(html).not.toContain('stockAnalysis.premarket.label');
        expect(html).not.toContain('stock-sector-preview-regular');
    });
});
