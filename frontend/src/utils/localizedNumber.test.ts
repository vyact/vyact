import {beforeAll, afterEach, expect, it} from 'vitest';
import i18n from 'i18next';
import {formatLocalizedNumber} from './localizedNumber';
import {formatCompactDownloads, formatModelBytes} from './vyactModelDisplay';

beforeAll(async () => { await i18n.init({lng: 'en', resources: {}}); });
afterEach(async () => { await i18n.changeLanguage('en'); });
it('updates decimal formatting when the app language changes', async () => {
    expect(formatLocalizedNumber(1.25, 2)).toBe('1.25');
    await i18n.changeLanguage('fr');
    expect(formatLocalizedNumber(1.25, 2)).toBe('1,25');
    expect(formatModelBytes(1.5 * 1024 ** 3)).toBe('1,5 GB');
});
it('uses locale-specific compact download units', async () => {
    await i18n.changeLanguage('ja');
    expect(formatCompactDownloads(12000)).toBe(new Intl.NumberFormat('ja', {notation: 'compact', maximumFractionDigits: 1}).format(12000));
    expect(formatModelBytes(0)).toBe('—');
});
