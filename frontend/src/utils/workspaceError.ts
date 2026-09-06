import i18n from 'i18next';
import {ApiError, formatApiErrorForUser} from './apiError';
import {toast} from '../components/common/ToastNotifications/ToastNotifications';

export function notifyWorkspaceError(error: unknown): string {
    if (error instanceof ApiError && error.feedbackHandled) return error.detail || error.message;
    const message = error instanceof ApiError && (error.status === 401 || error.code === 'authentication_required')
        ? i18n.t('main:googleWorkspace.reconnectAccount')
        : error instanceof ApiError
            ? formatApiErrorForUser(error)
            : i18n.t('main:backendErrors.request_failed');
    toast.error(message);
    return message;
}

export function workspaceLoadErrorMessage(error: unknown): string {
    return error instanceof ApiError ? error.detail || error.message : i18n.t('main:backendErrors.request_failed');
}
