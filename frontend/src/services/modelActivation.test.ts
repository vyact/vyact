import {afterEach, describe, expect, it, vi} from 'vitest';
vi.mock('../i18n', () => ({default: {t: (key: string) => key, exists: () => false}}));
import {api} from './api';

afterEach(() => vi.unstubAllGlobals());
const respond = (body: string, status = 200) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {status})));
describe('model activation completion', () => {
    it('rejects HTTP errors', async () => {
        respond('{}', 503);
        await expect(api.activateVyactModel('owner/model')).rejects.toBeDefined();
    });
    it('rejects a stream ending without completion', async () => {
        respond('data: {"type":"model_loading"}\n\n');
        await expect(api.activateVyactModel('owner/model')).rejects.toMatchObject({code: 'activation_incomplete', recovery: 'unknown'});
    });
    it.each(['restored', 'failed'])('preserves %s recovery status', async recovery => {
        respond(`data: ${JSON.stringify({type: 'error', message: 'load_failed', recovery})}\n\n`);
        await expect(api.activateVyactModel('owner/model')).rejects.toMatchObject({recovery});
    });
    it('reports MTP fallback only after completion', async () => {
        respond('data: {"type":"done","mtp_fallback":true}\n\n');
        await expect(api.activateVyactModel('owner/model')).resolves.toEqual({mtpFallback: true});
    });
});
