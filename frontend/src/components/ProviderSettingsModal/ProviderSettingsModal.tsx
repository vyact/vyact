import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
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
    const [hasExisting, setHasExisting] = useState(false);

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
                setApiKey(''); // 보안상 기존 키는 표시 안 함
            } else {
                setHasExisting(false);
                setModel(PROVIDER_DEFAULTS[provider].defaultModel);
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

        try {
            await api.saveProvider(provider, apiKey, model);
            await api.selectProvider(provider, model);

            // 저장 성공 후 콜백 호출 (모델명 갱신 포함)
            onSave();
            onClose();
        } catch (error) {
            toast.error(t('main:providerSettings.saveFailed'), String(error));
        }
    };

    if (!isOpen) return null;

    return (
        <ModalOverlay className="modal-overlay" onClose={onClose} closeOnBackdrop>
            <div className="modal-content provider-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{t('main:providerSettings.title', {provider: PROVIDER_DEFAULTS[provider].name})}</h3>
                    <button className="provider-close-btn" onClick={onClose} aria-label={t('main:customProvider.close')}>×</button>
                </div>

                <div className="modal-body provider-modal-body">
                    <div className="form-group">
                        <label>{t('apiKeyField.label')}</label>
                        {hasExisting && !apiKey && <div className="provider-key-saved">{t('apiKeyField.saved', {preview: '••••••••'})}</div>}
                        <input
                            type="password"
                            className="form-input"
                            placeholder={hasExisting ? t('apiKeyField.changePlaceholder') : t('apiKeyField.defaultPlaceholder')}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label>{t('main:providerSettings.model')}</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Model"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                        />
                    </div>

                    <div className="modal-actions">
                        <button className="btn-save-provider" onClick={handleSave}>
                            {t('main:providerSettings.save')}
                        </button>
                    </div>
                </div>
            </div>
        </ModalOverlay>
    );
};

export default ProviderSettingsModal;
