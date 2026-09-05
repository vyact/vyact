import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import WorkspaceMailSettingsFields from './WorkspaceMailSettingsFields';
import WorkspaceSetupGuide from './WorkspaceSetupGuide';
import {microsoftRequest, MICROSOFT_WORKSPACE_CHANGED, type MicrosoftConfig, type MicrosoftStatus} from '../../services/microsoftWorkspace';
import './McpServersSection.css';

const EMPTY_CONFIG: MicrosoftConfig = {client_id: '', active_account_id: '', accounts: []};
export default function MicrosoftWorkspaceSection() {
    const {t} = useTranslation('settings');
    const [config, setConfig] = useState<MicrosoftConfig>({...EMPTY_CONFIG, prompt: t('microsoft.defaultPrompt')});
    const [status, setStatus] = useState<MicrosoftStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const mounted = useRef(true);
    const busyRef = useRef(false);
    useEffect(() => {
        mounted.current = true;
        void microsoftRequest('/status').then(value => {
            if (!mounted.current) return;
            setStatus(value); setConfig({...EMPTY_CONFIG, prompt: t('microsoft.defaultPrompt'), ...value.config});
        }).catch(() => setError(t('mcp.saveFailed')));
        return () => { mounted.current = false; };
    }, []);
    const persist = async (next: MicrosoftConfig) => {
        const value = await microsoftRequest('/config', 'PUT', next);
        if (mounted.current) { setStatus(value); setConfig({...next, ...value.config}); }
        window.dispatchEvent(new Event(MICROSOFT_WORKSPACE_CHANGED));
        return value;
    };
    const perform = async (action: () => Promise<unknown>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true); setError('');
        try { await action(); } catch { if (mounted.current) setError(t('microsoft.requestFailed')); }
        finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    };
    const connect = (id: string) => perform(async () => {
        await persist(config);
        const {url} = await microsoftRequest<{url: string}>(`/accounts/${id}/connect`, 'POST');
        window.open(url, '_blank', 'noopener,noreferrer');
        const deadline = Date.now() + 150_000;
        while (mounted.current && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!mounted.current) return;
            const value = await microsoftRequest('/status');
            setStatus(value);
            if (value.accounts.some(account => account.id === id && account.authenticated)) {
                window.dispatchEvent(new Event(MICROSOFT_WORKSPACE_CHANGED));
                return;
            }
        }
        if (mounted.current) throw new Error('timeout');
    });
    return <div className="mcp-section">
        <div className="mcp-head"><span className="mcp-title">{t('microsoft.title')}</span></div>
        <div className="mcp-desc">{t('microsoft.description')}</div>
        <div className="mcp-list"><div className="mcp-item"><div className="mcp-form">
            <WorkspaceSetupGuide title={t('mcp.googleGuideTitle')}>
                <div className="gw-step">
                    <span className="gw-step-num">1</span>
                    <div className="gw-step-content">
                        <a href="https://azure.microsoft.com/free/" target="_blank" rel="noreferrer">{t('microsoft.guideAzureTitle')}</a>
                        {' — '}{t('microsoft.guideAzure')}
                    </div>
                </div>
                {['register', 'guideAccounts', 'guideRedirect', 'guideClient'].map((key, index) => <div className="gw-step" key={key}>
                    <span className="gw-step-num">{index + 2}</span>
                    <div className="gw-step-content">{index === 0
                        ? <a href="https://portal.azure.com/" target="_blank" rel="noreferrer">{t(`microsoft.${key}`)}</a>
                        : t(`microsoft.${key}`, {redirectUri: status?.redirect_uri || 'http://localhost:8000/api/microsoft-workspace/oauth/callback'})}</div>
                </div>)}
                <div className="gw-guide-note">
                    {t('microsoft.guideTenantError')}
                    <div className="gw-step-content">
                        <a href="https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/error-code-aadsts50020-user-account-identity-provider-does-not-exist#cause-1users-log-in-to-microsoft-entra-admin-center-by-using-personal-microsoft-accounts" target="_blank" rel="noreferrer">{t('microsoft.guideTroubleshooting')}</a>
                    </div>
                </div>
            </WorkspaceSetupGuide>
            <div className="google-accounts">
            <label className="mcp-field"><span className="mcp-field-label">{t('microsoft.clientId')}</span>
                <input className="mcp-input" value={config.client_id} onChange={event => setConfig({...config, client_id: event.target.value.trim()})} disabled={busy}/>
            </label>
            {config.accounts.map((account, index) => {
                const connection = status?.accounts.find(item => item.id === account.id);
                return <section key={account.id} className={`google-account-card ${config.active_account_id === account.id ? 'active' : ''}`}>
                    <div className="google-account-card-head">
                        <label className="google-account-active"><input type="radio" name="active-microsoft-account" checked={config.active_account_id === account.id} disabled={busy || !connection?.authenticated} onChange={() => void perform(async () => {
                            await microsoftRequest(`/accounts/${account.id}/activate`, 'POST');
                            await persist({...config, active_account_id: account.id});
                        })}/><span>{t('microsoft.account', {number: index + 1})}</span></label>
                        {connection?.authenticated ? <span className="google-oauth-ok">{connection.email}</span> : <button className="mcp-btn-connect" disabled={busy || !config.client_id} onClick={() => void connect(account.id)}>{t(busy ? 'mcp.connecting' : 'mcp.connect')}</button>}
                        <button className="mcp-icon-btn mcp-danger" disabled={busy} onClick={() => void perform(async () => {
                            const accounts = config.accounts.filter(item => item.id !== account.id);
                            await persist({...config, accounts, active_account_id: config.active_account_id === account.id ? accounts[0]?.id || '' : config.active_account_id});
                        })}>{t('mcp.removeAccount')}</button>
                    </div>
                    <WorkspaceMailSettingsFields disabled={busy} notificationHelp={t('microsoft.notificationHelp')}
                        mailModeField={{key: 'mail_mode', type: 'select', label: t('main:uiAudit.googleMailPermission'), options: [
                            {value: 'readonly', label: t('main:uiAudit.googleMailReadonly')},
                            {value: 'draft_only', label: t('main:uiAudit.googleMailDraftOnly')},
                            {value: 'send', label: t('main:uiAudit.googleMailSend')},
                        ]}}
                        notificationField={{key: 'mail_notifications', type: 'toggle', label: t('main:uiAudit.googleMailNotifications')}}
                        mailMode={account.mail_mode} notificationsEnabled={account.mail_notifications}
                        onMailModeChange={mode => void perform(() => persist({...config, accounts: config.accounts.map(item => item.id === account.id ? {...item, mail_mode: mode as 'readonly' | 'draft_only' | 'send'} : item)}))}
                        onNotificationsChange={enabled => void perform(() => persist({...config, accounts: config.accounts.map(item => item.id === account.id ? {...item, mail_notifications: enabled} : item)}))}/>
                </section>;
            })}
            <button className="mcp-add-account-btn" disabled={busy} onClick={() => void perform(() => {
                const account = {id: crypto.randomUUID(), mail_mode: 'readonly' as const, mail_notifications: false};
                return persist({...config, accounts: [...config.accounts, account], active_account_id: config.active_account_id || account.id});
            })}>{t('microsoft.addAccount')}</button>
            </div>
            <label className="mcp-field mcp-prompt-section"><span className="mcp-field-label">{t('mcp.promptLabel')}</span><textarea className="mcp-input mcp-prompt-textarea" value={config.prompt || ''} onChange={event => setConfig({...config, prompt: event.target.value})} disabled={busy}/></label>
            <div className="mcp-form-actions"><button className="mcp-btn-primary" disabled={busy} onClick={() => void perform(() => persist(config))}>{t(busy ? 'common:saving' : 'mcp.save')}</button></div>
            {error && <div className="mcp-err" role="alert">{error}</div>}
        </div></div></div>
    </div>;
}
