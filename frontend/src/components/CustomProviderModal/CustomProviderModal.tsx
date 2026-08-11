import React, {useState} from 'react';
import {Eye, EyeOff, ExternalLink, Link2, Plus, Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {CustomProviderPayload, CustomProviderSettings} from '../../services/api';
import {api} from '../../services/api';
import CustomSelect from '../CustomSelect/CustomSelect';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import '../ProviderSettingsModal/ProviderSettingsModal.css';

interface CustomProviderModalProps {
    connection?: CustomProviderSettings;
    onClose: () => void;
    onSave: (selectionType: `custom:${string}`) => Promise<void> | void;
    onDelete?: (selectionType: `custom:${string}`) => Promise<void> | void;
}

interface HeaderRow {
    id: string;
    name: string;
    value: string;
    hasExistingValue: boolean;
    isValueVisible: boolean;
}

const OPENAI_COMPATIBLE_DOCS_URL = 'https://docs.ollama.com/api/openai-compatibility';
const PROTOCOL_OPTIONS = [{value: 'openai-compatible', label: 'OpenAI Compatible'}];

const CustomProviderModal: React.FC<CustomProviderModalProps> = ({connection, onClose, onSave, onDelete}) => {
    const {t} = useTranslation('main');
    const [name, setName] = useState(connection?.name ?? '');
    const [protocol, setProtocol] = useState<'openai-compatible'>(connection?.protocol ?? 'openai-compatible');
    const [baseUrl, setBaseUrl] = useState(connection?.base_url ?? '');
    const [apiKey, setApiKey] = useState('');
    const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
    const [model, setModel] = useState(connection?.model ?? '');
    const [headers, setHeaders] = useState<HeaderRow[]>(() => (connection?.headers ?? []).map((header, index) => ({
        id: `existing-${index}`,
        name: header.name,
        value: '',
        hasExistingValue: header.has_value,
        isValueVisible: false,
    })));
    const [saving, setSaving] = useState(false);

    const addHeader = () => setHeaders(current => [...current, {
        id: `new-${Date.now()}-${current.length}`,
        name: '',
        value: '',
        hasExistingValue: false,
        isValueVisible: false,
    }]);

    const updateHeader = (id: string, field: 'name' | 'value', value: string) => {
        setHeaders(current => current.map(header => header.id === id ? {...header, [field]: value} : header));
    };

    const removeHeader = (id: string) => setHeaders(current => current.filter(header => header.id !== id));

    const toggleHeaderValueVisibility = (id: string) => {
        setHeaders(current => current.map(header => header.id === id
            ? {...header, isValueVisible: !header.isValueVisible}
            : header));
    };

    const handleSave = async () => {
        if (!name.trim() || !baseUrl.trim() || !model.trim()) {
            toast.warning(t('customProvider.validation'));
            return;
        }
        if (headers.some(header => !header.name.trim() || (!header.value.trim() && !header.hasExistingValue))) {
            toast.warning(t('customProvider.headerValidation'));
            return;
        }
        setSaving(true);
        try {
            const payload: CustomProviderPayload = {
                name: name.trim(),
                protocol,
                base_url: baseUrl.trim(),
                api_key: apiKey.trim(),
                model: model.trim(),
                headers: headers.map(header => ({name: header.name.trim(), value: header.value.trim()})),
            };
            const id = connection
                ? (await api.updateCustomProvider(connection.id, payload), connection.id)
                : (await api.createCustomProvider(payload)).id;
            await api.selectProvider(`custom:${id}`, model.trim());
            await onSave(`custom:${id}`);
            onClose();
        } catch (error) {
            toast.error(t('customProvider.saveFailed'), String(error));
        } finally {
            setSaving(false);
        }
    };

    return <ModalOverlay className="provider-editor-overlay" onClose={onClose} closeOnBackdrop={false}>
        <section className="provider-editor" role="dialog" aria-modal="true" aria-labelledby="provider-editor-title" onClick={event => event.stopPropagation()}>
            <header className="provider-editor-header">
                <div className="provider-editor-title-icon"><Link2 size={20}/></div>
                <div><h2 id="provider-editor-title">{connection ? t('customProvider.editTitle') : t('customProvider.addTitle')}</h2></div>
                <button className="provider-editor-close" onClick={onClose} aria-label={t('customProvider.close')}>×</button>
            </header>

            <div className="provider-editor-body">
                <section className="provider-editor-section">
                    <div className="provider-editor-grid">
                        <label className="provider-editor-field"><span>{t('customProvider.name')}</span><input value={name} onChange={event => setName(event.target.value)} placeholder={t('customProvider.namePlaceholder')}/></label>
                        <label className="provider-editor-field"><span>{t('customProvider.protocol')}</span><CustomSelect options={PROTOCOL_OPTIONS} value={protocol} onChange={value => setProtocol(value as 'openai-compatible')} ariaLabel={t('customProvider.protocol')}/></label>
                    </div>
                    <div className="provider-protocol-help">
                        <p>{t('customProvider.hint')}</p>
                        <a href={OPENAI_COMPATIBLE_DOCS_URL} target="_blank" rel="noreferrer">{t('customProvider.protocolDocs')}<ExternalLink size={13}/></a>
                    </div>
                    <label className="provider-editor-field"><span>{t('customProvider.baseUrl')}</span><input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="http://localhost:11434/v1"/></label>
                    <div className="provider-editor-grid">
                        <label className="provider-editor-field"><span>{t('customProvider.apiKey')}<small>{t('customProvider.optional')}</small></span><div className="provider-api-key-field"><input type={isApiKeyVisible ? 'text' : 'password'} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={connection?.has_key ? t('customProvider.apiKeyExisting') : t('customProvider.apiKeyOptional')}/><button type="button" onClick={() => setIsApiKeyVisible(current => !current)} aria-label={t(isApiKeyVisible ? 'customProvider.hideApiKey' : 'customProvider.showApiKey')}>{isApiKeyVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
                        <label className="provider-editor-field"><span>{t('customProvider.modelId')}</span><input value={model} onChange={event => setModel(event.target.value)} placeholder={t('customProvider.modelPlaceholder')}/></label>
                    </div>
                </section>

                <section className="provider-editor-section provider-headers-section">
                    <div className="provider-editor-section-heading provider-headers-heading"><div><strong>{t('customProvider.headers')}</strong><span>{t('customProvider.headersDesc')}</span></div><button type="button" onClick={addHeader}><Plus size={15}/>{t('customProvider.addHeader')}</button></div>
                    {headers.length === 0 ? <button type="button" className="provider-headers-empty" onClick={addHeader}><Plus size={18}/><span>{t('customProvider.noHeaders')}</span></button> : <div className="provider-header-list">
                        <div className="provider-header-labels"><span>{t('customProvider.headerName')}</span><span>{t('customProvider.headerValue')}</span><span/></div>
                        {headers.map(header => <div className="provider-header-row" key={header.id}>
                            <input value={header.name} onChange={event => updateHeader(header.id, 'name', event.target.value)} placeholder="X-API-Key"/>
                            <div className="provider-header-value-field">
                                <input type={header.isValueVisible ? 'text' : 'password'} value={header.value} onChange={event => updateHeader(header.id, 'value', event.target.value)} placeholder={header.hasExistingValue ? t('customProvider.headerValueExisting') : t('customProvider.headerValuePlaceholder')}/>
                                <button type="button" onClick={() => toggleHeaderValueVisibility(header.id)} aria-label={t(header.isValueVisible ? 'customProvider.hideHeaderValue' : 'customProvider.showHeaderValue')}>
                                    {header.isValueVisible ? <EyeOff size={16}/> : <Eye size={16}/>}
                                </button>
                            </div>
                            <button type="button" onClick={() => removeHeader(header.id)} aria-label={t('customProvider.removeHeader')}><Trash2 size={16}/></button>
                        </div>)}
                    </div>}
                </section>
            </div>

            <footer className="provider-editor-footer">
                {connection && onDelete && <button className="provider-editor-delete" onClick={() => onDelete(`custom:${connection.id}`)} disabled={saving}>{t('modelSelector.delete')}</button>}
                <button className="provider-editor-cancel" onClick={onClose} disabled={saving}>{t('customProvider.cancel')}</button>
                <button className="provider-editor-save" onClick={handleSave} disabled={saving}>{saving ? t('customProvider.saving') : t('customProvider.save')}</button>
            </footer>
        </section>
    </ModalOverlay>;
};

export default CustomProviderModal;
