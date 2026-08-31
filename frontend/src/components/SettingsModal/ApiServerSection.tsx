import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Eye, EyeOff} from 'lucide-react';
import {api} from '../../services/api';
import type {VyactExternalApiStatus} from '../../services/api';
import {copyToClipboard} from '../../utils/helpers';
import {toast} from '../common/ToastNotifications/ToastNotifications';

const LOCAL_API_KEY_MARKER = 'vyact-local';
const MASKED_API_TOKEN = '•'.repeat(24);
const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

export default function ApiServerSection() {
    const {t} = useTranslation('settings');
    const [status, setStatus] = useState<VyactExternalApiStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [authUpdating, setAuthUpdating] = useState(false);
    const [tokenVisible, setTokenVisible] = useState(false);

    const loadStatus = useCallback(async () => {
        setLoading(true);
        try {
            setStatus(await api.getVyactExternalApiStatus());
        } catch {
            setStatus(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    const modelId = status?.model_id || t('apiServer.modelUnavailable');
    const publicEndpoint = status?.network_endpoint || status?.endpoint || 'http://127.0.0.1:11436/v1';
    const openClawConfig = useMemo(() => JSON.stringify({
        agents: {defaults: {model: {primary: `vyact/${modelId}`}}},
        models: {
            mode: 'merge',
            providers: {
                vyact: {
                    baseUrl: publicEndpoint,
                    apiKey: status?.auth_enabled ? status.api_token : LOCAL_API_KEY_MARKER,
                    api: 'openai-completions',
                    models: [{
                        id: modelId,
                        name: 'Vyact Local Model',
                        contextWindow: status?.context_window || 32768,
                        maxTokens: status?.max_tokens || 2048,
                    }],
                },
            },
        },
    }, null, 2), [modelId, publicEndpoint, status?.api_token, status?.auth_enabled, status?.context_window, status?.max_tokens]);
    const displayedOpenClawConfig = useMemo(() => {
        if (!status?.auth_enabled || !status.api_token) return openClawConfig;
        return openClawConfig.replace(status.api_token, MASKED_API_TOKEN);
    }, [openClawConfig, status?.api_token, status?.auth_enabled]);
    const curlCommand = useMemo(() => {
        const endpoint = publicEndpoint;
        const requestBody = JSON.stringify({
            model: modelId,
            messages: [{role: 'user', content: t('apiServerCurl.prompt')}],
            stream: false,
            max_tokens: 64,
        });
        return [
            `curl ${shellQuote(`${endpoint}/chat/completions`)} \\`,
            "  -H 'Content-Type: application/json' \\",
            ...(status?.auth_enabled && status.api_token ? [`  -H ${shellQuote(`Authorization: Bearer ${status.api_token}`)} \\`] : []),
            `  -d ${shellQuote(requestBody)}`,
        ].join('\n');
    }, [modelId, publicEndpoint, status?.api_token, status?.auth_enabled, t]);

    const copy = async (value: string) => {
        if (await copyToClipboard(value)) {
            toast.success(t('apiServer.copied'));
        } else {
            toast.error(t('apiServer.copyFailed'));
        }
    };

    const updateAuth = async (enabled: boolean) => {
        setAuthUpdating(true);
        setTokenVisible(false);
        try {
            const result = await api.updateVyactExternalApiAuth(enabled);
            setStatus(current => current ? {...current, auth_enabled: result.auth_enabled, api_token: result.api_token} : current);
        } catch {
            toast.error(t('apiServerAuth.updateFailed'));
        } finally {
            setAuthUpdating(false);
        }
    };

    const regenerateToken = async () => {
        setAuthUpdating(true);
        setTokenVisible(false);
        try {
            const result = await api.regenerateVyactExternalApiToken();
            setStatus(current => current ? {...current, auth_enabled: true, api_token: result.api_token} : current);
            toast.success(t('apiServerAuth.regenerated'));
        } catch {
            toast.error(t('apiServerAuth.regenerateFailed'));
        } finally {
            setAuthUpdating(false);
        }
    };

    return (
        <div className="settings-general settings-api-server">
            <div className="settings-section-label">
                <span>{t('apiServer.title')}</span>
                <div className="settings-api-server-heading-actions">
                    <div className={`settings-api-server-status-card${status?.available ? ' is-online' : ''}`}>
                        <span className={`settings-api-server-status-dot${status?.available ? ' is-online' : ''}`}/>
                        <strong>{loading ? t('apiServer.checking') : status?.available ? t('apiServer.online') : t('apiServer.offline')}</strong>
                    </div>
                    <button className="settings-refresh-btn" onClick={() => void loadStatus()} disabled={loading}>
                        {loading ? t('common:loading') : `↻ ${t('common:refresh')}`}
                    </button>
                </div>
            </div>

            <p className="settings-api-server-description">{t('apiServer.description')}</p>

            <div className="settings-api-server-fields">
                <div className="settings-api-server-field">
                    <label>{t('apiServerAuth.networkEndpoint')}</label>
                    <div><code>{publicEndpoint}</code>
                        <button onClick={() => void copy(publicEndpoint)}>{t('apiServer.copy')}</button>
                    </div>
                </div>
                <div className="settings-api-server-field">
                    <label>{t('apiServer.modelId')}</label>
                    <div><code>{modelId}</code>
                        <button disabled={!status?.model_id} onClick={() => void copy(modelId)}>{t('apiServer.copy')}</button>
                    </div>
                </div>
            </div>

            <div className="settings-api-server-notice">{t('apiServerAuth.networkNotice')}</div>

            <section className="settings-api-server-auth">
                <div className="settings-toggle-row">
                    <div>
                        <div className="settings-toggle-title">{t('apiServerAuth.title')}</div>
                        <div className="settings-toggle-desc">{t('apiServerAuth.description')}</div>
                    </div>
                    <label className="settings-switch">
                        <input type="checkbox" checked={Boolean(status?.auth_enabled)} disabled={loading || authUpdating}
                               onChange={event => void updateAuth(event.target.checked)}/>
                        <span className="settings-switch-slider"/>
                    </label>
                </div>
                {status?.auth_enabled && status.api_token && (
                    <div className="settings-api-server-token">
                        <label>{t('apiServerAuth.token')}</label>
                        <div>
                            <code>{tokenVisible ? status.api_token : MASKED_API_TOKEN}</code>
                            <button className="settings-api-server-token-visibility" type="button"
                                    onClick={() => setTokenVisible(current => !current)}
                                    aria-label={t(tokenVisible ? 'apiServerAuth.hideToken' : 'apiServerAuth.showToken')}>
                                {tokenVisible ? <EyeOff size={15}/> : <Eye size={15}/>}
                            </button>
                            <button onClick={() => void copy(status.api_token!)}>{t('apiServer.copy')}</button>
                            <button disabled={authUpdating} onClick={() => void regenerateToken()}>{t('apiServerAuth.regenerate')}</button>
                        </div>
                    </div>
                )}
            </section>

            <section className="settings-api-server-config settings-api-server-config--curl">
                <div>
                    <strong>{t('apiServerCurl.title')}</strong>
                    <p>{t('apiServerCurl.description')}</p>
                </div>
                <pre><code>{curlCommand}</code></pre>
                <button className="settings-api-server-copy-config" disabled={!status?.model_id}
                        onClick={() => void copy(curlCommand)}>{t('apiServerCurl.copy')}</button>
            </section>

            <section className="settings-api-server-config settings-api-server-config--openclaw">
                <div>
                    <strong>{t('apiServer.openClawTitle')}</strong>
                    <p>{t('apiServer.openClawDescription')}</p>
                </div>
                <pre><code>{displayedOpenClawConfig}</code></pre>
                <button className="settings-api-server-copy-config" disabled={!status?.model_id}
                        onClick={() => void copy(openClawConfig)}>{t('apiServer.copyConfig')}</button>
            </section>
        </div>
    );
}
