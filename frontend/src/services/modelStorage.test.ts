import {afterEach, describe, expect, it, vi} from 'vitest';
import {modelStorage} from './modelStorage';

afterEach(() => vi.unstubAllGlobals());
describe('model storage API error contract', () => {
    it('keeps the production error code so the UI can translate it', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 'storage_space', request_id: 'test'}), {status: 400})));
        await expect(modelStorage.plan('/Volumes/Models')).rejects.toThrow('storage_space');
    });
    it('keeps the conflict code when inference is busy', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 'storage_busy'}), {status: 409})));
        await expect(modelStorage.move('/Volumes/Models')).rejects.toThrow('storage_busy');
    });
});
