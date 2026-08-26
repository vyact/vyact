import React, {useEffect, useState} from 'react';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import SettingLabel from '../common/SettingLabel/SettingLabel';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import './ProviderSettingsModal.css';

interface ProviderSettingsModalProps {
    isOpen: boolean;
    provider: 'openai' | 'gemini' | 'claude';
    onClose: () => void;
    onSave: () => void;
}

const PROVIDER_DEFAULTS = {
    openai: {name: 'OpenAI', defaultModel: 'gpt-4o-mini'},
    gemini: {name: 'Gemini', defaultModel: 'gemini-3.1-flash-lite-preview'},
    claude: {name: 'Claude', defaultModel: 'claude-3-5-sonnet-20241022'},
};

const ProviderSettingsModal: React.FC<ProviderSettingsModalProps> = ({
                                                                         isOpen,
                                                                         provider,
                                                                         onClose,
                                                                         onSave,
                                                                     }) => {
    const {t} = useTranslation(['settings', 'main']);
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('');
    const [historyTokenBudget, setHistoryTokenBudget] = useState(16384);
    const [temperature, setTemperature] = useState(0.2);
    const [maxOutputTokens, setMaxOutputTokens] = useState(2048);
    const [hasExisting, setHasExisting] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadProviderSettings();

            // ESC 키로 닫기
            const handleEsc = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    onClose();
                }
            };
            document.addEventListener('keydown', handleEsc);
            return () => document.removeEventListener('keydown', handleEsc);
        }
    }, [isOpen, provider]);

    const loadProviderSettings = async () => {
        try {
            const data = await api.getProviders();
            const providerData = data.providers[provider];

            if (providerData?.has_key) {
                setHasExisting(true);
                setModel(providerData.model || PROVIDER_DEFAULTS[provider].defaultModel);
                setHistoryTokenBudget(providerData.history_token_budget ?? 16384);
                setTemperature(providerData.temperature ?? 0.2);
                setMaxOutputTokens(providerData.max_output_tokens ?? 2048);
                setApiKey(''); // 보안상 기존 키는 표시 안 함
            } else {
                setHasExisting(false);
                setModel(PROVIDER_DEFAULTS[provider].defaultModel);
                setHistoryTokenBudget(16384);
                setTemperature(0.2);
                setMaxOutputTokens(2048);
                setApiKey('');
            }
        } catch (error) {
            console.error('Failed to load provider settings:', error);
        }
    };

    const handleSave = async () => {
        if ((!hasExisting && !apiKey.trim()) || !model.trim()) {
            toast.warning(t('main:providerSettings.required'));
            return;
        }

        setSaving(true);
        try {
            await api.saveProvider(provider, apiKey, model, historyTokenBudget, temperature, maxOutputTokens);
            await api.selectProvider(provider, model);

            // 저장 성공 후 콜백 호출 (모델명 갱신 포함)
            onSave();
            onClose();
        } catch (error) {
            toast.error(t('main:providerSettings.saveFailed'), String(error));
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <ModalOverlay className="provider-settings-overlay" onClose={onClose} closeOnBackdrop>
            <div className="provider-settings-modal" onClick={(event) => event.stopPropagation()}>
                <header>
                    <div><h2>{t('main:providerSettings.title', {provider: PROVIDER_DEFAULTS[provider].name})}</h2><p>{PROVIDER_DEFAULTS[provider].name}</p></div>
                    <button type="button" onClick={onClose} aria-label={t('main:customProvider.close')}><X size={20}/></button>
                </header>

                <div className="provider-settings-body">
                    <p className="provider-settings-description">{t('main:providerSettings.description')}</p>
                    <label className="provider-settings-stack">
                        <strong>{t('apiKeyField.label')}</strong>
                        {hasExisting && !apiKey && <div className="provider-key-saved">{t('apiKeyField.saved', {preview: '••••••••'})}</div>}
                        <input
                            type="password"
                            className="provider-settings-wide-input"
                            placeholder={hasExisting ? t('apiKeyField.changePlaceholder') : t('apiKeyField.defaultPlaceholder')}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                        />
                    </label>

                    <label className="provider-settings-stack">
                        <strong>{t('main:providerSettings.model')}</strong>
                        <input
                            type="text"
                            className="provider-settings-wide-input"
                            placeholder="Model"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                        />
                    </label>

                    <label className="provider-settings-row">
                        <SettingLabel label={t('main:modelSettings.maxOutput')} help={t('main:modelSettings.maxOutputTooltip')}/>
                        <input
                            type="number"
                            className="provider-settings-input"
                            min="1"
                            max="32768"
                            value={maxOutputTokens}
                            onChange={(event) => setMaxOutputTokens(Math.max(1, Math.min(32768, Number(event.target.value))))}
                        />
                    </label>

                    <label className="provider-settings-row">
                        <SettingLabel label={t('main:modelSettings.historyTokenBudget')} help={t('main:modelSettings.historyTokenBudgetTooltip')}/>
                        <input type="number" className="provider-settings-input" min="0" max="131072" value={historyTokenBudget} onChange={(event) => setHistoryTokenBudget(Math.max(0, Math.min(131072, Number(event.target.value))))}/>
                    </label>

                    <label className="provider-settings-row">
                        <SettingLabel label={t('main:modelSettings.temperature')} help={t('main:modelSettings.temperatureTooltip')}/>
                        <input type="number" className="provider-settings-input" min="0" max="1" step="0.01" value={temperature} onChange={(event) => setTemperature(Math.max(0, Math.min(1, Number(event.target.value))))}/>
                    </label>
                </div>
                <footer><button type="button" onClick={onClose}>{t('main:modelSettings.cancel')}</button><button className="primary" type="button" disabled={saving} onClick={() => void handleSave()}>{saving ? t('main:modelSettings.applying') : t('main:providerSettings.save')}</button></footer>
            </div>
        </ModalOverlay>
    );
};

export default ProviderSettingsModal;
