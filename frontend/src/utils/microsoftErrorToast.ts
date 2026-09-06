import i18n from 'i18next';
import {toast} from '../components/common/ToastNotifications/ToastNotifications';
import {ApiError} from './apiError';

export const MICROSOFT_ERROR_TOAST_DURATION = 15_000;
const DEFAULT_ERROR_DURATION = 5_000;
const PERMISSION_ERROR_DURATION = 10_000;
const lastShownAt = new Map<string, number>();
export type MicrosoftErrorFeedback = 'action' | 'list' | 'background';
const attentionCodes = new Set([
    'microsoft_account_suspended', 'microsoft_rate_limited',
    'microsoft_authentication_required', 'microsoft_permission_denied',
]);
const statusCodes: Record<number, string> = {
    401: 'microsoft_authentication_required',
    403: 'microsoft_permission_denied',
    404: 'microsoft_item_not_found',
    429: 'microsoft_rate_limited',
    502: 'microsoft_connection_failed',
    503: 'microsoft_connection_failed',
    504: 'microsoft_connection_failed',
};

/** Keep provider diagnostics out of user messages and distinguish passive loads from actions. */
export function handleMicrosoftApiError(error: unknown, feedback: MicrosoftErrorFeedback): ApiError {
    const original = error instanceof ApiError ? error : undefined;
    const code = original?.code && attentionCodes.has(original.code)
        ? original.code
        : original ? statusCodes[original.status ?? 0] || 'microsoft_request_failed'
            : 'microsoft_connection_failed';
    const message = i18n.t(`main:backendErrors.${code}`);
    const failure = new ApiError(message, original?.status, message, code, original?.requestId);
    // The request layer owns feedback, including intentional silence for passive loads.
    failure.feedbackHandled = true;
    if (feedback === 'background' || (feedback === 'list' && !attentionCodes.has(code))) return failure;
    const duration = code === 'microsoft_permission_denied' ? PERMISSION_ERROR_DURATION
        : attentionCodes.has(code) ? MICROSOFT_ERROR_TOAST_DURATION : DEFAULT_ERROR_DURATION;
    const now = Date.now();
    const previous = lastShownAt.get(code);
    if (previous === undefined || now - previous >= duration) {
        lastShownAt.set(code, now);
        toast.error(message, undefined, duration);
    }
    return failure;
}
