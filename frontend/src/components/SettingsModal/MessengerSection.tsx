import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import './McpServersSection.css';

interface TelegramStatus {
    configured: boolean;
    enabled: boolean;
    running: boolean;
}

export default function MessengerSection() {
    const {t} = useTranslation('settings');
    const [status, setStatus] = useState<TelegramStatus>({configured: false, enabled: false, running: false});
    const [token, setToken] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [botName, setBotName] = useState('');

    useEffect(() => {
        api.getTelegramStatus().then(setStatus).catch(() => setError(t('messengers.loadFailed')));
    }, [t]);

    const save = async () => {
        if (!token.trim()) {
            setError(t('messengers.tokenRequired'));
            return;
        }
        setSaving(true);
        setError('');
        try {
            const result = await api.saveTelegramSettings(token.trim(), true);
            setStatus(result);
            setBotName(result.bot?.username || result.bot?.name || '');
            setToken('');
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : t('messengers.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    return <div className="mcp-section messenger-section">
        <div className="mcp-head"><span className="mcp-title">{t('messengers.title')}</span></div>
        <div className="mcp-desc">{t('messengers.description')}</div>
        <div className="mcp-item">
            <div className="mcp-item-row">
                <span className="mcp-item-label">Telegram</span>
                <span className={status.running ? 'messenger-status is-connected' : 'messenger-status'}>
                    {status.running ? t('messengers.connected') : t('messengers.notConnected')}
                </span>
            </div>
            <div className="mcp-form">
                <label className="mcp-field">
                    <span className="mcp-field-label">{t('messengers.botToken')}</span>
                    <input className="mcp-input" type="password" autoComplete="off" value={token}
                        placeholder={status.configured ? t('messengers.tokenConfigured') : t('messengers.tokenPlaceholder')}
                        onChange={event => setToken(event.target.value)} />
                </label>
                <div className="messenger-help">{t('messengers.help')}</div>
                {botName && <div className="messenger-status is-connected">@{botName}</div>}
                {error && <div className="mcp-err">{error}</div>}
                <div className="mcp-form-actions">
                    <button className="mcp-btn-primary" onClick={save} disabled={saving}>
                        {saving ? t('messengers.connecting') : t('messengers.connect')}
                    </button>
                </div>
            </div>
        </div>
    </div>;
}
