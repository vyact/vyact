import {afterEach, describe, expect, it, vi} from 'vitest';
vi.mock('../i18n', () => ({default: {t: (key: string) => key, exists: () => false}}));
import {api, createWorkspaceApi} from './api';
afterEach(() => vi.unstubAllGlobals());
describe('workspace request isolation', () => {
    it('keeps the Google endpoint unchanged', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response('{}'));
        vi.stubGlobal('fetch', fetch);
        await api.getGoogleMailMessage('a/b');
        expect(fetch.mock.calls[0][0]).toBe('/api/google-workspace/mail/messages/a%2Fb?label=INBOX');
    });
    it('pins both Microsoft request paths to the selected account', async () => {
        const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
        vi.stubGlobal('fetch', fetch);
        const microsoft = createWorkspaceApi('microsoft-workspace', 'two');
        await microsoft.getGoogleMailMessage('a/b');
        await microsoft.getGoogleMailLabels();
        expect(fetch.mock.calls[0][0]).toBe('/api/microsoft-workspace/mail/messages/a%2Fb?label=INBOX&account_id=two');
        expect(fetch.mock.calls[1][0]).toBe('/api/microsoft-workspace/mail/labels?account_id=two');
    });
    it('does not deduplicate across accounts or providers', async () => {
        const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
        vi.stubGlobal('fetch', fetch);
        await Promise.all([api.getGoogleMailWorkspace(), createWorkspaceApi('microsoft-workspace', 'one').getGoogleMailWorkspace(), createWorkspaceApi('microsoft-workspace', 'two').getGoogleMailWorkspace()]);
        expect(fetch).toHaveBeenCalledTimes(3);
    });
    it('keeps common APIs outside the Microsoft account scope', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response('{}'));
        vi.stubGlobal('fetch', fetch);
        await createWorkspaceApi('microsoft-workspace', 'one').getNotifications();
        expect(fetch.mock.calls[0][0]).toBe('/api/notifications?limit=30&offset=0');
    });
});
