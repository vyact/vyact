import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import type {VyactExternalApiStatus} from '../../services/api';
import {toast} from '../common/ToastNotifications/ToastNotifications';

const LOCAL_API_KEY_MARKER = 'vyact-local';
const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

export default function ApiServerSection() {
    const {t} = useTranslation('settings');
    const [status, setStatus] = useState<VyactExternalApiStatus | null>(null);
    const [loading, setLoading] = useState(true);

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
    const openClawConfig = useMemo(() => JSON.stringify({
        agents: {defaults: {model: {primary: `vyact/${modelId}`}}},
        models: {
            mode: 'merge',
            providers: {
                vyact: {
                    baseUrl: status?.endpoint || 'http://127.0.0.1:11435/v1',
                    apiKey: LOCAL_API_KEY_MARKER,
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
    }, null, 2), [modelId, status?.context_window, status?.endpoint, status?.max_tokens]);
    const curlCommand = useMemo(() => {
        const endpoint = status?.endpoint || 'http://127.0.0.1:11435/v1';
        const requestBody = JSON.stringify({
            model: modelId,
            messages: [{role: 'user', content: t('apiServerCurl.prompt')}],
            stream: false,
            max_tokens: 64,
        });
        return [
            `curl ${shellQuote(`${endpoint}/chat/completions`)} \\`,
            "  -H 'Content-Type: application/json' \\",
            `  -d ${shellQuote(requestBody)}`,
        ].join('\n');
    }, [modelId, status?.endpoint, t]);

    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(t('apiServer.copied'));
        } catch {
            toast.error(t('apiServer.copyFailed'));
        }
    };

    return (
        <div className="settings-general settings-api-server">
            <div className="settings-section-label">
                <span>{t('apiServer.title')}</span>
                <button className="settings-refresh-btn" onClick={() => void loadStatus()} disabled={loading}>
                    {loading ? t('common:loading') : `↻ ${t('common:refresh')}`}
                </button>
            </div>

            <p className="settings-api-server-description">{t('apiServer.description')}</p>

            <div className="settings-api-server-status-card">
                <span className={`settings-api-server-status-dot${status?.available ? ' is-online' : ''}`}/>
                <div>
                    <strong>{loading ? t('apiServer.checking') : status?.available ? t('apiServer.online') : t('apiServer.offline')}</strong>
                    <p>{status?.available ? t('apiServer.onlineDescription') : t('apiServer.offlineDescription')}</p>
                </div>
            </div>

            <div className="settings-api-server-field">
                <label>{t('apiServer.endpoint')}</label>
                <div><code>{status?.endpoint || 'http://127.0.0.1:11435/v1'}</code>
                    <button onClick={() => void copy(status?.endpoint || 'http://127.0.0.1:11435/v1')}>{t('apiServer.copy')}</button>
                </div>
            </div>
            <div className="settings-api-server-field">
                <label>{t('apiServer.modelId')}</label>
                <div><code>{modelId}</code>
                    <button disabled={!status?.model_id} onClick={() => void copy(modelId)}>{t('apiServer.copy')}</button>
                </div>
            </div>

            <div className="settings-api-server-notice">{t('apiServer.localOnly')}</div>

            <section className="settings-api-server-config">
                <div>
                    <strong>{t('apiServerCurl.title')}</strong>
                    <p>{t('apiServerCurl.description')}</p>
                </div>
                <pre><code>{curlCommand}</code></pre>
                <button className="settings-api-server-copy-config" disabled={!status?.model_id}
                        onClick={() => void copy(curlCommand)}>{t('apiServerCurl.copy')}</button>
            </section>

            <section className="settings-api-server-config">
                <div>
                    <strong>{t('apiServer.openClawTitle')}</strong>
                    <p>{t('apiServer.openClawDescription')}</p>
                </div>
                <pre><code>{openClawConfig}</code></pre>
                <button className="settings-api-server-copy-config" disabled={!status?.model_id}
                        onClick={() => void copy(openClawConfig)}>{t('apiServer.copyConfig')}</button>
            </section>
        </div>
    );
}
