import {afterEach, describe, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {assertOk, ApiError} from './apiError';
import {notifyWorkspaceError} from './workspaceError';
import {toast} from '../components/common/ToastNotifications/ToastNotifications';
import main from '../i18n/locales/ko/main.json';

vi.mock('../i18n', async () => ({default: (await import('i18next')).default}));
afterEach(() => vi.restoreAllMocks());

describe('Gmail filter permission feedback', () => {
    it('shows reconnect guidance for the actual code-only backend payload', async () => {
        await i18n.init({lng: 'ko', resources: {ko: {main}}});
        const showError = vi.spyOn(toast, 'error').mockImplementation(() => 'test');
        const error = await assertOk(new Response(JSON.stringify({code: 'gmail_filter_reconnect_required'}), {status: 403})).catch(error => error);
        expect(error).toBeInstanceOf(ApiError);
        expect(error.detail).toBe(main.googleWorkspace.spamFilterReconnect);
        notifyWorkspaceError(error);
        expect(showError).toHaveBeenCalledExactlyOnceWith(main.googleWorkspace.spamFilterReconnect);
    });
});
