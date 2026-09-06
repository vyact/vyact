import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createWorkspaceApi} from './api';
import {MICROSOFT_ERROR_TOAST_DURATION} from '../utils/microsoftErrorToast';
import i18n from 'i18next';
import {microsoftRequest} from './microsoftWorkspace';
import {microsoftFetch} from './microsoftFetch';
import {ApiError} from '../utils/apiError';
import {notifyWorkspaceError} from '../utils/workspaceError';
import {toast} from '../components/common/ToastNotifications/ToastNotifications';
import main from '../i18n/locales/ko/main.json';

vi.mock('../i18n', async () => ({default: (await import('i18next')).default}));

beforeAll(async () => {
    await i18n.init({lng: 'ko', resources: {ko: {main}}});
});
let testTime = Date.parse('2030-01-01');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(testTime += 60_000); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Microsoft workspace error feedback', () => {
    it.each([
        [403, 'microsoft_account_suspended'],
        [429, 'microsoft_rate_limited'],
    ] as const)('shows a 15 second toast for %s even when the loader swallows errors', async (status, code) => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
            new Response(JSON.stringify({code}), {status}),
        )));
        const show = vi.spyOn(toast, 'error');
        const api = createWorkspaceApi('microsoft-workspace', 'test');
        await api.getGoogleMailWorkspace('INBOX').catch(() => {});
        expect(show).toHaveBeenCalledExactlyOnceWith(main.backendErrors[code], undefined, 15_000);
        await api.sendGoogleMail(new FormData()).catch(notifyWorkspaceError);
        expect(show).toHaveBeenCalledOnce();
        vi.setSystemTime(Date.now() + MICROSOFT_ERROR_TOAST_DURATION);
        await microsoftRequest('/mail/send', 'POST').catch(notifyWorkspaceError);
        expect(show).toHaveBeenCalledTimes(2);
    });

    it('preserves a failed activation response and shows a localized reconnect toast', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            code: 'authentication_required', request_id: 'test-request',
        }), {status: 401})));
        const show = vi.spyOn(toast, 'error');
        let failure: unknown;
        try { await microsoftRequest('/accounts/test/activate', 'POST'); }
        catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({status: 401, code: 'microsoft_authentication_required', requestId: 'test-request'});
        notifyWorkspaceError(failure);
        expect(show).toHaveBeenCalledExactlyOnceWith(main.backendErrors.microsoft_authentication_required, undefined, 15_000);
    });

    it('shows permission failures without incorrectly requesting reauthentication', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 'permission_denied'}), {status: 403})));
        const show = vi.spyOn(toast, 'error');
        await microsoftRequest('/accounts/test/activate', 'POST').catch(notifyWorkspaceError);
        expect(show).toHaveBeenCalledOnce();
        expect(show).toHaveBeenCalledExactlyOnceWith(main.backendErrors.microsoft_permission_denied, undefined, 10_000);
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

describe('Microsoft request context', () => {
    it.each([
        [401, 'microsoft_authentication_required', 15_000],
        [403, 'microsoft_permission_denied', 10_000],
    ] as const)('alerts on account problems during list loading (%s)', async (status, code, duration) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {status})));
        const show = vi.spyOn(toast, 'error');
        await createWorkspaceApi('microsoft-workspace').getGoogleDriveFiles().catch(() => {});
        expect(show).toHaveBeenCalledExactlyOnceWith(main.backendErrors[code], undefined, duration);
    });

    it.each([401, 403, 404, 429, 503])('keeps background status failures quiet (%s)', async status => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {status})));
        const show = vi.spyOn(toast, 'error');
        await microsoftRequest('/status').catch(notifyWorkspaceError);
        expect(show).not.toHaveBeenCalled();
    });

    it.each([400, 404, 422, 503])('keeps list errors available for inline feedback without a toast (%s)', async status => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', {status}))));
        const show = vi.spyOn(toast, 'error');
        const api = createWorkspaceApi('microsoft-workspace');
        for (const load of [() => api.getGoogleMailWorkspace(), () => api.getGoogleDriveFiles(), () => api.getGoogleCalendarEvents()]) {
            await expect(load()).rejects.toMatchObject({status, feedbackHandled: true, detail: expect.any(String)});
        }
        expect(show).not.toHaveBeenCalled();
    });

    it.each([
        [404, 'microsoft_item_not_found'],
        [400, 'microsoft_request_failed'],
        [422, 'microsoft_request_failed'],
        [503, 'microsoft_connection_failed'],
    ] as const)('shows actionable localized feedback for a direct operation (%s)', async (status, code) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({message: 'private diagnostics'}), {status})));
        const show = vi.spyOn(toast, 'error');
        await createWorkspaceApi('microsoft-workspace').getGoogleMailMessage('missing').catch(notifyWorkspaceError);
        expect(show).toHaveBeenCalledExactlyOnceWith(main.backendErrors[code], undefined, 5_000);
    });

    it('handles network failures differently for lists, background checks and direct actions', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('private host details')));
        const show = vi.spyOn(toast, 'error');
        await expect(createWorkspaceApi('microsoft-workspace').getGoogleDriveFiles())
            .rejects.toMatchObject({code: 'microsoft_connection_failed', detail: main.backendErrors.microsoft_connection_failed});
        await microsoftRequest('/status').catch(notifyWorkspaceError);
        expect(show).not.toHaveBeenCalled();
        await createWorkspaceApi('microsoft-workspace').sendGoogleMail(new FormData()).catch(notifyWorkspaceError);
        expect(show).toHaveBeenCalledExactlyOnceWith(main.backendErrors.microsoft_connection_failed, undefined, 5_000);
    });

    it('does not toast an explicitly cancelled request', async () => {
        const error = new DOMException('Aborted', 'AbortError');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
        const show = vi.spyOn(toast, 'error');
        await expect(microsoftFetch('/api/microsoft-workspace/drive/files')).rejects.toBe(error);
        expect(show).not.toHaveBeenCalled();
    });

    it('does not apply Microsoft feedback to Google requests', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 'permission_denied'}), {status: 403})));
        const show = vi.spyOn(toast, 'error');
        await expect(createWorkspaceApi().getGoogleMailWorkspace()).rejects.toMatchObject({code: 'permission_denied', feedbackHandled: false});
        expect(show).not.toHaveBeenCalled();
    });
});

describe('Microsoft cooldown feedback', () => {
    it('shows the server remaining seconds and updates them on a later attempt', async () => {
        const show = vi.spyOn(toast, 'error');
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({code: 'microsoft_rate_limited'}), {status: 429, headers: {'Retry-After': '60'}}))
            .mockResolvedValueOnce(new Response(JSON.stringify({code: 'microsoft_rate_limited'}), {status: 429, headers: {'Retry-After': '40'}}));
        vi.stubGlobal('fetch', fetch);
        const first = await microsoftRequest('/mail/workspace').catch(error => error);
        expect(first).toMatchObject({retryAfterSeconds: 60, code: 'microsoft_rate_limited'});
        expect(show).toHaveBeenLastCalledWith(main.backendErrors.microsoft_rate_limited_retry.replace('{{seconds}}', '60'), undefined, 15_000);
        vi.setSystemTime(Date.now() + 20_000);
        await microsoftRequest('/mail/workspace').catch(notifyWorkspaceError);
        expect(show).toHaveBeenLastCalledWith(main.backendErrors.microsoft_rate_limited_retry.replace('{{seconds}}', '40'), undefined, 15_000);
    });

    it('keeps timed background failures silent', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 'microsoft_rate_limited'}), {status: 429, headers: {'Retry-After': '90'}})));
        const show = vi.spyOn(toast, 'error');
        await microsoftRequest('/status').catch(notifyWorkspaceError);
        expect(show).not.toHaveBeenCalled();
    });
});
