import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {microsoftRequest} from './microsoftWorkspace';
import {ApiError} from '../utils/apiError';
import {notifyWorkspaceError} from '../utils/workspaceError';
import {toast} from '../components/common/ToastNotifications/ToastNotifications';
import main from '../i18n/locales/ko/main.json';

beforeAll(async () => {
    await i18n.init({lng: 'ko', resources: {ko: {main}}});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Microsoft workspace error feedback', () => {
    it('preserves a failed activation response and shows a localized reconnect toast', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 'authentication_required', request_id: 'test-request',
        }), {status: 401})));
        const show = vi.spyOn(toast, 'error');
        let failure: unknown;
        try { await microsoftRequest('/accounts/test/activate', 'POST'); }
        catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({status: 401, code: 'authentication_required', requestId: 'test-request'});
        notifyWorkspaceError(failure);
        expect(show).toHaveBeenCalledExactlyOnceWith(main.googleWorkspace.reconnectAccount);
    });

    it('shows permission failures without incorrectly requesting reauthentication', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 'permission_denied'}), {status: 403})));
        const show = vi.spyOn(toast, 'error');
        await microsoftRequest('/accounts/test/activate', 'POST').catch(notifyWorkspaceError);
        expect(show).toHaveBeenCalledOnce();
        expect(show.mock.calls[0][0]).toContain(main.backendErrors.permission_denied);
        expect(show.mock.calls[0][0]).not.toContain(main.googleWorkspace.reconnectAccount);
    });

    it('does not expose raw network exception details', () => {
        const show = vi.spyOn(toast, 'error');
        notifyWorkspaceError(new TypeError('private internal details'));
        expect(show).toHaveBeenCalledExactlyOnceWith(main.backendErrors.request_failed);
    });

    it('returns successful activation data without a toast', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ok: true}))));
        const show = vi.spyOn(toast, 'error');
        await expect(microsoftRequest('/accounts/test/activate', 'POST')).resolves.toEqual({ok: true});
        expect(show).not.toHaveBeenCalled();
    });
});
