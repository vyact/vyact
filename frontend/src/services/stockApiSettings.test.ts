import {afterEach, describe, expect, it, vi} from 'vitest';
import {EMPTY_STOCK_API_SETTINGS, prepareStockApiSettings, stockApiDraftSignature, stockApiExamples, stockApiSettings} from './stockApiSettings';

afterEach(() => vi.unstubAllGlobals());

describe('stock API settings validation', () => {
    it('parses POST bodies without changing placeholder strings or numeric types', () => {
        const draft = prepareStockApiSettings({...EMPTY_STOCK_API_SETTINGS,
            endpoints: {prices: {url: ' https://example.com/{symbol} ', method: 'POST', body: {}}}},
        {prices: '{"symbol":"{symbol}","limit":100}'});
        expect(draft.endpoints.prices).toEqual({url: 'https://example.com/{symbol}', method: 'POST', body: {symbol: '{symbol}', limit: 100}});
    });
    it('rejects invalid JSON and non-object request bodies before saving any market', () => {
        for (const body of ['{', '[]', 'null', '123']) {
            expect(() => prepareStockApiSettings({...EMPTY_STOCK_API_SETTINGS,
                endpoints: {prices: {url: '', method: 'POST', body: {}}}}, {prices: body})).toThrow();
        }
    });
    it('keeps saved header values private and permits explicit row deletion', () => {
        expect(prepareStockApiSettings({...EMPTY_STOCK_API_SETTINGS, headers: [{name: 'X-Key', hasValue: true}]}, {}).headers)
            .toEqual([{name: 'X-Key', value: undefined}]);
        expect(prepareStockApiSettings({...EMPTY_STOCK_API_SETTINGS, headers: []}, {}).headers).toEqual([]);
    });
    it('rejects empty, duplicate, reserved and injected headers', () => {
        for (const headers of [[{name: '', value: 'secret'}], [{name: 'Host', value: 'other'}], [{name: 'X-Key', value: 'a\nb'}],
            [{name: 'X-Key', value: ''}], [{name: 'X-Key', value: 'one'}, {name: 'x-key', value: 'two'}]]) {
            expect(() => prepareStockApiSettings({...EMPTY_STOCK_API_SETTINGS, headers}, {})).toThrow();
        }
    });
});

describe('unsaved stock API changes', () => {
    it('does not mark restored fields or empty default endpoints as changed', () => {
        const saved = stockApiDraftSignature(EMPTY_STOCK_API_SETTINGS, {});
        expect(stockApiDraftSignature({...EMPTY_STOCK_API_SETTINGS, endpoints: {prices: {url: 'https://example.com', method: 'GET', body: {}}}}, {})).not.toBe(saved);
        expect(stockApiDraftSignature({...EMPTY_STOCK_API_SETTINGS, apiKey: '', clearApiKey: false,
            headers: [], endpoints: {prices: {url: '', method: 'GET', body: {}}}}, {})).toBe(saved);
    });
    it('detects POST body edits but ignores JSON formatting changes', () => {
        const settings = {...EMPTY_STOCK_API_SETTINGS, endpoints: {prices: {url: '', method: 'POST' as const, body: {limit: 10}}}};
        const saved = stockApiDraftSignature(settings, {prices: '{"limit":10}'});
        expect(stockApiDraftSignature(settings, {prices: '{ "limit": 10 }'})).toBe(saved);
        expect(stockApiDraftSignature(settings, {prices: '{"limit":20}'})).not.toBe(saved);
        expect(stockApiDraftSignature(settings, {prices: '{'})).not.toBe(saved);
    });
});

describe('stock API request examples', () => {
    it('shows concrete values using the same periods as outgoing requests', () => {
        expect(stockApiExamples('KR', 'prices', 'ko').url).toBe('https://api.example.com/prices');
        expect(stockApiExamples('KR', 'prices', 'ko').actualUrl).toBe('https://api.example.com/prices?symbol=005930&period=10y&interval=1d');
        expect(stockApiExamples('KR', 'prices', 'ko').actualBody).toEqual({symbol: '005930', period: '10y', interval: '1d'});
        expect(stockApiExamples('US', 'sparkline').actualBody).toEqual({symbols: ['AAPL', 'MSFT'], period: '3mo', interval: '1d'});
        expect(stockApiExamples('KR', 'symbols', 'ko').actualBody).toEqual({market: 'KR', language: 'ko'});
        expect(stockApiExamples('KR', 'marketIndices', 'ko').actualBody).toEqual({market: 'KR', language: 'en'});
    });
});

describe('draft stock API validation request', () => {
    it('posts unsaved settings and sample values to the backend without saving', async () => {
        const result = {ok: true, code: 'valid', status: 200, count: 2, fields: []};
        const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>().mockResolvedValue(new Response(JSON.stringify(result), {status: 200}));
        vi.stubGlobal('fetch', fetch);
        const signal = new AbortController().signal;
        const settings = {...EMPTY_STOCK_API_SETTINGS, apiKey: 'draft-key', hasApiKey: true,
            endpoints: {sparkline: {url: 'https://example.com/draft/{symbol}', method: 'POST' as const, body: {symbol: '{symbol}'}}}};
        expect(await stockApiSettings.validate('KR', 'sparkline', settings, '005930, 000660', 'ko', signal, {period: '5y', interval: '1wk'})).toEqual(result);
        expect(fetch).toHaveBeenCalledOnce();
        const [url, options] = fetch.mock.calls[0];
        expect(url).toBe('/api/stock-analysis/api-settings/KR/validate/sparkline');
        expect(options.method).toBe('POST');
        expect(options.signal).toBe(signal);
        const payload = JSON.parse(options.body as string);
        expect(payload.settings.apiKey).toBe('draft-key');
        expect(payload.settings.endpoints.sparkline.url).toBe('https://example.com/draft/{symbol}');
        expect(payload.settings.hasApiKey).toBeUndefined();
        expect(payload.symbols).toEqual(['005930', '000660']);
        expect(payload.symbol).toBeUndefined();
        expect(payload.period).toBe('5y');
        expect(payload.interval).toBe('1wk');
        expect(payload.language).toBe('ko');
    });
});
