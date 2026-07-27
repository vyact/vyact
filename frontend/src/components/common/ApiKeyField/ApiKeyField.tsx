import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ApiKeyField.css';

interface ApiKeyFieldProps {
    hasKey: boolean;
    keyPreview: string;
    onSave: (key: string) => Promise<void>;
    placeholderEmpty?: string;
}

const EyeIcon = ({ off }: { off: boolean }) => (
    off ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
    ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
        </svg>
    )
);

function ApiKeyField({ hasKey, keyPreview, onSave, placeholderEmpty }: ApiKeyFieldProps) {
    const { t } = useTranslation('settings');
    const [draft, setDraft] = useState('');
    const [visible, setVisible] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    const handleSave = async () => {
        const key = draft.trim();
        if (!key || saving) return;
        setSaving(true);
        setMsg('');
        try {
            await onSave(key);
            setDraft('');
            setMsg(t('apiKeyField.savedMsg'));
            setTimeout(() => setMsg(''), 2000);
        } catch {
            setMsg(t('apiKeyField.failedMsg'));
        } finally {
            setSaving(false);
        }
    };

    const isFailed = msg === t('apiKeyField.failedMsg');

    return (
        <div className="settings-mcp-field">
            <label className="settings-mcp-label">{t('apiKeyField.label')}</label>
            {hasKey && !draft && (
                <div className="api-key-saved">{t('apiKeyField.saved', { preview: keyPreview })}</div>
            )}
            <div className="api-key-row">
                <div className="settings-mcp-input-wrap">
                    <input
                        type={visible ? 'text' : 'password'}
                        className="settings-mcp-input"
                        placeholder={hasKey ? t('apiKeyField.changePlaceholder') : (placeholderEmpty || t('apiKeyField.defaultPlaceholder'))}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                    />
                    <button
                        className="settings-mcp-eye"
                        onClick={() => setVisible(v => !v)}
                        title={visible ? t('apiKeyField.hide') : t('apiKeyField.show')}
                        type="button"
                    >
                        <EyeIcon off={visible}/>
                    </button>
                </div>
                <button
                    className="api-key-save-btn"
                    onClick={handleSave}
                    disabled={!draft.trim() || saving}
                    type="button"
                >
                    {saving ? t('apiKeyField.saving') : t('apiKeyField.save')}
                </button>
            </div>
            {msg && <span className={`api-key-msg${isFailed ? ' error' : ''}`}>{msg}</span>}
        </div>
    );
}

export default ApiKeyField;
