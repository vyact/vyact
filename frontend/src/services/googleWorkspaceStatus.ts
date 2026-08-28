import {api} from './api';
import type {McpServer} from '../types';

export type GoogleWorkspaceStatus = {
    registered: boolean;
    enabled: boolean;
    connected: boolean;
    config?: Record<string, unknown>;
    accounts: Array<{id: string; email?: string; authenticated: boolean; reconnect_required: boolean}>;
    mcpServers: McpServer[];
};

export const getConfiguredGoogleWorkspaceAccountIds = (config?: Record<string, unknown>): string[] => {
    const accounts = config?.accounts;
    if (!Array.isArray(accounts)) return [];
    return accounts.flatMap(account => (
        typeof account === 'object' && account !== null && typeof account.id === 'string'
            ? [account.id]
            : []
    ));
};

let cachedStatus: GoogleWorkspaceStatus | null = null;
let pendingRequest: Promise<GoogleWorkspaceStatus> | null = null;
let statusRequestVersion = 0;
const GOOGLE_AUTH_POLL_INTERVAL_MS = 500;
const GOOGLE_AUTH_TIMEOUT_MS = 150_000;

async function loadStatus(requestVersion: number): Promise<GoogleWorkspaceStatus> {
    const [servers, auth] = await Promise.all([api.getMcpServers(), api.getGoogleAuthStatus()]);
    const server = (servers.servers || []).find(item => item.type === 'google_workspace');
    const accounts = auth.accounts || [];
    const status = {
        registered: Boolean(server),
        enabled: Boolean(server?.enabled),
        connected: Boolean(auth.authenticated || accounts.some(account => account.authenticated)),
        config: server?.config,
        accounts,
        mcpServers: servers.servers || [],
    };
    if (requestVersion !== statusRequestVersion) return cachedStatus || status;
    cachedStatus = status;
    return status;
}

export function getGoogleWorkspaceStatus(): Promise<GoogleWorkspaceStatus> {
    if (pendingRequest) return pendingRequest;
    if (cachedStatus) return Promise.resolve(cachedStatus);
    const requestVersion = ++statusRequestVersion;
    pendingRequest = loadStatus(requestVersion).finally(() => { pendingRequest = null; });
    return pendingRequest;
}

export function refreshGoogleWorkspaceStatus(): Promise<GoogleWorkspaceStatus> {
    const requestVersion = ++statusRequestVersion;
    const request = loadStatus(requestVersion).finally(() => {
        if (pendingRequest === request) pendingRequest = null;
    });
    pendingRequest = request;
    return pendingRequest;
}

/** OAuth 창이 열린 동안에만 서버의 인증 완료 상태를 확인한다. */
export async function waitForGoogleWorkspaceConnection(
    accountId?: string,
    timeoutMs = GOOGLE_AUTH_TIMEOUT_MS,
): Promise<boolean> {
    const expiresAt = Date.now() + timeoutMs;
    while (Date.now() < expiresAt) {
        try {
            if (accountId) {
                if ((await api.getGoogleAccountAuthStatus(accountId)).authenticated) return true;
            } else if ((await api.getGoogleAuthStatus()).authenticated) {
                return true;
            }
        } catch {
            // OAuth 리다이렉트 처리가 끝날 때까지 다시 확인한다.
        }
        await new Promise(resolve => window.setTimeout(resolve, GOOGLE_AUTH_POLL_INTERVAL_MS));
    }
    return false;
}

export function updateGoogleWorkspaceServerStatus(servers: McpServer[]): GoogleWorkspaceStatus {
    const server = servers.find(item => item.type === 'google_workspace');
    cachedStatus = {
        registered: Boolean(server),
        enabled: Boolean(server?.enabled),
        connected: cachedStatus?.connected || false,
        config: server?.config,
        accounts: (cachedStatus?.accounts || []).filter(account =>
            getConfiguredGoogleWorkspaceAccountIds(server?.config).includes(account.id),
        ),
        mcpServers: servers,
    };
    return cachedStatus;
}

export function updateGoogleWorkspaceConnectionStatus(connected: boolean): GoogleWorkspaceStatus {
    statusRequestVersion += 1;
    cachedStatus = {
        registered: cachedStatus?.registered ?? true,
        enabled: cachedStatus?.enabled ?? false,
        connected,
        config: cachedStatus?.config,
        accounts: cachedStatus?.accounts || [],
        mcpServers: cachedStatus?.mcpServers || [],
    };
    return cachedStatus;
}
