import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ChartNoAxesCombined, Check, CircleHelp, Clock3, Plus, Trash2} from 'lucide-react';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {Tooltip} from '../common/Tooltip/Tooltip';
import ModalTabs from '../common/ModalTabs/ModalTabs';
import {STOCK_API_KINDS, STOCK_API_MARKETS, type StockApiKind, type StockApiSettings as Settings} from '../../services/stockApiSettings';
import type {StockMarket} from '../../services/stockAnalysis';
import StockApiEndpointSettings from './StockApiEndpointSettings';
import useStockApiDrafts from './useStockApiDrafts';
import '../common/ModalOverlay/ModalActions.css';
import '../ProviderSettingsModal/ProviderSettingsModal.css';
import './StockApiSettings.css';

export default function StockApiSettings({market, onClose, onSaved}: {market: StockMarket; onClose: () => void; onSaved: () => void}) {
    const {t} = useTranslation(['main', 'common', 'settings']);
    const tr = (key: string) => t(`main:stockAnalysis.api.${key}`);
    const [confirmClose, setConfirmClose] = useState(false);
    const [deleteKeyMarket, setDeleteKeyMarket] = useState<StockMarket | null>(null);
    const [activeMarket, setActiveMarket] = useState(market);
    const [expandedEndpoints, setExpandedEndpoints] = useState<Partial<Record<StockMarket, StockApiKind | null>>>({});
    const {drafts, errors, saving, updateDraft, save, deleteKey, retryLoad} = useStockApiDrafts(onSaved);
    const requestClose = () => {
        if (saving) return;
        if (STOCK_API_MARKETS.some(key => drafts[key]?.dirty)) setConfirmClose(true);
        else onClose();
    };
    const draft = drafts[activeMarket];
    const settings = draft?.settings;
    const error = errors[activeMarket];
    const keyStatus = settings?.clearApiKey ? 'keyDeletePending' : settings?.apiKey ? 'keyChangePending' : settings?.hasApiKey ? 'keyConfigured' : null;
    const updateSettings = (update: (settings: Settings) => Settings) => updateDraft(activeMarket, previous => ({...previous, settings: update(previous.settings)}));
    const changeHeader = (index: number, field: 'name' | 'value', value: string) => updateSettings(previous => ({...previous,
        headers: (previous.headers ?? []).map((header, headerIndex) => headerIndex === index ? {...header, [field]: value, ...(field === 'name' ? {hasValue: false} : {})} : header),
    }));
    const addHeader = () => updateSettings(previous => ({...previous, headers: [...(previous.headers ?? []), {name: '', value: ''}]}));
    return <ModalOverlay onClose={saving ? undefined : requestClose} closeOnBackdrop captureEscape aria-labelledby="stock-api-settings-title">
        <div className="stock-api-settings provider-editor" role="dialog" aria-modal="true" aria-labelledby="stock-api-settings-title">
            <header className="provider-editor-header">
                <div className="provider-editor-title-icon"><ChartNoAxesCombined size={23} aria-hidden="true"/></div>
                <div><h2 id="stock-api-settings-title">{tr('title')}</h2></div>
                <ModalCloseButton disabled={saving} onClick={requestClose}/>
            </header>
            <nav className="stock-api-market-tabs" aria-label={t('main:stockAnalysis.market')}>
                <ModalTabs tabs={STOCK_API_MARKETS.map(key => ({key, label: <>{t(`main:stockAnalysis.${key}`)}{drafts[key]?.dirty && <span className="stock-api-unsaved-dot" aria-label={tr('unsaved')}/>}</>}))}
                    activeKey={activeMarket} onChange={setActiveMarket} disabled={saving}/>
            </nav>
            {error && <p className="stock-api-settings-error" role="alert">{tr(error)}</p>}
            <div className="stock-api-settings-content">
                <div className="stock-api-summary">
                    <Tooltip hoverOnly multiline size="medium" placement="below" content={<div className="rich-tooltip-content stock-api-guide-tooltip">
                        <strong className="rich-tooltip-title">{tr('guide')}</strong>
                        <ul className="stock-api-guide-points">{['helpSource', 'helpFormat', 'helpVariables'].map(key => <li key={key}>{tr(key)}</li>)}</ul>
                    </div>}>
                        <button type="button" className="stock-api-help-button" aria-label={tr('guide')}><CircleHelp size={16} aria-hidden="true"/></button>
                    </Tooltip>
                    <p>{tr('summary')}</p>
                </div>
                {!draft && !error && <p role="status">{t('main:stockAnalysis.loading')}</p>}
                {settings && draft && <fieldset disabled={saving} key={activeMarket}>
                    <section className="provider-editor-section stock-api-auth">
                        <div className="stock-api-key-field">
                            <div className="stock-api-key-label-row"><label htmlFor="stock-api-key">{tr('apiKey')}</label>
                                <div className="stock-api-key-actions">
                                    {keyStatus && <span className="stock-api-key-status" data-pending={keyStatus !== 'keyConfigured'} role="status">
                                        {keyStatus === 'keyConfigured' ? <Check size={14} aria-hidden="true"/> : <Clock3 size={14} aria-hidden="true"/>}{tr(keyStatus)}
                                    </span>}
                                    {settings.hasApiKey && <button type="button" className="stock-api-delete-key" onClick={() => setDeleteKeyMarket(activeMarket)}>
                                        <Trash2 size={14} aria-hidden="true"/>{tr('deleteKey')}
                                    </button>}
                                </div>
                            </div>
                            <input id="stock-api-key" type="password" autoComplete="new-password" value={settings.apiKey ?? ''}
                                placeholder={settings.hasApiKey ? t('settings:externalData.serviceKeySavedPlaceholder') : tr('optional')}
                                onChange={event => updateSettings(previous => ({...previous, apiKey: event.target.value || undefined, clearApiKey: false}))}/>
                        </div>
                        <details className="stock-api-auth-options"><summary>{tr('authOptions')}</summary>
                            <div className="stock-api-auth-fields">
                                <label>{tr('headerName')}<input value={settings.headerName} onChange={event => updateSettings(previous => ({...previous, headerName: event.target.value}))}/></label>
                                <label>{tr('keyPrefix')}<input value={settings.keyPrefix} onChange={event => updateSettings(previous => ({...previous, keyPrefix: event.target.value}))}/></label>
                            </div>
                        </details>
                    </section>
                    <div className="stock-api-endpoints">
                        {STOCK_API_KINDS.map(kind => <StockApiEndpointSettings key={kind} market={activeMarket} kind={kind}
                            settings={settings} endpoint={settings.endpoints[kind]} body={draft.bodies[kind] ?? '{}'} expanded={expandedEndpoints[activeMarket] === kind} disabled={saving}
                            onToggle={() => setExpandedEndpoints(previous => ({...previous, [activeMarket]: previous[activeMarket] === kind ? null : kind}))}
                            onChange={patch => updateSettings(previous => ({...previous, endpoints: {...previous.endpoints,
                                [kind]: {url: '', method: 'GET', body: {}, ...previous.endpoints[kind], ...patch}}}))}
                            onBodyChange={value => updateDraft(activeMarket, previous => ({...previous, bodies: {...previous.bodies, [kind]: value}}))}/>) }
                    </div>
                    <section className="provider-editor-section stock-api-headers">
                        <div className="provider-editor-section-heading provider-headers-heading">
                            <div><strong>{t('main:customProvider.headers')}</strong><span>{t('main:customProvider.headersDesc')}</span></div>
                            <button type="button" onClick={addHeader}><Plus size={15} aria-hidden="true"/>{t('main:customProvider.addHeader')}</button>
                        </div>
                        {!settings.headers?.length ? <button type="button" className="provider-headers-empty" onClick={addHeader}><Plus size={18} aria-hidden="true"/>{t('main:customProvider.noHeaders')}</button> :
                            <div className="stock-api-header-list">{settings.headers.map((header, index) => <div className="stock-api-header-row" key={index}>
                                <input aria-label={t('main:customProvider.headerName')} placeholder={t('main:customProvider.headerName')} value={header.name} onChange={event => changeHeader(index, 'name', event.target.value)}/>
                                <input type="password" autoComplete="new-password" aria-label={t('main:customProvider.headerValue')}
                                    placeholder={t(header.hasValue ? 'main:customProvider.headerValueExisting' : 'main:customProvider.headerValuePlaceholder')}
                                    value={header.value ?? ''} onChange={event => changeHeader(index, 'value', event.target.value)}/>
                                <button type="button" className="stock-api-header-remove" aria-label={t('main:customProvider.removeHeader')}
                                    onClick={() => updateSettings(previous => ({...previous, headers: previous.headers?.filter((_, headerIndex) => headerIndex !== index)}))}><Trash2 size={16} aria-hidden="true"/></button>
                            </div>)}</div>}
                    </section>
                </fieldset>}
                {!draft && error && <button type="button" className="modal-action-cancel" onClick={retryLoad}>{t('main:stockAnalysis.retry')}</button>}
            </div>
            <footer><button type="button" className="modal-action-cancel" disabled={saving} onClick={onClose}>{t('common:cancel')}</button>
                <button type="button" className="modal-action-submit" disabled={saving || !draft} onClick={() => void save(setActiveMarket)}>{tr(saving ? 'saving' : 'saveAll')}</button></footer>
        </div>
        {deleteKeyMarket && <ConfirmModal title={tr('deleteKeyTitle')} description={tr('deleteKeyDescription')} actionLayout="horizontal"
            loading={saving} loadingValue="delete"
            options={[{value: 'cancel', label: t('common:cancel')}, {value: 'delete', label: tr('deleteKey'), variant: 'danger'}]}
            onClose={() => {if (!saving) setDeleteKeyMarket(null);}}
            onSelect={value => {
                if (saving) return;
                if (value === 'cancel') setDeleteKeyMarket(null);
                else void deleteKey(deleteKeyMarket).then(() => setDeleteKeyMarket(null));
            }}/>}
        {confirmClose && <ConfirmModal title={tr('closeTitle')} description={tr('closeDescription')} actionLayout="horizontal"
            options={[{value: 'continue', label: tr('keepEditing'), variant: 'primary'}, {value: 'discard', label: tr('discardClose'), variant: 'danger'}]}
            onClose={() => setConfirmClose(false)} onSelect={value => {if (value === 'discard') onClose(); else setConfirmClose(false);}}/>}
    </ModalOverlay>;
}
