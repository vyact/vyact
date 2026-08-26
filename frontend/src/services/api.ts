import type {
    ChatResponse,
    ConversationDetailResponse,
    HistoryResponse,
    StatusResponse,
    QuickNote,
    Message,
    MessageAttachment,
    ArticleAttachment,
    McpCatalogEntry,
    McpServer,
    InstalledPlugin,
} from '../types';
import { assertOk, ApiError } from '../utils/apiError';

const API_BASE = '/api';
const EXTERNAL_DATA_BOOTSTRAP_CACHE_MS = 10_000;

export class VyactRuntimeInstallError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'VyactRuntimeInstallError';
    }
}

type ExternalDataBootstrapResponse = {
    connections: Record<string, {has_service_key: boolean; enabled: boolean}>;
    statuses: Record<string, Gov24SyncStatusResponse>;
    schedule: {enabled: boolean; interval_hours: number};
    cleanup: {enabled: boolean; cleanup_status: {status: string; cleanup_date?: string; deleted_count?: number}};
    prompt: {instruction: string};
};

let mcpCatalogRequest: Promise<{catalog: Record<string, McpCatalogEntry>}> | null = null;
let externalDataBootstrapCache: ExternalDataBootstrapResponse | null = null;
let externalDataBootstrapCachedAt = 0;
let externalDataBootstrapRequest: Promise<ExternalDataBootstrapResponse> | null = null;
let externalDataBootstrapVersion = 0;

const invalidateExternalDataBootstrap = () => {
    externalDataBootstrapVersion += 1;
    externalDataBootstrapCache = null;
    externalDataBootstrapCachedAt = 0;
};

/** Ensure every API call follows the same HTTP error contract. */
const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await globalThis.fetch(input, init);
    return assertOk(response);
};

interface GoogleMailParticipant {
    name: string;
    email: string;
    isMe: boolean;
}

interface GoogleMailWorkspaceMessage {
    id: string;
    threadId: string;
    from: string;
    participants: GoogleMailParticipant[];
    messageCount: number;
    subject: string;
    date: string;
    receivedAt: string;
    snippet: string;
    isUnread: boolean;
    isStarred: boolean;
    hasAttachments: boolean;
    labelIds: string[];
}

interface GoogleMailLabel {
    id: string;
    name: string;
    type: 'system' | 'user';
    unreadCount: number;
}

interface GoogleMailWorkspaceResponse {
    messages: GoogleMailWorkspaceMessage[];
    nextPageToken?: string;
    labels: GoogleMailLabel[];
}

const pendingGoogleMailWorkspaceRequests = new Map<string, Promise<GoogleMailWorkspaceResponse>>();

interface ScriptPairPayload {
    id: string;
    a: string;
    a_ko: string;
    b: string;
    b_ko: string;
}

interface ScriptPayload {
    id: string;
    title: string;
    language: string;
    pairs?: ScriptPairPayload[];
    raw?: string;
    created_at?: string;
}

interface ProviderSettings {
    has_key: boolean;
    model?: string;
}

export interface CustomProviderSettings {
    id: string;
    name: string;
    protocol: 'openai-compatible';
    base_url: string;
    model: string;
    has_key: boolean;
    headers: Array<{name: string; has_value: boolean}>;
}

export interface CustomProviderPayload {
    name: string;
    protocol: 'openai-compatible';
    base_url: string;
    api_key: string;
    model: string;
    headers: Array<{name: string; value: string}>;
}

type ProviderType = 'vyact' | 'openai' | 'gemini' | 'claude' | `custom:${string}`;

export interface VyactHubModel {
    id: string;
    runtime: 'gguf' | 'mlx';
    revision: string;
    downloads: number;
    files: string[];
    file_sizes: Record<string, number>;
    mtp_supported_files: string[];
    quantization?: string;
    mtp_model?: {repository: string; revision: string; size: number};
}

export interface VyactGgufMetadata {
    architecture: string;
    parameterCount: number;
    contextLength: number;
    blockCount: number;
    quantization: string;
    kvCacheBytes: number;
    runtimeBufferBytes: number;
    estimatedMemoryBytes: number;
}

export interface VyactModelSearchResponse {
    models: VyactHubModel[];
    hardware: VyactHardwareInfo;
    installed: string[];
    mtp_supported: string[];
}

let cachedVyactInstalledModels: string[] = [];

export interface VyactGpuInfo {
    name: string;
    backend: string;
    total_bytes: number;
    available_bytes: number;
    shared_memory: boolean;
}

export interface VyactHardwareInfo {
    platform: string;
    apple_silicon: boolean;
    memory_mode: 'unified' | 'dedicated' | 'system';
    system_memory: {total_bytes: number; available_bytes: number};
    gpus: VyactGpuInfo[];
}

export interface VyactModelProfile {
    model_path: string;
    runtime: 'gguf' | 'mlx';
    repository?: string | null;
    context_size: number;
    max_output_tokens: number;
    temperature: number;
    top_k: number | null;
    top_p: number | null;
    cache_quantization: boolean;
}

interface ProvidersResponse {
    providers: Record<string, ProviderSettings>;
    custom_providers: CustomProviderSettings[];
    current_type?: ProviderType;
}

interface SystemPrompt {
    id: string;
    title: string;
    content: string;
}

interface SystemPromptsResponse {
    prompts: SystemPrompt[];
    selected_id?: string | null;
}

interface ApiSuccessResponse {
    ok: boolean;
}

export interface Gov24SyncStatusResponse {
    status: 'idle' | 'running' | 'completed' | 'failed';
    stage?: 'list' | 'detail' | 'conditions' | 'announcements' | 'startupAnnouncements' | 'startupBusinesses' | 'housingRental' | 'housingSale' | 'lhLeaseComplex' | 'lhLeaseNotice' | 'indexing' | 'completed';
    current?: number;
    total?: number;
    document_count?: number;
    last_successful_sync_at?: string | null;
    error?: string;
    error_code?: 'request_limit_exceeded' | 'sync_request_budget_exceeded' | 'api_error' | 'sync_failed';
    request_count?: number;
    request_limit?: number;
}

export interface ExternalDataSyncEvent {
    status: 'running' | 'completed' | 'failed';
    sources: Record<string, Gov24SyncStatusResponse>;
    error?: string;
}

const streamSyncStatus = async (
    url: string,
    onStatus: (status: Gov24SyncStatusResponse) => void,
): Promise<Gov24SyncStatusResponse> => {
    const res = await fetch(url, {method: 'POST', headers: {'Accept': 'text/event-stream'}});
    if (!res.ok) throw new Error(await res.text());
    if (!res.body) throw new Error('Synchronization stream is unavailable.');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let latestStatus: Gov24SyncStatusResponse = {status: 'running'};
    while (true) {
        const {done, value} = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), {stream: !done});
        const messages = buffer.split('\n\n');
        buffer = messages.pop() || '';
        for (const message of messages) {
            const dataLine = message.split('\n').find(line => line.startsWith('data: '));
            if (!dataLine) continue;
            latestStatus = JSON.parse(dataLine.slice(6)) as Gov24SyncStatusResponse;
            onStatus(latestStatus);
        }
        if (done) return latestStatus;
    }
};

export interface Gov24Document {
    id: string;
    title: string;
    agency: string;
    target: string;
    category: string;
    user_type: string;
    support_type: string;
    application_deadline: string;
    application_end_date?: string | null;
    record_type?: 'announcement' | 'business' | 'rental' | 'sale' | '';
    source_url: string;
    application_url?: string;
    source_modified_at: string;
    created_at?: string;
    view_count?: number | null;
    attachments?: Array<{name: string; url: string}>;
    summary: string;
    purpose: string;
    content: string;
    selection_criteria: string;
    application_method: string;
    required_documents: string;
    contact: string;
}

export interface Gov24DocumentsResponse {
    items: Gov24Document[];
    total: number;
    next_cursor: string | null;
}

export interface AllExternalDocumentsResponse extends Omit<Gov24DocumentsResponse, 'items'> {
    items: Array<Gov24Document & {source_id: string}>;
}

export const api = {
    async searchVyactModels(query: string, mlxOnly = false): Promise<VyactModelSearchResponse> {
        const params = new URLSearchParams({q: query, mlx_only: String(mlxOnly)});
        const response = await fetch(`${API_BASE}/vyact/models/search?${params}`);
        const data = await response.json();
        cachedVyactInstalledModels = data.installed || [];
        return {
            models: data.models || [],
            installed: cachedVyactInstalledModels,
            mtp_supported: data.mtp_supported || [],
            hardware: data.hardware || {
                platform: '', apple_silicon: false, memory_mode: 'system',
                system_memory: data.system_memory || {total_bytes: 0, available_bytes: 0},
                gpus: [],
            },
        };
    },

    getCachedVyactInstalledModels(): string[] {
        return [...cachedVyactInstalledModels];
    },

    async getVyactModelMetadataCache(
        repository: string, filename: string, revision: string, contextSize: number,
    ): Promise<VyactGgufMetadata | null> {
        const params = new URLSearchParams({repository, filename, revision, context_size: String(contextSize)});
        const response = await fetch(`${API_BASE}/vyact/models/metadata-cache?${params}`);
        if (!response.ok) throw new Error(`Model metadata cache lookup failed (${response.status})`);
        const source = (await response.json()).metadata;
        if (!source) return null;
        return {
            architecture: source.architecture,
            parameterCount: source.parameter_count,
            contextLength: source.context_length,
            blockCount: source.block_count,
            quantization: source.quantization,
            kvCacheBytes: source.kv_cache_bytes,
            runtimeBufferBytes: source.runtime_buffer_bytes,
            estimatedMemoryBytes: source.estimated_memory_bytes,
        };
    },

    async inspectVyactMlxMetadata(
        repository: string, revision: string, fileSize: number, contextSize: number,
    ): Promise<VyactGgufMetadata> {
        const params = new URLSearchParams({
            repository, revision, file_size: String(fileSize), context_size: String(contextSize),
        });
        const response = await fetch(`${API_BASE}/vyact/models/mlx-metadata?${params}`);
        if (!response.ok) throw new Error(`MLX model metadata inspection failed (${response.status})`);
        const source = (await response.json()).metadata;
        return {
            architecture: source.architecture,
            parameterCount: source.parameter_count,
            contextLength: source.context_length,
            blockCount: source.block_count,
            quantization: source.quantization,
            kvCacheBytes: source.kv_cache_bytes,
            runtimeBufferBytes: source.runtime_buffer_bytes,
            estimatedMemoryBytes: source.estimated_memory_bytes,
        };
    },

    async saveVyactModelMetadataCache(
        repository: string, filename: string, revision: string, contextSize: number,
        fileSize: number, metadata: VyactGgufMetadata,
    ): Promise<void> {
        const response = await fetch(`${API_BASE}/vyact/models/metadata-cache`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                repository, filename, revision, context_size: contextSize,
                architecture: metadata.architecture,
                parameter_count: Math.round(metadata.parameterCount),
                context_length: Math.round(metadata.contextLength),
                block_count: Math.round(metadata.blockCount),
                quantization: metadata.quantization,
                kv_cache_bytes: Math.ceil(metadata.kvCacheBytes),
                runtime_buffer_bytes: Math.ceil(metadata.runtimeBufferBytes),
                estimated_memory_bytes: Math.ceil(metadata.estimatedMemoryBytes),
                file_size_bytes: Math.round(fileSize),
            }),
        });
        const result = response.ok ? await response.json() : null;
        if (!response.ok || !result?.saved) {
            throw new Error(`Model metadata cache save failed (${response.status})`);
        }
    },

    async saveVyactHuggingFaceToken(token: string): Promise<void> {
        const response = await fetch(`${API_BASE}/vyact/huggingface-token`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token}),
        });
        if (!response.ok) throw new Error(`Hugging Face token save failed (${response.status})`);
    },

    async getVyactHuggingFaceTokenStatus(): Promise<{configured: boolean}> {
        const response = await fetch(`${API_BASE}/vyact/huggingface-token/status`);
        if (!response.ok) throw new Error(`Hugging Face token status failed (${response.status})`);
        return response.json();
    },

    async streamVyactModelDownload(
        repository: string, filename: string, onProgress: (message: string, progress?: number) => void,
        revision = 'main', runtime: 'gguf' | 'mlx' = 'gguf', token = '', totalSizeBytes = 0,
        mtpModel?: {repository: string; revision: string; size: number},
    ): Promise<void> {
        const response = await fetch(`${API_BASE}/vyact/models/download`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                repository, filename, revision, runtime,
                token: token.trim() || undefined,
                total_size_bytes: totalSizeBytes,
                mtp_repository: mtpModel?.repository,
                mtp_revision: mtpModel?.revision,
                mtp_size_bytes: mtpModel?.size || 0,
            }),
        });
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (true) {
            const {done, value} = await reader.read();
            if (done) {
                const modelPath = runtime === 'mlx' ? `mlx/${repository}` : `${repository}/${filename}`;
                if (!cachedVyactInstalledModels.includes(modelPath)) {
                    cachedVyactInstalledModels = [...cachedVyactInstalledModels, modelPath];
                }
                return;
            }
            pending += decoder.decode(value, {stream: true});
            const lines = pending.split('\n');
            pending = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const event = JSON.parse(line.slice(6));
                onProgress(event.message, event.progress);
                if (event.type === 'error') throw new Error(event.message);
            }
        }
    },

    async installVyactRuntime(
        onProgress?: (message: string, progress?: number) => void,
    ): Promise<void> {
        const response = await fetch(`${API_BASE}/vyact/runtime/install`, {method: 'POST'});
        if (!response.ok) throw new Error(`Vyact runtime installation failed (${response.status})`);
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (true) {
            const {done, value} = await reader.read();
            if (done) return;
            pending += decoder.decode(value, {stream: true});
            const lines = pending.split('\n');
            pending = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const event = JSON.parse(line.slice(6));
                onProgress?.(event.message, event.progress);
                if (event.type === 'error' || event.type === 'runtime_package_manager_missing') {
                    throw new VyactRuntimeInstallError(event.message, event.type);
                }
            }
        }
    },

    async getVyactModelProfile(modelPath: string, runtime: 'gguf' | 'mlx', repository?: string, recommendedContext = 32768): Promise<VyactModelProfile> {
        const params = new URLSearchParams({model_path: modelPath, runtime, recommended_context: String(recommendedContext)});
        if (repository) params.set('repository', repository);
        const response = await fetch(`${API_BASE}/vyact/models/profile?${params}`);
        if (!response.ok) throw new Error(`Model settings load failed (${response.status})`);
        return response.json();
    },

    async saveVyactModelProfile(profile: VyactModelProfile): Promise<VyactModelProfile> {
        const response = await fetch(`${API_BASE}/vyact/models/profile`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(profile),
        });
        if (!response.ok) throw new Error(`Model settings save failed (${response.status})`);
        return response.json();
    },

    async activateVyactModel(
        modelPath: string, contextSize = 32768, onProgress?: (message: string, progress?: number) => void,
        runtime: 'gguf' | 'mlx' = 'gguf', repository?: string, profile?: VyactModelProfile,
    ): Promise<void> {
        const response = await fetch(`${API_BASE}/vyact/models/activate`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({model_path: modelPath, context_size: contextSize, runtime, repository, ...profile}),
        });
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (true) {
            const {done, value} = await reader.read();
            if (done) return;
            pending += decoder.decode(value, {stream: true});
            const lines = pending.split('\n');
            pending = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const event = JSON.parse(line.slice(6));
                onProgress?.(event.message, event.progress);
                if (event.type === 'error') throw new Error(event.message);
            }
        }
    },

    async deleteVyactModel(modelPath: string): Promise<void> {
        const response = await fetch(`${API_BASE}/vyact/models/downloaded`, {
            method: 'DELETE',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({model_path: modelPath}),
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => null);
            throw new Error(detail?.detail || `Model deletion failed (${response.status})`);
        }
        cachedVyactInstalledModels = cachedVyactInstalledModels.filter(model => model !== modelPath);
    },
    async getSetupStatus(): Promise<{
        setup_done: boolean;
        config: {
            type: string;
            model: string | null;
            api_key: string | null;
            config?: Record<string, unknown>;
        };
        ram_gb: number;
        cpu_cores: string;
        arch: string;
        recommended: string;
        log_path: string;
    }> {
        const res = await fetch(`${API_BASE}/setup/status`);
        return res.json();
    },

    async installModel(
        model: string,
        onProgress?: (msg: string, type: string, progress?: number) => void
    ): Promise<void> {
        const res = await fetch(`${API_BASE}/setup/install`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({model}),
        });
        if (!onProgress || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            for (const line of decoder.decode(value).split('\n')) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.replace('data: ', '').trim());
                        onProgress(data.message, data.type, data.progress);
                    } catch (e) {
                        console.error('SSE parse error:', e);
                    }
                }
            }
        }
    },

    async getStatus(): Promise<StatusResponse> {
        const res = await fetch(`${API_BASE}/status`);
        return res.json();
    },

    async getModels(): Promise<{
        models: string[][];
        current: string;
        installed: string[];
        mtp_supported?: string[];
        mtp_active?: string | null;
        model_type?: 'chat' | 'image_gen' | 'image_edit';
    }> {
        const res = await fetch(`${API_BASE}/models`);
        return res.json();
    },

    // ── MCP 서버 설정 ──
    async getMcpCatalog(): Promise<{ catalog: Record<string, McpCatalogEntry> }> {
        if (!mcpCatalogRequest) {
            mcpCatalogRequest = fetch(`${API_BASE}/mcp/catalog`)
                .then(res => res.json())
                .catch(error => {
                    mcpCatalogRequest = null;
                    throw error;
                });
        }
        return mcpCatalogRequest;
    },

    async getMcpServers(): Promise<{ servers: McpServer[] }> {
        const res = await fetch(`${API_BASE}/mcp/servers`);
        return res.json();
    },

    async addMcpServer(type: string, config: Record<string, unknown>, enabled = true, prompt = ''): Promise<{ server: McpServer }> {
        const res = await fetch(`${API_BASE}/mcp/servers`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({type, config, enabled, prompt}),
        });
        await assertOk(res, 'MCP 서버 추가 실패');
        return res.json();
    },

    async updateMcpServer(id: string, patch: { config?: Record<string, unknown>; enabled?: boolean; prompt?: string }): Promise<{ servers: McpServer[] }> {
        const res = await fetch(`${API_BASE}/mcp/servers/${id}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(patch),
        });
        return res.json();
    },

    async removeMcpServer(id: string): Promise<{ servers: McpServer[] }> {
        const res = await fetch(`${API_BASE}/mcp/servers/${id}`, { method: 'DELETE' });
        return res.json();
    },

    async getPlugins(): Promise<{ plugins: InstalledPlugin[] }> {
        const res = await fetch(`${API_BASE}/plugins`);
        await assertOk(res, '플러그인 목록을 불러오지 못했습니다.');
        return res.json();
    },

    async installPlugin(file: File): Promise<{ plugin: InstalledPlugin }> {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE}/plugins/install`, {
            method: 'POST',
            body: formData,
        });
        await assertOk(res, '플러그인 설치에 실패했습니다.');
        return res.json();
    },

    async uninstallPlugin(id: string): Promise<{ ok: boolean; plugin: InstalledPlugin }> {
        const res = await fetch(`${API_BASE}/plugins/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        await assertOk(res, '플러그인 삭제에 실패했습니다.');
        return res.json();
    },

    async getGoogleAuthUrl(accountId: string, gauthJson: string | object): Promise<{ auth_url: string }> {
        const res = await fetch(`${API_BASE}/mcp/google/auth-url`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({account_id: accountId, gauth_json: gauthJson}),
        });
        return res.json();
    },

    async getGoogleAuthStatus(): Promise<{ authenticated: boolean; reconnect_required?: boolean; accounts?: Array<{id: string; email?: string; authenticated: boolean; reconnect_required: boolean}> }> {
        const res = await fetch(`${API_BASE}/mcp/google/auth-status`);
        return res.json();
    },

    async getGoogleAccountAuthStatus(accountId: string): Promise<{authenticated: boolean}> {
        const res = await fetch(`${API_BASE}/mcp/google/accounts/${encodeURIComponent(accountId)}/auth-status`);
        return res.json();
    },

    async activateGoogleAccount(accountId: string): Promise<{ok: boolean; active_account_id: string}> {
        const res = await fetch(`${API_BASE}/mcp/google/accounts/${encodeURIComponent(accountId)}/activate`, {method: 'POST'});
        await assertOk(res, 'Google 계정을 전환하지 못했습니다.');
        return res.json();
    },

    async disconnectGoogle(accountId: string): Promise<{ ok: boolean }> {
        const res = await fetch(`${API_BASE}/mcp/google/accounts/${encodeURIComponent(accountId)}/disconnect`, {method: 'POST'});
        return res.json();
    },

    async getGoogleMailLabels() { return (await fetch(`${API_BASE}/google-workspace/mail/labels`)).json(); },
    async createGoogleMailLabel(name: string) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/labels`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name}),
        });
        await assertOk(response, 'Unable to create email label.');
        return response.json();
    },
    async deleteGoogleMailLabel(id: string) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/labels/${encodeURIComponent(id)}`, {method: 'DELETE'});
        await assertOk(response, 'Unable to delete email label.');
        return response.json();
    },
    async updateGoogleMailLabel(id: string, name: string) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/labels/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name}),
        });
        await assertOk(response, 'Unable to rename email label.');
        return response.json();
    },
    async getGoogleMailWorkspace(label = 'INBOX'): Promise<GoogleMailWorkspaceResponse> {
        const params = new URLSearchParams({label});
        const requestKey = params.toString();
        const pendingRequest = pendingGoogleMailWorkspaceRequests.get(requestKey);
        if (pendingRequest) return pendingRequest;
        const request = fetch(`${API_BASE}/google-workspace/mail/workspace?${params}`)
            .then(async response => {
                await assertOk(response, 'Unable to load email workspace.');
                return response.json() as Promise<GoogleMailWorkspaceResponse>;
            })
            .finally(() => pendingGoogleMailWorkspaceRequests.delete(requestKey));
        pendingGoogleMailWorkspaceRequests.set(requestKey, request);
        return request;
    },
    async getGoogleMailMessages(label = 'INBOX', pageToken = '') { const params = new URLSearchParams({label}); if (pageToken) params.set('page_token', pageToken); return (await fetch(`${API_BASE}/google-workspace/mail/messages?${params}`)).json(); },
    async getGoogleMailMessage(id: string, label = 'INBOX') {
        const response = await fetch(`${API_BASE}/google-workspace/mail/messages/${encodeURIComponent(id)}?${new URLSearchParams({label})}`);
        await assertOk(response, 'Unable to load email.');
        return response.json();
    },
    async indexGoogleMailThreadForKnowledge(threadId: string, accountId: string, threadMessages?: Array<{id: string; from_: string; to: string; cc: string; date: string; subject: string; body: string; html_body: string; attachments: Array<{id: string; filename: string; mime_type: string; size: number}>}>) { return (await fetch(`${API_BASE}/google-workspace/mail/threads/${encodeURIComponent(threadId)}/knowledge-index`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({account_id: accountId, thread_messages: threadMessages || []})})).json() as Promise<{source_id: string; thread_id: string; message_count: number; updated: boolean}>; },
    async getGoogleMailSignature(accountId: string): Promise<{signature_html: string; enabled: boolean; macros: Array<{id: string; title: string; content_html: string}>}> {
        const response = await fetch(`${API_BASE}/google-workspace/accounts/${encodeURIComponent(accountId)}/mail/signature`);
        await assertOk(response, 'Unable to load email signature.');
        return response.json();
    },
    async saveGoogleMailSignature(accountId: string, signatureHtml: string, enabled = true, macros: Array<{id: string; title: string; content_html: string}> = []) {
        const response = await fetch(`${API_BASE}/google-workspace/accounts/${encodeURIComponent(accountId)}/mail/signature`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({signature_html: signatureHtml, enabled, macros}),
        });
        await assertOk(response, 'Unable to save email signature.');
        return response.json();
    },
    async getGoogleMailAttachment(messageId: string, attachmentId: string, mimeType: string) {
        const query = new URLSearchParams({mime_type: mimeType});
        const response = await fetch(`${API_BASE}/google-workspace/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}?${query}`);
        if (!response.ok) throw new Error('Unable to load email attachment.');
        return response.blob();
    },
    async markGoogleMailMessageRead(id: string) { return (await fetch(`${API_BASE}/google-workspace/mail/messages/${encodeURIComponent(id)}/read`, {method: 'PATCH'})).json(); },
    async setGoogleMailMessageStarred(id: string, starred: boolean) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/messages/${encodeURIComponent(id)}/star`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({starred}),
        });
        await assertOk(response, 'Unable to update email star.');
        return response.json();
    },
    async trashGoogleMailMessages(messageIds: string[]) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/messages/trash`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message_ids: messageIds}),
        });
        await assertOk(response, 'Unable to delete email.');
        return response.json();
    },
    async permanentlyDeleteGoogleMailMessages(messageIds: string[]) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/messages/delete`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message_ids: messageIds}),
        });
        await assertOk(response, 'Unable to permanently delete email.');
        return response.json();
    },
    async trashGoogleMailThreads(threadIds: string[]) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/threads/trash`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({thread_ids: threadIds}),
        });
        await assertOk(response, 'Unable to delete email thread.');
        return response.json();
    },
    async permanentlyDeleteGoogleMailThreads(threadIds: string[]) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/threads/delete`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({thread_ids: threadIds}),
        });
        await assertOk(response, 'Unable to permanently delete email thread.');
        return response.json();
    },
    async moveGoogleMailThreads(threadIds: string[], targetLabelId: string, sourceLabelId: string, sourceIsUserLabel: boolean) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/threads/move`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({thread_ids: threadIds, target_label_id: targetLabelId, source_label_id: sourceLabelId, source_is_user_label: sourceIsUserLabel}),
        });
        await assertOk(response, 'Unable to move email.');
        return response.json();
    },
    async applyGoogleMailThreadLabel(threadIds: string[], labelId: string) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/threads/labels`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({thread_ids: threadIds, label_id: labelId}),
        });
        await assertOk(response, 'Unable to apply email label.');
        return response.json();
    },
    async generateGoogleMailBody(data: {
        mode: 'new' | 'reply' | 'forward';
        instruction: string;
        current_message: {to: string[]; cc: string[]; bcc: string[]; subject: string; draft: string};
        attachments: Array<{name: string; mime_type: string; size: number}>;
        thread_messages: Array<{from_: string; to: string; cc: string; subject: string; date: string; body: string}>;
    }) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/generate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || 'Failed to generate email.');
        return payload as {body: string};
    },
    async sendGoogleMail(data: FormData) {
        const response = await fetch(`${API_BASE}/google-workspace/mail/send`, {method: 'POST', body: data});
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || 'Failed to send email.');
        return payload as {ok: boolean; id?: string; threadId?: string};
    },
    async getGoogleDriveFiles(folderId = 'root', query = '', pageToken = '', pageSize = 50,
                              orderBy: 'name' | 'modifiedTime' | 'size' = 'name',
                              orderDirection: 'asc' | 'desc' = 'asc') {
        const params = new URLSearchParams({
            folder_id: folderId,
            query,
            page_token: pageToken,
            page_size: String(pageSize),
            order_by: orderBy,
            order_direction: orderDirection,
        });
        return (await fetch(`${API_BASE}/google-workspace/drive/files?${params}`)).json();
    },
    async uploadGoogleDriveFiles(data: FormData) { return (await fetch(`${API_BASE}/google-workspace/drive/upload`, {method: 'POST', body: data})).json(); },
    async createGoogleDriveFolder(parentId: string, name: string) { return (await fetch(`${API_BASE}/google-workspace/drive/folders`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({parent_id: parentId, name})})).json(); },
    async deleteGoogleDriveFile(id: string) { return (await fetch(`${API_BASE}/google-workspace/drive/files/${encodeURIComponent(id)}`, {method: 'DELETE'})).json(); },
    async batchTrashGoogleDriveFiles(fileIds: string[]) { return (await fetch(`${API_BASE}/google-workspace/drive/files/batch-trash`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({file_ids: fileIds})})).json(); },
    async batchMoveGoogleDriveFiles(fileIds: string[], targetFolderId: string) {
        const response = await fetch(`${API_BASE}/google-workspace/drive/files/batch-move`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({file_ids: fileIds, target_folder_id: targetFolderId})});
        if (!response.ok) throw new Error('Unable to move Google Drive files.');
        return response.json() as Promise<{ok: boolean; moved_ids: string[]}>;
    },
    async getGoogleDriveFolders(parentId = 'root') {
        const params = new URLSearchParams({parent_id: parentId});
        const response = await fetch(`${API_BASE}/google-workspace/drive/folders?${params}`);
        if (!response.ok) throw new Error('Unable to load Google Drive folders.');
        return response.json() as Promise<{folders: {id: string; name: string}[]}>;
    },
    async checkGoogleDriveDuplicates(folderId: string, names: string[]): Promise<{duplicates: string[]}> { return (await fetch(`${API_BASE}/google-workspace/drive/files/check-duplicates`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({folder_id: folderId, names})})).json(); },
    async renameGoogleDriveFile(id: string, name: string) { return (await fetch(`${API_BASE}/google-workspace/drive/files/${encodeURIComponent(id)}/rename`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})})).json(); },
    async copyGoogleDriveFile(id: string, name: string) { return (await fetch(`${API_BASE}/google-workspace/drive/files/${encodeURIComponent(id)}/copy`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})})).json(); },
    async downloadGoogleDriveFile(id: string, signal?: AbortSignal) {
        const response = await fetch(`${API_BASE}/google-workspace/drive/files/${encodeURIComponent(id)}/download`, {signal});
        if (!response.ok) throw new Error('파일을 다운로드하지 못했습니다.');
        const disposition = response.headers.get('Content-Disposition') || '';
        const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        return {
            blob: await response.blob(),
            filename: encodedFilename ? decodeURIComponent(encodedFilename) : '',
        };
    },
    async createGoogleDriveDownloadJob(id: string, signal?: AbortSignal) {
        const response = await fetch(`${API_BASE}/google-workspace/drive/files/${encodeURIComponent(id)}/download-jobs`, {method: 'POST', signal});
        if (!response.ok) throw new Error('다운로드 작업을 시작하지 못했습니다.');
        return response.json() as Promise<{jobId: string}>;
    },
    async createGoogleDriveBulkDownloadJob(ids: string[], archiveName: string, signal?: AbortSignal) {
        const response = await fetch(`${API_BASE}/google-workspace/drive/download-jobs`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({file_ids: ids, archive_name: archiveName}),
            signal,
        });
        if (!response.ok) throw new Error('다운로드 작업을 시작하지 못했습니다.');
        return response.json() as Promise<{jobId: string}>;
    },
    async getGoogleDriveDownloadJob(jobId: string, signal?: AbortSignal) {
        const response = await fetch(`${API_BASE}/google-workspace/drive/download-jobs/${encodeURIComponent(jobId)}`, {signal});
        if (!response.ok) throw new Error('다운로드 진행 상태를 확인하지 못했습니다.');
        return response.json() as Promise<{status: 'collecting' | 'compressing' | 'complete' | 'error'; total: number; completed: number; error?: string}>;
    },
    async getGoogleDriveDownloadJobFile(jobId: string, signal?: AbortSignal) {
        const response = await fetch(`${API_BASE}/google-workspace/drive/download-jobs/${encodeURIComponent(jobId)}/file`, {signal});
        if (!response.ok) throw new Error('압축 파일을 다운로드하지 못했습니다.');
        const disposition = response.headers.get('Content-Disposition') || '';
        const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        return {
            blob: await response.blob(),
            filename: encodedFilename ? decodeURIComponent(encodedFilename) : '',
        };
    },
    async cancelGoogleDriveDownloadJob(jobId: string) {
        await fetch(`${API_BASE}/google-workspace/drive/download-jobs/${encodeURIComponent(jobId)}`, {method: 'DELETE'});
    },
    async getGoogleDrivePermissions(id: string) { return (await fetch(`${API_BASE}/google-workspace/drive/files/${encodeURIComponent(id)}/permissions`)).json(); },
    async createGoogleDrivePermission(id: string, email: string, role: 'reader' | 'writer') { return (await fetch(`${API_BASE}/google-workspace/drive/files/${encodeURIComponent(id)}/permissions`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, role})})).json(); },
    async updateGoogleDriveGeneralAccess(id: string, role: 'private' | 'reader' | 'writer') { return (await fetch(`${API_BASE}/google-workspace/drive/files/${encodeURIComponent(id)}/general-access`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role})})).json(); },
    async deleteGoogleDrivePermission(id: string, permissionId: string) { return (await fetch(`${API_BASE}/google-workspace/drive/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}`, {method: 'DELETE'})).json(); },

    // ── Calendar ──
    async getGoogleCalendarEvents(params: {time_min?: string; time_max?: string; max_results?: number; calendar_id?: string; q?: string} = {}) {
        const query = new URLSearchParams();
        if (params.time_min) query.set('time_min', params.time_min);
        if (params.time_max) query.set('time_max', params.time_max);
        if (params.max_results) query.set('max_results', String(params.max_results));
        if (params.calendar_id) query.set('calendar_id', params.calendar_id);
        if (params.q) query.set('q', params.q);
        return (await fetch(`${API_BASE}/google-workspace/calendar/events?${query}`)).json();
    },
    async createGoogleCalendarEvent(data: {summary: string; start: string; end: string; description?: string; location?: string; calendar_id?: string; timezone?: string; reminders?: {method: 'popup' | 'email'; minutes: number}[]; use_default_reminders?: boolean}) {
        return (await fetch(`${API_BASE}/google-workspace/calendar/events`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})).json();
    },
    async updateGoogleCalendarEvent(eventId: string, data: {summary?: string; start?: string; end?: string; description?: string; location?: string; calendar_id?: string; timezone?: string; reminders?: {method: 'popup' | 'email'; minutes: number}[]; use_default_reminders?: boolean}) {
        return (await fetch(`${API_BASE}/google-workspace/calendar/events/${encodeURIComponent(eventId)}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})).json();
    },
    async deleteGoogleCalendarEvent(eventId: string, calendarId = 'primary') {
        return (await fetch(`${API_BASE}/google-workspace/calendar/events/${encodeURIComponent(eventId)}?calendar_id=${encodeURIComponent(calendarId)}`, {method: 'DELETE'})).json();
    },
    async getGoogleCalendars() { return (await fetch(`${API_BASE}/google-workspace/calendar/calendars`)).json(); },

    async getNotifications(limit = 30, offset = 0) { return (await fetch(`${API_BASE}/notifications?limit=${limit}&offset=${offset}`)).json(); },
    async createNotification(data: {type: string; source_id: string; title: string; message?: string; occurred_at?: string; update_only?: boolean; account_id?: string; account_email?: string}) { return (await fetch(`${API_BASE}/notifications`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})).json(); },
    async markNotificationsRead() { return (await fetch(`${API_BASE}/notifications/read`, {method: 'PATCH'})).json(); },

    async selectModel(
        type: string,
        model: string,
        apiKey?: string,
        onProgress?: (msg: string, type: string, progress?: number) => void,
        modelType?: 'chat' | 'image_gen' | 'image_edit'
    ): Promise<void> {
        const res = await fetch(`${API_BASE}/models/select`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({type, model, api_key: apiKey, model_type: modelType}),
        });
        if (!res.ok) throw new Error(`Model selection failed (${res.status})`);
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (true) {
            const {done, value} = await reader.read();
            if (done) {
                pending += decoder.decode();
            } else {
                pending += decoder.decode(value, {stream: true});
            }
            const lines = pending.split('\n');
            pending = done ? '' : lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    let data: {message: string; type: string; progress?: number};
                    try {
                        data = JSON.parse(line.replace('data: ', '').trim());
                    } catch (e) {
                        console.error('SSE parse error:', e);
                        continue;
                    }
                    onProgress?.(data.message, data.type, data.progress);
                    if (data.type === 'error') throw new Error(data.message);
                }
            }
            if (done) break;
        }
    },

    async chat(
        question: string,
        convId: string,
        messages: Array<Pick<Message, 'role' | 'content' | 'attachments'>>,
        attachments?: MessageAttachment[],
        articles?: ArticleAttachment[],
        systemPromptOverride?: string,
        voiceMode?: boolean,
        reasoning: boolean = true
    ): Promise<ChatResponse> {
        const res = await fetch(`${API_BASE}/query`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                question,
                conv_id: convId,
                messages,
                attachments,
                articles: articles ?? [],
                article_selection_explicit: true,
                user_timestamp: new Date().toISOString(),
                reasoning,
                ...(systemPromptOverride !== undefined && {system_prompt: systemPromptOverride}),
                ...(voiceMode && {voice_mode: true}),
            }),
        });
        return res.json();
    },

    async resetIndex() {
        const res = await fetch(`${API_BASE}/index`, {method: 'DELETE'});
        return res.json();
    },

    async getHistory(limit = 20, offset = 0, projectId?: string | null, includeFavorites = true): Promise<HistoryResponse> {
        const projectParam = projectId ? `&project_id=${encodeURIComponent(projectId)}` : '';
        const res = await fetch(`${API_BASE}/history?limit=${limit}&offset=${offset}&include_favorites=${includeFavorites}${projectParam}`);
        return res.json();
    },

    async getConversation(convId: string): Promise<ConversationDetailResponse> {
        const res = await fetch(`${API_BASE}/history/${convId}`);
        return res.json();
    },

    async getConversationSummary(convId: string): Promise<{
        conv_id: string;
        conv_summary: string;
        attachment_summaries: { batch_id: string; attached_at: string; source_name: string; file_count: number; summary: string }[];
    }> {
        const res = await fetch(`${API_BASE}/history/${convId}/summary`);
        return res.json();
    },

    async deleteConversation(convId: string): Promise<void> {
        await fetch(`${API_BASE}/history/${convId}`, {method: 'DELETE'});
    },

    async clearConversationMessages(convId: string): Promise<void> {
        await fetch(`${API_BASE}/history/${convId}/messages`, {method: 'DELETE'});
    },

    async deleteAllConversations(): Promise<void> {
        await fetch(`${API_BASE}/history`, {method: 'DELETE'});
    },

    async renameConversation(convId: string, title: string): Promise<void> {
        await fetch(`${API_BASE}/history/${convId}/title`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({title})
        });
    },
    async setConversationFavorite(convId: string, isFavorite: boolean): Promise<void> {
        const response = await fetch(`${API_BASE}/history/${convId}/favorite`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({is_favorite: isFavorite}),
        });
        await assertOk(response, 'Unable to update favorite conversation.');
    },
    async getProjects(): Promise<{projects: import('../types').Project[]}> { return (await fetch(`${API_BASE}/projects`)).json(); },
    async createProject(name: string, folderPaths: string[], color: string): Promise<import('../types').Project> { return (await fetch(`${API_BASE}/projects`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, folder_paths: folderPaths, color})})).json(); },
    async updateProject(projectId: string, updates: Partial<Pick<import('../types').Project, 'name' | 'project_prompt' | 'color' | 'folder_paths'>>): Promise<import('../types').Project> { return (await fetch(`${API_BASE}/projects/${projectId}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(updates)})).json(); },
    async deleteProject(projectId: string): Promise<void> { await fetch(`${API_BASE}/projects/${projectId}`, {method: 'DELETE'}); },
    async deleteProjectHistory(projectId: string): Promise<void> { await fetch(`${API_BASE}/projects/${projectId}/history`, {method: 'DELETE'}); },
    async getProjectMemory(projectId: string): Promise<import('../types').ProjectMemory> { return (await fetch(`${API_BASE}/projects/${projectId}/memory`)).json(); },
    async updateProjectMemoryItem(projectId: string, itemType: 'decision' | 'action_item', itemId: string, updates: {status?: 'active' | 'completed'; text?: string}): Promise<import('../types').ProjectMemory> { return (await fetch(`${API_BASE}/projects/${projectId}/memory/${itemType}/${itemId}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(updates)})).json(); },
    async deleteProjectMemoryItem(projectId: string, itemType: 'decision' | 'action_item', itemId: string): Promise<import('../types').ProjectMemory> { return (await fetch(`${API_BASE}/projects/${projectId}/memory/${itemType}/${itemId}`, {method: 'DELETE'})).json(); },
    async setConversationProject(convId: string, projectId: string | null): Promise<void> { await fetch(`${API_BASE}/history/${convId}/project`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({project_id: projectId})}); },
    async resolveToolApproval(approvalId: string, approved: boolean, userResponse = ''): Promise<void> { const response = await fetch(`${API_BASE}/tool-approvals/${encodeURIComponent(approvalId)}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({approved, response: userResponse})}); await assertOk(response, 'Unable to resolve tool approval.'); },
    async getKnowledgeCollections(): Promise<{collections: import('../types').KnowledgeCollection[]}> { return (await fetch(`${API_BASE}/knowledge-collections`)).json(); },
    async createKnowledgeCollection(data: Omit<import('../types').KnowledgeCollection, 'id' | 'created_at' | 'updated_at'>): Promise<import('../types').KnowledgeCollection> { return (await fetch(`${API_BASE}/knowledge-collections`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})).json(); },
    async updateKnowledgeCollection(id: string, data: Omit<import('../types').KnowledgeCollection, 'id' | 'created_at' | 'updated_at'>): Promise<import('../types').KnowledgeCollection> { return (await fetch(`${API_BASE}/knowledge-collections/${encodeURIComponent(id)}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})).json(); },
    async deleteKnowledgeCollection(id: string): Promise<void> { await fetch(`${API_BASE}/knowledge-collections/${encodeURIComponent(id)}`, {method: 'DELETE'}); },
    async reorderKnowledgeCollections(collectionIds: string[]): Promise<void> { await fetch(`${API_BASE}/knowledge-collections/order`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({collection_ids: collectionIds})}); },
    async getKnowledgeCollectionItems(id: string) { return (await fetch(`${API_BASE}/knowledge-collections/${encodeURIComponent(id)}/items`)).json() as Promise<{items: Array<{source_type: 'document' | 'memo' | 'email_thread'; source_id: string; title: string; summary: string; updated_at: string; chunk_count?: number; content_html?: string; content?: string; messages?: Array<{id: string; from: string; to: string; cc?: string; date: string; subject: string; body: string; html_body?: string}>; message_count?: number}>}>; },
    async removeKnowledgeCollectionItem(collectionId: string, sourceType: string, sourceId: string) { return (await fetch(`${API_BASE}/knowledge-collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceId)}`, {method: 'DELETE'})).json() as Promise<{ok: boolean; items: import('../types').KnowledgeCollectionItem[]}>; },

    async getProviders(): Promise<ProvidersResponse> {
        const res = await fetch(`${API_BASE}/providers`);
        return res.json();
    },

    async saveProvider(provider: string, apiKey: string, model: string): Promise<ProvidersResponse> {
        const res = await fetch(`${API_BASE}/providers/${provider}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({api_key: apiKey, model})
        });
        return res.json();
    },

    async deleteProvider(provider: string): Promise<ApiSuccessResponse> {
        const res = await fetch(`${API_BASE}/providers/${provider}`, {method: 'DELETE'});
        return res.json();
    },

    async createCustomProvider(data: CustomProviderPayload): Promise<{ok: boolean; id: string}> {
        const res = await fetch(`${API_BASE}/providers/custom`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
        await assertOk(res, 'Unable to create LLM connection.');
        return res.json();
    },

    async updateCustomProvider(id: string, data: CustomProviderPayload): Promise<ApiSuccessResponse> {
        const res = await fetch(`${API_BASE}/providers/custom/${encodeURIComponent(id)}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
        await assertOk(res, 'Unable to update LLM connection.');
        return res.json();
    },

    async deleteCustomProvider(id: string): Promise<ApiSuccessResponse> {
        const res = await fetch(`${API_BASE}/providers/custom/${encodeURIComponent(id)}`, {method: 'DELETE'});
        await assertOk(res, 'Unable to delete LLM connection.');
        return res.json();
    },

    async selectProvider(provider: string, model?: string): Promise<ProvidersResponse> {
        const res = await fetch(`${API_BASE}/provider/select`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({provider, model})
        });
        return res.json();
    },

    async getSystemPrompts(): Promise<SystemPromptsResponse> {
        const res = await fetch(`${API_BASE}/system-prompts`);
        return res.json();
    },

    async createSystemPrompt(title: string, content: string): Promise<SystemPrompt> {
        const res = await fetch(`${API_BASE}/system-prompts`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({title, content})
        });
        return res.json();
    },

    async updateSystemPrompt(id: string, title: string, content: string): Promise<SystemPrompt> {
        const res = await fetch(`${API_BASE}/system-prompts/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({title, content})
        });
        return res.json();
    },

    async deleteSystemPrompt(id: string): Promise<ApiSuccessResponse> {
        const res = await fetch(`${API_BASE}/system-prompts/${id}`, {method: 'DELETE'});
        return res.json();
    },

    async reorderSystemPrompts(promptIds: string[]): Promise<ApiSuccessResponse> {
        const res = await fetch(`${API_BASE}/system-prompts/order`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({prompt_ids: promptIds})});
        return res.json();
    },

    async selectSystemPrompt(promptId: string | null): Promise<ApiSuccessResponse> {
        const res = await fetch(`${API_BASE}/system-prompts/select`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({prompt_id: promptId})
        });
        return res.json();
    },

    async getCurrentSystemPrompt(): Promise<SystemPrompt | null> {
        const res = await fetch(`${API_BASE}/system-prompts/current`);
        return res.json();
    },

    async generateImage(
        prompt: string,
        convId: string,
        messages: Array<{ role: string; content: string }>,
        attachments?: MessageAttachment[],
        onProgress?: (message: string, progress: number) => void,
        overrideModel?: string,
    ): Promise<{ conv_id: string; model: string; filenames: string[]; count: number; assistant_message?: Message }> {
        const res = await fetch(`${API_BASE}/generate-image`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                prompt,
                conv_id: convId,
                messages,
                attachments: attachments ?? [],
                override_model: overrideModel ?? ''
            }),
        });
        await assertOk(res, '이미지 생성 요청 실패');
        if (!res.body) throw new ApiError('스트림을 받을 수 없습니다.');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            for (const line of decoder.decode(value).split('\n')) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = JSON.parse(line.slice(6).trim());
                    if (data.type === 'error') throw new Error(data.message);
                    if (data.type === 'done') return JSON.parse(data.message);
                    if (data.type === 'info' && onProgress) onProgress(data.message, data.progress ?? 0);
                } catch (e) {
                    if (e instanceof Error && e.message !== 'parse error') throw e;
                }
            }
        }
        throw new Error('이미지 생성 응답이 완료되지 않았습니다.');
    },

    async getLlmLogging(): Promise<{ llm_logging: boolean }> {
        const res = await fetch(`${API_BASE}/settings/llm-logging`);
        return res.json();
    },

    async setLlmLogging(enabled: boolean): Promise<{ llm_logging: boolean }> {
        const res = await fetch(`${API_BASE}/settings/llm-logging`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enabled})
        });
        return res.json();
    },

    async getToolLogging(): Promise<{ tool_logging: boolean }> {
        const res = await fetch(`${API_BASE}/settings/tool-logging`);
        return res.json();
    },

    async setToolLogging(enabled: boolean): Promise<{ tool_logging: boolean }> {
        const res = await fetch(`${API_BASE}/settings/tool-logging`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enabled})
        });
        return res.json();
    },

    async getDebugLogging(): Promise<{ debug_logging: boolean }> {
        const res = await fetch(`${API_BASE}/settings/debug-logging`);
        return res.json();
    },

    async setDebugLogging(enabled: boolean): Promise<{ debug_logging: boolean; runtime_restarted: boolean }> {
        const res = await fetch(`${API_BASE}/settings/debug-logging`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enabled})
        });
        if (!res.ok) throw new Error(`Debug logging update failed (${res.status})`);
        return res.json();
    },

    async getRuntimeSettings(): Promise<Record<string, number>> {
        const res = await fetch(`${API_BASE}/settings/runtime`);
        return res.json();
    },

    async setRuntimeSettings(settings: Record<string, number | null>): Promise<Record<string, number | null>> {
        const res = await fetch(`${API_BASE}/settings/runtime`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(settings)
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async getExternalDataConnections(): Promise<{
        connections: Record<string, {has_service_key: boolean; enabled: boolean}>;
    }> {
        const res = await fetch(`${API_BASE}/external-data/connections`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async saveExternalDataConnection(sourceId: string, serviceKey: string): Promise<{
        source_id: string;
        has_service_key: boolean;
    }> {
        const res = await fetch(`${API_BASE}/external-data/connections/${encodeURIComponent(sourceId)}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({service_key: serviceKey}),
        });
        if (!res.ok) throw new Error(await res.text());
        const result = await res.json();
        invalidateExternalDataBootstrap();
        return result;
    },

    async saveExternalDataSourceEnabled(sourceId: string, enabled: boolean): Promise<{
        source_id: string;
        enabled: boolean;
    }> {
        const res = await fetch(`${API_BASE}/external-data/sources/${encodeURIComponent(sourceId)}/enabled`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enabled}),
        });
        if (!res.ok) throw new Error(await res.text());
        const result = await res.json();
        invalidateExternalDataBootstrap();
        return result;
    },

    async getGov24SyncStatus(): Promise<Gov24SyncStatusResponse> {
        const res = await fetch(`${API_BASE}/external-data/sources/kr.gov24/sync`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async startGov24Sync(): Promise<{
        status: string;
        sync_status?: Gov24SyncStatusResponse;
    }> {
        const res = await fetch(`${API_BASE}/external-data/sources/kr.gov24/sync?wait=true`, {method: 'POST'});
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async streamGov24Sync(onStatus: (status: Gov24SyncStatusResponse) => void): Promise<Gov24SyncStatusResponse> {
        return streamSyncStatus(`${API_BASE}/external-data/sources/kr.gov24/sync/events`, onStatus);
    },

    async streamAllExternalDataSync(onStatus: (status: ExternalDataSyncEvent) => void): Promise<ExternalDataSyncEvent> {
        const res = await fetch(`${API_BASE}/external-data/sync/events`, {
            method: 'POST',
            headers: {'Accept': 'text/event-stream'},
        });
        if (!res.ok) throw new Error(await res.text());
        if (!res.body) throw new Error('Synchronization stream is unavailable.');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let latestStatus: ExternalDataSyncEvent = {status: 'running', sources: {}};
        while (true) {
            const {done, value} = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), {stream: !done});
            const messages = buffer.split('\n\n');
            buffer = messages.pop() || '';
            for (const message of messages) {
                const dataLine = message.split('\n').find(line => line.startsWith('data: '));
                if (!dataLine) continue;
                latestStatus = JSON.parse(dataLine.slice(6)) as ExternalDataSyncEvent;
                onStatus(latestStatus);
            }
            if (done) break;
        }
        return latestStatus;
    },

    async getGov24Documents(query = '', cursor?: string): Promise<Gov24DocumentsResponse> {
        const params = new URLSearchParams();
        if (query.trim()) params.set('query', query.trim());
        if (cursor) params.set('cursor', cursor);
        const suffix = params.size ? `?${params.toString()}` : '';
        const res = await fetch(`${API_BASE}/external-data/sources/kr.gov24/documents${suffix}`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async getExternalSourceSyncStatus(sourceId: string): Promise<Gov24SyncStatusResponse> {
        const res = await fetch(`${API_BASE}/external-data/sources/${encodeURIComponent(sourceId)}/sync`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async getExternalDataBootstrap(): Promise<ExternalDataBootstrapResponse> {
        if (externalDataBootstrapCache
            && Date.now() - externalDataBootstrapCachedAt < EXTERNAL_DATA_BOOTSTRAP_CACHE_MS) {
            return externalDataBootstrapCache;
        }
        if (externalDataBootstrapRequest) return externalDataBootstrapRequest;
        const requestVersion = externalDataBootstrapVersion;
        externalDataBootstrapRequest = fetch(`${API_BASE}/external-data/bootstrap`)
            .then(res => res.json() as Promise<ExternalDataBootstrapResponse>)
            .then(result => {
                if (requestVersion === externalDataBootstrapVersion) {
                    externalDataBootstrapCache = result;
                    externalDataBootstrapCachedAt = Date.now();
                }
                return result;
            })
            .finally(() => {
                externalDataBootstrapRequest = null;
            });
        return externalDataBootstrapRequest;
    },

    async startExternalSourceSync(sourceId: string): Promise<{
        status: string;
        sync_status?: Gov24SyncStatusResponse;
    }> {
        const res = await fetch(`${API_BASE}/external-data/sources/${encodeURIComponent(sourceId)}/sync?wait=true`, {method: 'POST'});
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async streamExternalSourceSync(sourceId: string, onStatus: (status: Gov24SyncStatusResponse) => void): Promise<Gov24SyncStatusResponse> {
        return streamSyncStatus(`${API_BASE}/external-data/sources/${encodeURIComponent(sourceId)}/sync/events`, onStatus);
    },

    async getExternalSourceDocuments(sourceId: string, query = '', cursor?: string): Promise<Gov24DocumentsResponse> {
        const params = new URLSearchParams();
        if (query.trim()) params.set('query', query.trim());
        if (cursor) params.set('cursor', cursor);
        const suffix = params.size ? `?${params.toString()}` : '';
        const res = await fetch(`${API_BASE}/external-data/sources/${encodeURIComponent(sourceId)}/documents${suffix}`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async getAllExternalDocuments(query = '', cursor?: string): Promise<AllExternalDocumentsResponse> {
        const params = new URLSearchParams();
        if (query.trim()) params.set('query', query.trim());
        if (cursor) params.set('cursor', cursor);
        const suffix = params.size ? `?${params.toString()}` : '';
        const res = await fetch(`${API_BASE}/external-data/documents${suffix}`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async getGov24SyncSchedule(): Promise<{enabled: boolean; interval_hours: number}> {
        const res = await fetch(`${API_BASE}/external-data/sources/kr.gov24/schedule`);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async saveGov24SyncSchedule(enabled: boolean, intervalHours: number): Promise<{
        enabled: boolean;
        interval_hours: number;
    }> {
        const res = await fetch(`${API_BASE}/external-data/sources/kr.gov24/schedule`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enabled, interval_hours: intervalHours}),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    async getExternalDataCleanup(): Promise<{enabled: boolean; cleanup_status: {status: string; cleanup_date?: string; deleted_count?: number}}> {
        const res = await fetch(`${API_BASE}/external-data/cleanup`);
        if (!res.ok) throw new Error(`Failed to load external data cleanup settings: ${res.status}`);
        return res.json();
    },

    async saveExternalDataCleanup(enabled: boolean): Promise<{enabled: boolean}> {
        const res = await fetch(`${API_BASE}/external-data/cleanup`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enabled}),
        });
        if (!res.ok) throw new Error(`Failed to save external data cleanup settings: ${res.status}`);
        return res.json();
    },

    async saveExternalDataPrompt(instruction: string): Promise<{instruction: string}> {
        const res = await fetch(`${API_BASE}/external-data/prompt`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({instruction}),
        });
        if (!res.ok) throw new Error(`Failed to save external data prompt: ${res.status}`);
        return res.json();
    },

    async getTtsSettings(): Promise<{ rate: number; volume: number; enVoiceURI: string }> {
        const res = await fetch(`${API_BASE}/settings/tts`);
        return res.json();
    },

    async setTtsSettings(settings: { rate: number; volume: number; enVoiceURI: string }): Promise<void> {
        await fetch(`${API_BASE}/settings/tts`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(settings)
        });
    },

    async getMcpSettings(): Promise<{
        kis_app_key: string;
        kis_app_secret: string;
        kis_account_no: string
    }> {
        const res = await fetch(`${API_BASE}/settings/mcp`);
        return res.json();
    },

    async setMcpSettings(settings: {
        kis_app_key?: string;
        kis_app_secret?: string;
        kis_account_no?: string
    }): Promise<void> {
        await fetch(`${API_BASE}/settings/mcp`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(settings)
        });
    },

    async listScripts(): Promise<{ scripts: ScriptPayload[] }> {
        const res = await fetch(`${API_BASE}/scripts`);
        return res.json();
    },

    async getScript(id: string): Promise<ScriptPayload> {
        const res = await fetch(`${API_BASE}/scripts/${id}`);
        return res.json();
    },

    async createScript(data: { title: string; language: string; pairs: ScriptPairPayload[]; raw: string }): Promise<ScriptPayload> {
        const res = await fetch(`${API_BASE}/scripts`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async updateScript(id: string, data: Partial<{
        title: string;
        language: string;
        pairs: ScriptPairPayload[];
        raw: string
    }>): Promise<ScriptPayload> {
        const res = await fetch(`${API_BASE}/scripts/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async deleteScript(id: string): Promise<{ ok: boolean }> {
        const res = await fetch(`${API_BASE}/scripts/${id}`, {method: 'DELETE'});
        return res.json();
    },

    // ── 메모 ───────────────────────────────────────────────────────
    async listMemos(size = 50, from_ = 0) {
        const res = await fetch(`${API_BASE}/memo?size=${size}&from_=${from_}`);
        return res.json();
    },
    async getMemo(id: string) {
        const res = await fetch(`${API_BASE}/memo/${id}`);
        return res.json();
    },
    async createMemo(contentHtml: string, title?: string) {
        const res = await fetch(`${API_BASE}/memo`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content_html: contentHtml, title}),
        });
        return res.json();
    },
    async updateMemo(id: string, contentHtml: string, title?: string) {
        const res = await fetch(`${API_BASE}/memo/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content_html: contentHtml, title}),
        });
        return res.json();
    },
    async deleteMemo(id: string) {
        const res = await fetch(`${API_BASE}/memo/${id}`, {method: 'DELETE'});
        return res.json();
    },
    async uploadMemoAttachment(memoId: string, file: File): Promise<{ filename: string; mime_type: string; url: string }> {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE}/memo/${memoId}/attachments`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || '첨부 파일 업로드에 실패했습니다.');
        return res.json();
    },
    async cleanupMemoAttachments(memoId: string, contentHtml: string): Promise<void> {
        const res = await fetch(`${API_BASE}/memo/${memoId}/attachments/cleanup`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content_html: contentHtml}),
        });
        if (!res.ok) throw new Error('첨부 파일 정리에 실패했습니다.');
    },

    // ── 빠른 메모 (todo형) ──
    async getQuickNotes(): Promise<{ notes: QuickNote[]; total: number }> {
        const res = await fetch(`${API_BASE}/quicknote`);
        return res.json();
    },
    async createQuickNote(text: string): Promise<QuickNote> {
        const res = await fetch(`${API_BASE}/quicknote`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({text}),
        });
        return res.json();
    },
    async updateQuickNote(id: string, text: string): Promise<QuickNote> {
        const res = await fetch(`${API_BASE}/quicknote/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({text}),
        });
        return res.json();
    },
    async toggleQuickNoteDone(id: string, done: boolean): Promise<QuickNote> {
        const res = await fetch(`${API_BASE}/quicknote/${id}/done`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({done}),
        });
        return res.json();
    },
    async deleteQuickNote(id: string): Promise<void> {
        await fetch(`${API_BASE}/quicknote/${id}`, {method: 'DELETE'});
    },
};
