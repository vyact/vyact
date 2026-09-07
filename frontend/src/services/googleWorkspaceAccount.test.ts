import {afterEach, describe, expect, it, vi} from 'vitest';
import {createWorkspaceApi} from './api';

vi.mock('../i18n', async () => ({default: (await import('i18next')).default}));
afterEach(() => vi.unstubAllGlobals());

describe('Google workspace account isolation', () => {
    it('keeps list, detail, read and send requests bound to their client account', async () => {
        const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
        vi.stubGlobal('fetch', fetch);
        const first = createWorkspaceApi('google-workspace', 'first');
        const second = createWorkspaceApi('google-workspace', 'second');
        await Promise.all([
            first.getGoogleMailWorkspace('INBOX'),
            second.getGoogleMailWorkspace('SENT'),
            first.getGoogleMailMessage('message', 'INBOX'),
            second.markGoogleMailMessageRead('message'),
            first.sendGoogleMail(new FormData()),
        ]);
        const urls = fetch.mock.calls.map(([url]) => new URL(url, 'http://test'));
        expect(urls.map(url => url.searchParams.get('account_id')))
            .toEqual(['first', 'second', 'first', 'second', 'first']);
        expect(urls[0].searchParams.get('label')).toBe('INBOX');
        expect(urls[1].searchParams.get('label')).toBe('SENT');
    });
});
