import {assertOk} from '../utils/apiError';

export type MicrosoftAccount = {id: string; mail_mode: 'readonly' | 'draft_only' | 'send'; mail_notifications: boolean};
export type MicrosoftConfig = {client_id: string; active_account_id: string; accounts: MicrosoftAccount[]; prompt?: string};
export type MicrosoftStatus = {redirect_uri?: string; authenticated: boolean; accounts: Array<{id: string; email: string; authenticated: boolean}>; config: MicrosoftConfig};
export const MICROSOFT_WORKSPACE_CHANGED = 'vyact:microsoft-workspace-changed';
export const OPEN_MICROSOFT_WORKSPACE = 'vyact:open-microsoft-workspace';
export async function microsoftRequest<T = MicrosoftStatus>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`/api/microsoft-workspace${path}`, {
        method, headers: body ? {'Content-Type': 'application/json'} : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    await assertOk(response);
    return response.json();
}
