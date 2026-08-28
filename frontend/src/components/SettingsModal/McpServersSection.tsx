import {useEffect, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {waitForGoogleWorkspaceConnection} from '../../services/googleWorkspaceStatus';
import {emitGoogleWorkspaceStatusChanged, emitMcpServersChanged} from '../../utils/mcpEvents';
import CustomSelect from '../CustomSelect/CustomSelect';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {Tooltip} from '../common/Tooltip/Tooltip';
import McpFieldInput, {type McpField as Field} from './McpFieldInput';
import './McpServersSection.css';

interface CatalogEntry {
    label: string;
    kind: string;
    fields: Field[];
    default_prompt?: string;
    singleton?: boolean;
}

interface Server {
    id: string;
    type: string;
    enabled: boolean;
    config: Record<string, any>;
    prompt?: string;
}

interface GoogleAccountConfig {
    id: string;
    mail_mode: 'readonly' | 'draft_only' | 'send';
    mail_notifications: boolean;
}

const createGoogleAccount = (): GoogleAccountConfig => ({
    id: crypto.randomUUID(),
    mail_mode: 'readonly',
    mail_notifications: true,
});

const cleanGoogleWorkspaceConfig = (config: Record<string, any>) => ({
    gauth_json: config.gauth_json,
    active_account_id: config.active_account_id,
    accounts: (Array.isArray(config.accounts) ? config.accounts : []).map((account: GoogleAccountConfig) => ({
        id: account.id,
        mail_mode: account.mail_mode,
        mail_notifications: account.mail_notifications,
    })),
});

const getLocalizedDefaultPrompt = (
    t: (key: string, options?: Record<string, unknown>) => string,
    serverType: string,
    catalogDefaultPrompt = '',
) => t(`mcpDefaultPrompts.${serverType}`, {defaultValue: catalogDefaultPrompt});

const GOOGLE_WORKSPACE_SERVICES = [
    {name: 'Gmail', descriptionKey: 'googleGmailService'},
    {name: 'Google Calendar', descriptionKey: 'googleCalendarService'},
    {name: 'Google Drive', descriptionKey: 'googleDriveService'},
    {name: 'Google Docs', descriptionKey: 'googleDocsService'},
    {name: 'Google Sheets', descriptionKey: 'googleSheetsService'},
    {name: 'Google Slides', descriptionKey: 'googleSlidesService'},
    {name: 'Google Forms', descriptionKey: 'googleFormsService'},
] as const;

type McpServersSectionScope = 'mcp' | 'google';

export default function McpServersSection({scope = 'mcp'}: {scope?: McpServersSectionScope}) {
    const {t} = useTranslation('settings');
    const [catalog, setCatalog] = useState<Record<string, CatalogEntry>>({});
    const [servers, setServers] = useState<Server[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [googleReconnectRequired, setGoogleReconnectRequired] = useState(false);

    const load = async () => {
        try {
            const [c, s] = await Promise.all([api.getMcpCatalog(), api.getMcpServers()]);
            setCatalog(c.catalog || {});
            const nextServers = s.servers || [];
            setServers(nextServers);
            const googleServer = nextServers.find((server: Server) => server.type === 'google_workspace');
            if (scope === 'google') {
                if (googleServer) {
                    setEditingId(googleServer.id);
                    setAdding(false);
                } else {
                    setAdding(true);
                }
            }
            if (googleServer) {
                const status = await api.getGoogleAuthStatus();
                setGoogleReconnectRequired(!status.authenticated);
            } else {
                setGoogleReconnectRequired(false);
            }
        } catch { /* ignore */
        }
    };
    useEffect(() => {
        load();
    }, []);

    const toggleEnabled = async (srv: Server) => {
        const next = !srv.enabled;

        if (next && srv.type === 'google_workspace') {
            try {
                const {authenticated} = await api.getGoogleAuthStatus();
                if (!authenticated) {
                    const activeAccount = (srv.config?.accounts || []).find(
                        (account: GoogleAccountConfig) => account.id === srv.config?.active_account_id,
                    );
                    const gauthJson = srv.config?.gauth_json;
                    if (!activeAccount || !gauthJson) {
                        setErr(t('mcp.oauthMissing'));
                        return;
                    }
                    setServers(prev => prev.map(s => s.id === srv.id ? {...s, enabled: true} : s));
                    const res = await api.updateMcpServer(srv.id, {enabled: true});
                    if (res?.servers) setServers(res.servers);
                    emitMcpServersChanged(res?.servers);
                    await openGoogleOAuthPopup(
                        activeAccount.id,
                        gauthJson,
                        () => {
                            setGoogleReconnectRequired(false);
                            emitGoogleWorkspaceStatusChanged(true);
                            load();
                        },
                        () => {},
                        t,
                    );
                    return;
                }
            } catch { /* ignore */ }
        }

        setServers(prev => prev.map(s => s.id === srv.id ? {...s, enabled: next} : s));
        try {
            const res = await api.updateMcpServer(srv.id, {enabled: next});
            const fresh = res?.servers;
            if (fresh) setServers(fresh);
            emitMcpServersChanged(fresh);
        } catch {
            setServers(prev => prev.map(s => s.id === srv.id ? {...s, enabled: srv.enabled} : s));
            emitMcpServersChanged();
        }
    };

    const handleRemove = async (id: string) => {
        if (busy) return;
        setBusy(true);
        try {
            const r = await api.removeMcpServer(id);
            setServers(r.servers || []);
            if (editingId === id) setEditingId(null);
            emitMcpServersChanged(r.servers);
        } finally {
            setBusy(false);
        }
    };

    const isGoogleScope = scope === 'google';
    const visibleServers = servers.filter(server =>
        isGoogleScope ? server.type === 'google_workspace' : server.type !== 'google_workspace'
    );
    const visibleCatalog = Object.fromEntries(Object.entries(catalog).filter(([type]) =>
        isGoogleScope ? type === 'google_workspace' : type !== 'google_workspace'
    ));

    return (
        <div className="mcp-section">
            <div className="mcp-head">
                <span className="mcp-title">{t(isGoogleScope ? 'mcp.googleTitle' : 'mcp.title')}</span>
                {!isGoogleScope && (
                    <button className="mcp-add-btn" onClick={() => {
                        setAdding(true);
                        setErr('');
                    }}>
                        {t('mcp.add')}
                    </button>
                )}
            </div>
            <div className="mcp-desc">{t(isGoogleScope ? 'mcp.googleDesc' : 'mcp.desc')}</div>

            {err && !adding && <div className="mcp-err">{err}</div>}

            {visibleServers.length === 0 && !adding && <div className="mcp-empty">{t(isGoogleScope ? 'mcp.googleEmpty' : 'mcp.empty')}</div>}

            <div className="mcp-list">
                {visibleServers.map(srv => {
                    const cat = catalog[srv.type];
                    const displayName = ((srv.type === 'custom' || srv.type === 'custom_remote') && srv.config?.name)
                        ? srv.config.name
                        : (t(`mcpCatalog.servers.${srv.type}`, {defaultValue: cat?.label || srv.type}));
                    return (
                        <div key={srv.id} className="mcp-item">
                            {!isGoogleScope && <>
                                <div className="mcp-item-row">
                                    <label className="mcp-switch">
                                        <input type="checkbox" checked={srv.enabled}
                                               onChange={() => toggleEnabled(srv)}/>
                                        <span className="mcp-slider"/>
                                    </label>
                                    <span className="mcp-item-label">{displayName}</span>
                                    <div className="mcp-item-actions">
                                        <button className="mcp-icon-btn"
                                                onClick={() => setEditingId(editingId === srv.id ? null : srv.id)}>
                                            {t('mcp.edit')}
                                        </button>
                                        <button className="mcp-icon-btn mcp-danger"
                                                onClick={() => setConfirmId(srv.id)} disabled={busy}>
                                            {t('mcp.delete')}
                                        </button>
                                    </div>
                                </div>
                                {srv.type === 'google_workspace' && googleReconnectRequired && (
                                    <div className="google-reconnect-notice">
                                        {t('mcp.googleConnectionRequired')}
                                    </div>
                                )}
                                {confirmId === srv.id && (
                                    <div className="mcp-confirm">
                                        <span className="mcp-confirm-text">
                                            {t('mcp.confirmDelete', {name: displayName})}
                                        </span>
                                        <div className="mcp-form-actions">
                                            <button className="mcp-btn-ghost"
                                                    onClick={() => setConfirmId(null)}>{t('mcp.cancel')}
                                            </button>
                                            <button className="mcp-btn-danger"
                                                    onClick={() => {
                                                        setConfirmId(null);
                                                        handleRemove(srv.id);
                                                    }}
                                                    disabled={busy}>{t('mcp.delete')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>}
                            {(isGoogleScope || editingId === srv.id) && cat && (
                                <ServerForm
                                    fields={cat.fields}
                                    initial={srv.config}
                                    initialPrompt={
                                        srv.prompt && srv.prompt !== cat.default_prompt
                                            ? srv.prompt
                                            : getLocalizedDefaultPrompt(t, srv.type, cat.default_prompt)
                                    }
                                    hasDefaultPrompt={!!cat.default_prompt}
                                    serverType={srv.type}
                                    serverId={srv.id}
                                    onRefresh={setServers}
                                    onGoogleAuthChanged={load}
                                    onGoogleConnected={accountId => {
                                        // OAuth 계정 연결은 MCP 도구 활성화와 독립적이다.
                                        // 최초 등록 시에는 off지만, 이후 계정 연결은 사용자가 선택한 상태를 유지한다.
                                        window.dispatchEvent(new CustomEvent('vyact:google-account-changed', {
                                            detail: {accountId},
                                        }));
                                    }}
                                    onCancel={() => setEditingId(null)}
                                    onGoogleConfigSave={async config => {
                                        const r = await api.updateMcpServer(srv.id, {config});
                                        setServers(r.servers || []);
                                        emitMcpServersChanged(r.servers);
                                    }}
                                    onGoogleCredentialSave={async (config, prompt) => {
                                        const r = await api.updateMcpServer(srv.id, {config, prompt});
                                        setServers(r.servers || []);
                                        emitMcpServersChanged(r.servers);
                                    }}
                                    onSave={async (config, prompt) => {
                                        setBusy(true);
                                        try {
                                            const r = await api.updateMcpServer(srv.id, {config, prompt});
                                            setServers(r.servers || []);
                                            setEditingId(null);
                                            emitMcpServersChanged(r.servers);
                                        } finally {
                                            setBusy(false);
                                        }
                                    }}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            {adding && (
                <AddServerForm
                    catalog={visibleCatalog}
                    servers={servers}
                    fixedType={isGoogleScope ? 'google_workspace' : undefined}
                    err={err}
                    onErr={setErr}
                    onCancel={() => setAdding(false)}
                    onAdd={async (type, config, prompt) => {
                        setBusy(true);
                        setErr('');
                        try {
                            // Google 계정 연결과 AI 도구 활성화는 별도 선택이다.
                            // OAuth 설정을 마쳐도 사용자가 직접 켜기 전까지 기본 비활성 상태를 유지한다.
                            const enabledByDefault = type !== 'google_workspace';
                            const result = await api.addMcpServer(type, config, enabledByDefault, prompt);
                            const nextServers = [...servers, result.server];
                            setServers(nextServers);
                            emitMcpServersChanged(nextServers);
                            setAdding(false);
                            if (type === 'google_workspace') setEditingId(result.server.id);
                            await load();
                            return result.server;
                        } catch (e: any) {
                            setErr(e?.message || t('mcp.addFailed'));
                            return undefined;
                        } finally {
                            setBusy(false);
                        }
                    }}
                />
            )}
        </div>
    );
}

// ── Google OAuth 팝업 공통 헬퍼 ──────────────────────────────────────
async function openGoogleOAuthPopup(
    accountId: string,
    gauthJson: string | object,
    onSuccess: () => void | Promise<void>,
    onFail: (msg: string) => void,
    t: (key: string) => string,
) {
    const {auth_url} = await api.getGoogleAuthUrl(accountId, gauthJson);
    window.open(auth_url, 'google-auth', 'width=500,height=700,popup=yes');
    const connected = await waitForGoogleWorkspaceConnection(accountId);
    if (connected) {
        await onSuccess();
        return;
    }
    onFail(t('mcp.authTimeout'));
}

function GoogleAccountsEditor({value, onChange, onPersist, onCredentialUpload, onAuthChanged, onConnected}: {
    value: Record<string, any>;
    onChange: (value: Record<string, any>) => void;
    onPersist?: (value: Record<string, any>) => Promise<void>;
    onCredentialUpload?: (value: Record<string, any>) => Promise<void>;
    onAuthChanged?: () => void | Promise<void>;
    onConnected?: (accountId: string) => void | Promise<void>;
}) {
    const {t} = useTranslation('settings');
    const accounts: GoogleAccountConfig[] = Array.isArray(value.accounts) ? value.accounts : [];
    const [statuses, setStatuses] = useState<Record<string, {authenticated: boolean; email?: string}>>({});
    const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [credentialError, setCredentialError] = useState('');
    const [removeAccountId, setRemoveAccountId] = useState<string | null>(null);
    const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

    const refreshStatuses = async () => {
        const status = await api.getGoogleAuthStatus();
        setStatuses(Object.fromEntries(
            (status.accounts || []).map(account => [account.id, account]),
        ));
    };

    useEffect(() => {
        refreshStatuses().catch(() => {});
        // Account IDs are the stable identity; field edits must not trigger status polling.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts.map(account => account.id).join(',')]);

    const persist = async (nextValue: Record<string, any>): Promise<boolean> => {
        if (!onPersist) return true;
        try {
            const request = persistQueueRef.current.then(
                () => onPersist(cleanGoogleWorkspaceConfig(nextValue)),
            );
            persistQueueRef.current = request.catch(() => undefined);
            await request;
            return true;
        } catch (persistError: any) {
            setError(persistError?.message || t('mcp.saveFailed'));
            return false;
        }
    };
    const updateAccount = (accountId: string, patch: Partial<GoogleAccountConfig>) => {
        const nextValue = {
            ...value,
            accounts: accounts.map(account => account.id === accountId ? {...account, ...patch} : account),
        };
        onChange(nextValue);
        void persist(nextValue);
    };
    const findOldestConnectedAccountId = (excludedAccountId: string) => accounts.find(
        account => account.id !== excludedAccountId && statuses[account.id]?.authenticated,
    )?.id || '';
    const removeAccount = async (accountId: string) => {
        setBusyAccountId(accountId);
        try {
            if (statuses[accountId]?.authenticated !== false) {
                await api.disconnectGoogle(accountId);
            }
            const oldestConnectedAccountId = findOldestConnectedAccountId(accountId);
            const nextAccounts = accounts.filter(account => account.id !== accountId);
            const nextValue = {
                ...value,
                accounts: nextAccounts,
                active_account_id: value.active_account_id === accountId
                    ? oldestConnectedAccountId
                    : value.active_account_id,
            };
            onChange(nextValue);
            if (await persist(nextValue)) setRemoveAccountId(null);
            emitGoogleWorkspaceStatusChanged(Boolean(oldestConnectedAccountId));
            await onAuthChanged?.();
        } finally {
            setBusyAccountId(null);
        }
    };
    const connect = async (account: GoogleAccountConfig) => {
        if (!value.gauth_json) {
            setCredentialError(t('mcp.oauthFileMissing'));
            return;
        }
        setCredentialError('');
        setError('');
        setBusyAccountId(account.id);
        try {
            await openGoogleOAuthPopup(
                account.id,
                value.gauth_json,
                async () => {
                    const nextValue = {
                        ...value,
                        // 방금 연결한 계정으로 패널/API가 즉시 전환되어야 한다.
                        // 기존에 선택된 슬롯이 미연결 상태여도 그대로 두면
                        // 패널은 그 미연결 계정으로 요청해 빈 화면이 된다.
                        active_account_id: account.id,
                    };
                    onChange(nextValue);
                    await persist(nextValue);
                    // OAuth 콜백은 Gmail 프로필에서 이메일까지 저장한다. 연결 여부만
                    // 낙관적으로 갱신하면 이번 모달에서는 이메일이 비어 있으므로,
                    // 저장된 서버 상태를 다시 읽어 즉시 표시한다.
                    await refreshStatuses();
                    await onConnected?.(account.id);
                    emitGoogleWorkspaceStatusChanged(true);
                    await onAuthChanged?.();
                },
                setError,
                t,
            );
        } finally {
            setBusyAccountId(null);
        }
    };
    const oauthField: Field = {key: 'gauth_json', label: 'OAuth 자격증명 (.gauth.json)', type: 'file_json', required: true};
    const mailModeField: Field = {
        key: 'mail_mode',
        label: '이메일 쓰기 권한',
        type: 'select',
        options: [
            {value: 'readonly', label: '읽기 전용'},
            {value: 'draft_only', label: '초안만 허용'},
            {value: 'send', label: '발송 허용'},
        ],
    };
    const notificationField: Field = {key: 'mail_notifications', label: '알림 받기', type: 'toggle'};
    const removeAccountIndex = accounts.findIndex(account => account.id === removeAccountId);
    const removeAccountLabel = removeAccountId
        ? statuses[removeAccountId]?.email || t('mcp.googleAccount', {
            number: removeAccountIndex + 1,
            defaultValue: `Google account ${removeAccountIndex + 1}`,
        })
        : '';

    return <div className="google-accounts">
        <McpFieldInput field={oauthField} value={value.gauth_json}
                    onChange={gauth_json => {
                        setCredentialError('');
                        const nextValue = {...value, gauth_json};
                        onChange(nextValue);
                        if (onCredentialUpload && gauth_json) {
                            void onCredentialUpload(cleanGoogleWorkspaceConfig(nextValue));
                        } else if (onPersist) {
                            void persist(nextValue);
                        }
                    }}/>
        {credentialError && <div className="mcp-err">{credentialError}</div>}
        {accounts.map((account, index) => (
            <section className={`google-account-card ${value.active_account_id === account.id ? 'active' : ''}`} key={account.id}>
                <div className="google-account-card-head">
                    <label className="google-account-active">
                        <input type="radio" name="active-google-account"
                               checked={value.active_account_id === account.id}
                               disabled={!statuses[account.id]?.authenticated}
                               onChange={async () => {
                                   const nextValue = {...value, active_account_id: account.id};
                                   onChange(nextValue);
                                   try {
                                       await api.activateGoogleAccount(account.id);
                                       await persist(nextValue);
                                       emitGoogleWorkspaceStatusChanged(true);
                                   } catch (activateError: any) {
                                       setError(activateError?.message || t('mcp.saveFailed'));
                                   }
                               }}/>
                        <span>{t('mcp.googleAccount', {number: index + 1, defaultValue: `Google account ${index + 1}`})}</span>
                    </label>
                    {statuses[account.id]?.authenticated ? (
                        <span className="google-oauth-ok">
                            {statuses[account.id]?.email || t('mcp.connected')}
                        </span>
                    ) : (
                        <button type="button" className="mcp-btn-connect" onClick={() => connect(account)}
                                disabled={busyAccountId === account.id}>
                            {busyAccountId === account.id ? t('mcp.connecting') : t('mcp.connect')}
                        </button>
                    )}
                    <button type="button" className="mcp-icon-btn mcp-danger"
                            onClick={() => {
                                if (statuses[account.id]?.authenticated === false) {
                                    void removeAccount(account.id);
                                    return;
                                }
                                setRemoveAccountId(account.id);
                            }}
                            disabled={busyAccountId === account.id}>
                        {t('mcp.removeAccount')}
                    </button>
                </div>
                <GoogleMailSettingsFields
                    mailModeField={mailModeField}
                    notificationField={notificationField}
                    mailMode={account.mail_mode}
                    notificationsEnabled={account.mail_notifications}
                    onMailModeChange={mail_mode => updateAccount(account.id, {mail_mode: mail_mode as GoogleAccountConfig['mail_mode']})}
                    onNotificationsChange={mail_notifications => updateAccount(account.id, {mail_notifications})}/>
            </section>
        ))}
        <button type="button" className="mcp-add-account-btn" onClick={() => {
            const account = createGoogleAccount();
            const nextValue = {
                ...value,
                accounts: [...accounts, account],
                active_account_id: value.active_account_id || account.id,
            };
            onChange(nextValue);
            void persist(nextValue);
        }}>+ {t('mcp.addGoogleAccount')}</button>
        {error && <div className="mcp-err">{error}</div>}
        {removeAccountId && <ConfirmModal
            title={t('mcp.confirmRemoveGoogleAccountTitle', {account: removeAccountLabel})}
            description={t('mcp.confirmRemoveGoogleAccountDescription')}
            options={[
                {label: t('mcp.cancel'), value: 'cancel'},
                {label: t('mcp.removeAccount'), value: 'remove', variant: 'danger'},
            ]}
            onSelect={value => {
                if (value === 'remove') void removeAccount(removeAccountId);
                else setRemoveAccountId(null);
            }}
            onClose={() => setRemoveAccountId(null)}
            actionLayout="horizontal"
            loading={busyAccountId === removeAccountId}
            loadingValue="remove"
        />}
    </div>;
}


// ── 필드 입력 폼 (편집) ──────────────────────────────────────────────
function ServerForm({
    fields,
    initial,
    initialPrompt,
    hasDefaultPrompt,
    serverType,
    onSave,
    onCancel,
    onGoogleConfigSave,
    onGoogleCredentialSave,
    onGoogleAuthChanged,
    onGoogleConnected,
}: {
    fields: Field[];
    initial: Record<string, any>;
    initialPrompt: string;
    hasDefaultPrompt?: boolean;
    serverType?: string;
    serverId?: string;
    onSave: (config: Record<string, any>, prompt: string) => void | Promise<void>;
    onCancel: () => void;
    onRefresh?: (servers: Server[]) => void;
    onGoogleAuthChanged?: () => void;
    onGoogleConnected?: (accountId: string) => void | Promise<void>;
    onGoogleConfigSave?: (config: Record<string, any>) => Promise<void>;
    onGoogleCredentialSave?: (config: Record<string, any>, prompt: string) => Promise<void>;
}) {
    const {t} = useTranslation('settings');
    const [values, setValues] = useState<Record<string, any>>(() => ({...initial}));
    const [prompt, setPrompt] = useState(initialPrompt);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
    const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isGoogle = serverType === 'google_workspace';

    useEffect(() => () => {
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    }, []);

    const markChanged = () => {
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        setSaveState('idle');
    };
    const setV = (k: string, v: any) => {
        markChanged();
        setValues(prev => ({...prev, [k]: v}));
    };
    const handleValuesChange = (nextValues: Record<string, any>) => {
        markChanged();
        setValues(nextValues);
    };
    const handleSave = async () => {
        setSaveState('saving');
        try {
            await onSave(values, prompt);
            setSaveState('saved');
            savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2200);
        } catch {
            setSaveState('failed');
            savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2200);
        }
    };

    return (
        <div className="mcp-form">
            {isGoogle && <GoogleWorkspaceGuide/>}
            {isGoogle && <GoogleAccountsEditor value={values} onChange={handleValuesChange}
                                                onPersist={onGoogleConfigSave}
                                                onAuthChanged={onGoogleAuthChanged}
                                                onConnected={onGoogleConnected}
                                                onCredentialUpload={config => (
                                                    onGoogleCredentialSave?.(config, prompt) ?? Promise.resolve()
                                                )}/>}
            {!isGoogle && fields.map((field, index) => {
                const notificationField = fields[index + 1];
                if (field.key === 'mail_notifications' && fields[index - 1]?.key === 'mail_mode') return null;
                if (field.key === 'mail_mode' && notificationField?.key === 'mail_notifications') {
                    return <GoogleMailSettingsFields key={field.key} mailModeField={field} notificationField={notificationField}
                        mailMode={values[field.key]} notificationsEnabled={Boolean(values[notificationField.key])}
                        onMailModeChange={(v) => setV(field.key, v)} onNotificationsChange={(v) => setV(notificationField.key, v)}/>;
                }
                return <McpFieldInput key={field.key} field={field} value={values[field.key]} onChange={(v) => setV(field.key, v)}/>;
            })}
            <div className={`mcp-field${isGoogle ? ' mcp-prompt-section' : ''}`}>
                <label className="mcp-field-label">{t('mcp.promptLabel')}</label>
                <textarea
                    className="mcp-input mcp-prompt-textarea"
                    placeholder={hasDefaultPrompt
                        ? t('mcp.promptDefaultPlaceholder')
                        : t('mcp.promptEmptyPlaceholder')}
                    value={prompt}
                    onChange={e => {
                        markChanged();
                        setPrompt(e.target.value);
                    }}
                />
            </div>
            <div className="mcp-form-actions">
                {!isGoogle && <button className="mcp-btn-ghost" onClick={onCancel}>{t('mcp.cancel')}</button>}
                <button className={`mcp-btn-primary${saveState === 'saved' ? ' is-saved' : saveState === 'failed' ? ' is-failed' : ''}`}
                        onClick={() => void handleSave()} disabled={saveState === 'saving'}>
                    {saveState === 'saving'
                        ? t('common:saving')
                        : saveState === 'saved'
                            ? `✓ ${t('apiKeyField.savedMsg')}`
                            : saveState === 'failed'
                                ? t('mcp.saveFailed')
                                : t('mcp.save')}
                </button>
            </div>
        </div>
    );
}

// ── 서버 추가 폼 ────────────────────────────────────────
function AddServerForm({catalog, servers, fixedType, err, onErr, onAdd, onCancel}: {
    catalog: Record<string, CatalogEntry>;
    servers: Server[];
    fixedType?: string;
    err: string;
    onErr: (s: string) => void;
    onAdd: (type: string, config: Record<string, any>, prompt: string) => void | Promise<Server | void>;
    onCancel: () => void;
}) {
    const {t} = useTranslation('settings');
    const existingTypes = new Set(servers.map(s => s.type));
    const allTypes = Object.keys(catalog);
    const types = ['custom', 'custom_remote', ...allTypes.filter(t => t !== 'custom' && t !== 'custom_remote')]
        .filter(t => catalog[t])
        .filter(t => !(catalog[t].singleton && existingTypes.has(t)));
    const [type, setType] = useState(fixedType || types[0] || '');
    const [values, setValues] = useState<Record<string, any>>({});
    const [prompt, setPrompt] = useState('');
    const registeringGoogleRef = useRef(false);

    useEffect(() => {
        const cat = catalog[type];
        const defaults: Record<string, any> = {};
        cat?.fields.forEach(f => {
            if (f.type === 'select' && f.options?.length) {
                defaults[f.key] = f.options[0].value;
            }
        });
        if (type === 'google_workspace') {
            const account = createGoogleAccount();
            defaults.accounts = [account];
            defaults.active_account_id = account.id;
        }
        setValues(defaults);
        // 새 서버의 프롬프트는 선택 입력값이다. 비워서 저장하면 서버 카탈로그의
        // 기본 프롬프트가 런타임에 적용되므로, 추가 폼에는 미리 채우지 않는다.
        setPrompt('');
        onErr('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type]);

    const cat = catalog[type];
    const setV = (k: string, v: any) => setValues(prev => ({...prev, [k]: v}));
    const isGoogle = type === 'google_workspace';
    const registerGoogle = async (config: Record<string, any>) => {
        if (registeringGoogleRef.current) return;
        registeringGoogleRef.current = true;
        const server = await onAdd(type, cleanGoogleWorkspaceConfig(config), prompt);
        if (!server) {
            registeringGoogleRef.current = false;
        }
    };

    return (
        <div className="mcp-form mcp-add-form">
            {!fixedType && <div className="mcp-field">
                <label className="mcp-field-label">{t('mcp.serverType')}</label>
                <CustomSelect
                    options={types.map(tp => ({value: tp, label: t(`mcpCatalog.servers.${tp}`, {defaultValue: catalog[tp].label})}))}
                    value={type}
                    onChange={setType}
                />
            </div>}
            {isGoogle && <GoogleWorkspaceGuide/>}
            {isGoogle && <GoogleAccountsEditor value={values} onChange={setValues}
                                                onCredentialUpload={registerGoogle}/>}
            {!isGoogle && cat?.fields.map((field, index) => {
                const notificationField = cat.fields[index + 1];
                if (field.key === 'mail_notifications' && cat.fields[index - 1]?.key === 'mail_mode') return null;
                if (field.key === 'mail_mode' && notificationField?.key === 'mail_notifications') {
                    return <GoogleMailSettingsFields key={field.key} mailModeField={field} notificationField={notificationField}
                        mailMode={values[field.key]} notificationsEnabled={Boolean(values[notificationField.key])}
                        onMailModeChange={(v) => setV(field.key, v)} onNotificationsChange={(v) => setV(notificationField.key, v)}/>;
                }
                return <McpFieldInput key={field.key} field={field} value={values[field.key]} onChange={(v) => setV(field.key, v)}/>;
            })}
            <div className={`mcp-field${isGoogle ? ' mcp-prompt-section' : ''}`}>
                <label className="mcp-field-label">{t('mcp.promptLabel')}</label>
                <textarea
                    className="mcp-input mcp-prompt-textarea"
                    placeholder={cat?.default_prompt
                        ? t('mcp.promptDefaultPlaceholder')
                        : t('mcp.promptEmptyPlaceholder')}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                />
            </div>
            {err && <div className="mcp-err">{err}</div>}
            <div className="mcp-form-actions">
                {!isGoogle && <button className="mcp-btn-ghost" onClick={onCancel}>{t('mcp.cancel')}</button>}
                <button className="mcp-btn-primary"
                        onClick={() => isGoogle
                            ? registerGoogle(values)
                            : onAdd(type, values, prompt)}>
                    {isGoogle ? t('mcp.save') : t('mcp.add')}
                </button>
            </div>
        </div>
    );
}

// ── 필드 타입별 입력 위젯 ────────────────────────────────────────────
function GoogleMailSettingsFields({mailModeField, notificationField, mailMode, notificationsEnabled, onMailModeChange, onNotificationsChange}: {
    mailModeField: Field;
    notificationField: Field;
    mailMode: string;
    notificationsEnabled: boolean;
    onMailModeChange: (value: string) => void;
    onNotificationsChange: (value: boolean) => void;
}) {
    const {t} = useTranslation('settings');
    const fieldIdPrefix = useId();
    const label = (field: Field) => t(`mcpCatalog.fields.${field.key}`, {defaultValue: field.label});
    const notificationInputId = `${fieldIdPrefix}-${notificationField.key}`;

    return <div className="mcp-mail-settings">
        <span className="mcp-field-label">{label(mailModeField)}</span>
        <label className="mcp-field-label mcp-notification-label" htmlFor={notificationInputId}>
            <Tooltip content={t('mcpCatalog.fields.mail_notifications_help')} multiline size="medium">
                <span className="mcp-notification-help" tabIndex={0} role="img"
                      aria-label={t('mcpCatalog.fields.mail_notifications_help')}
                      onClick={event => event.preventDefault()}>?</span>
            </Tooltip>
            <span>{label(notificationField)}</span>
        </label>
        <CustomSelect
            options={(mailModeField.options || []).map(option => ({value: option.value, label: t(`mcpCatalog.options.${option.value}`, {defaultValue: option.label})}))}
            value={mailMode || mailModeField.options?.[0]?.value || ''}
            onChange={onMailModeChange}
        />
        <div className="mcp-mail-toggle-control">
            <label className="mcp-switch">
                <input id={notificationInputId} type="checkbox" checked={notificationsEnabled}
                       onChange={event => onNotificationsChange(event.target.checked)}/>
                <span className="mcp-slider"/>
            </label>
        </div>
    </div>;
}

// ── Google Workspace 셋업 가이드 ──────────────────────────────────────
function GoogleWorkspaceGuide() {
    const {t} = useTranslation('settings');
    const [open, setOpen] = useState(false);

    return (
        <div className="gw-guide">
            <button className="gw-guide-toggle" onClick={() => setOpen(!open)}>
                <span className={`gw-guide-arrow ${open ? 'open' : ''}`}>▶</span>
                <span>{t('mcp.googleGuideTitle')}</span>
            </button>
            {open && (
                <div className="gw-guide-body">
                    <section className="gw-services" aria-labelledby="gw-services-title">
                        <h4 id="gw-services-title">{t('mcp.googleServicesTitle')}</h4>
                        <ul className="gw-services-list">
                            {GOOGLE_WORKSPACE_SERVICES.map(({name, descriptionKey}) => (
                                <li key={name}>
                                    <strong>{name}</strong>
                                    <span>{t(`mcp.${descriptionKey}`)}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                    <div className="gw-step">
                        <span className="gw-step-num">1</span>
                        <div className="gw-step-content">
                            <a href="https://console.cloud.google.com/projectcreate"
                               target="_blank" rel="noreferrer">Google Cloud Console</a> — {t('mcp.googleStep1')}
                        </div>
                    </div>
                    <div className="gw-step">
                        <span className="gw-step-num">2</span>
                        <div className="gw-step-content">
                            <a href="https://console.cloud.google.com/apis/library" target="_blank"
                               rel="noreferrer">API Library</a> — {t('mcp.googleStep2')}
                        </div>
                    </div>
                    <div className="gw-step">
                        <span className="gw-step-num">3</span>
                        <div className="gw-step-content">
                            <a href="https://console.cloud.google.com/auth/clients"
                               target="_blank" rel="noreferrer">OAuth</a> — {t('mcp.googleStep3')}
                        </div>
                    </div>
                    <div className="gw-step">
                        <span className="gw-step-num">4</span>
                        <div className="gw-step-content">
                            <a href="https://console.cloud.google.com/auth/audience"
                               target="_blank" rel="noreferrer">Audience</a> — {t('mcp.googleStep4')}
                        </div>
                    </div>
                    <div className="gw-step">
                        <span className="gw-step-num">5</span>
                        <div className="gw-step-content">
                            {t('mcp.googleStep5')}
                        </div>
                    </div>
                    <div className="gw-guide-note">
                        {t('mcp.googleNote')}
                    </div>
                </div>
            )}
        </div>
    );
}
