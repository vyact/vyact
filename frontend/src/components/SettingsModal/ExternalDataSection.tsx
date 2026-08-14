import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Database, ExternalLink, Eye, EyeOff, RefreshCw} from 'lucide-react';
import {api} from '../../services/api';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import CustomSelect from '../CustomSelect/CustomSelect';
import Gov24DataModal from '../Gov24DataModal';
import './ExternalDataSection.css';

const DATA_SOURCES = [
    {id: 'gov24', sourceId: 'kr.gov24', url: 'https://www.data.go.kr/data/15113968/openapi.do'},
    {id: 'bizSupport', sourceId: 'kr.biz_support', url: 'https://www.data.go.kr/data/15157820/openapi.do'},
    {id: 'kStartup', sourceId: 'kr.k_startup', url: 'https://www.data.go.kr/data/15125364/openapi.do'},
    {id: 'welfare', sourceId: 'kr.welfare', url: 'https://www.data.go.kr/data/15090532/openapi.do'},
    {id: 'contentSupport', sourceId: 'kr.content_support', url: 'https://www.data.go.kr/data/15134251/openapi.do'},
    {id: 'scholarship', sourceId: 'kr.scholarship', url: 'https://www.data.go.kr/data/15159544/fileData.do'},
] as const;

type Gov24SyncStatus = Awaited<ReturnType<typeof api.getGov24SyncStatus>>;
const SYNC_INTERVAL_HOURS = [1, 3, 6, 12, 24] as const;

const ExternalDataSection: React.FC = () => {
    const {t, i18n} = useTranslation('settings');
    const [country, setCountry] = useState('KR');
    const [serviceKey, setServiceKey] = useState('');
    const [hasServiceKey, setHasServiceKey] = useState(false);
    const [showServiceKey, setShowServiceKey] = useState(false);
    const [savingKey, setSavingKey] = useState(false);
    const [enabledSources, setEnabledSources] = useState<Record<string, boolean>>({});
    const [savingSourceId, setSavingSourceId] = useState<string | null>(null);
    const [syncStatus, setSyncStatus] = useState<Gov24SyncStatus>({status: 'idle'});
    const [bizSupportSyncStatus, setBizSupportSyncStatus] = useState<Gov24SyncStatus>({status: 'idle'});
    const [isAllSyncing, setIsAllSyncing] = useState(false);
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
    const [autoSyncIntervalHours, setAutoSyncIntervalHours] = useState(24);
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [showDataModal, setShowDataModal] = useState(false);
    const [browseSource, setBrowseSource] = useState<{sourceId: string; sourceNameKey: string}>({sourceId: 'kr.gov24', sourceNameKey: 'gov24'});

    useEffect(() => {
        api.getExternalDataConnections().then(({connections}) => {
            setHasServiceKey(Boolean(connections['kr.gov24']?.has_service_key));
            setEnabledSources(Object.fromEntries(DATA_SOURCES.map(source => [
                source.sourceId,
                connections[source.sourceId]?.enabled ?? source.sourceId === 'kr.gov24',
            ])));
        }).catch(() => undefined);
        api.getGov24SyncStatus().then(setSyncStatus).catch(() => undefined);
        api.getExternalSourceSyncStatus('kr.biz_support').then(setBizSupportSyncStatus).catch(() => undefined);
        api.getGov24SyncSchedule().then(schedule => {
            setAutoSyncEnabled(schedule.enabled);
            setAutoSyncIntervalHours(schedule.interval_hours);
        }).catch(() => undefined);
    }, []);

    const saveServiceKey = async () => {
        if (!serviceKey.trim()) return;
        setSavingKey(true);
        try {
            await api.saveExternalDataConnection('kr.gov24', serviceKey);
            setServiceKey('');
            setHasServiceKey(true);
            toast.success(t('externalData.serviceKeySaved'));
        } catch { toast.error(t('externalData.serviceKeySaveFailed')); }
        finally { setSavingKey(false); }
    };

    const toggleSource = async (sourceId: string, enabled: boolean) => {
        const previous = enabledSources[sourceId] ?? false;
        setEnabledSources(current => ({...current, [sourceId]: enabled}));
        setSavingSourceId(sourceId);
        try {
            await api.saveExternalDataSourceEnabled(sourceId, enabled);
        } catch {
            setEnabledSources(current => ({...current, [sourceId]: previous}));
            toast.error(t('externalData.sourceToggleFailed'));
        } finally { setSavingSourceId(null); }
    };

    const startSync = async () => {
        setSyncStatus(current => ({...current, status: 'running', stage: 'list', current: 0, total: 0}));
        try {
            const finalStatus = await api.streamGov24Sync(setSyncStatus);
            setSyncStatus(finalStatus);
        } catch {
            setSyncStatus(current => ({...current, status: 'failed'}));
            toast.error(t('externalData.syncStartFailed'));
        }
    };

    const startBizSupportSync = async () => {
        setBizSupportSyncStatus(current => ({...current, status: 'running', stage: 'list', current: 0, total: 0}));
        try {
            const result = await api.startExternalSourceSync('kr.biz_support');
            if (result.sync_status) return setBizSupportSyncStatus(result.sync_status);
        } catch {
            setBizSupportSyncStatus(current => ({...current, status: 'failed'}));
            toast.error(t('externalData.syncStartFailed'));
        }
    };

    const startAllSync = async () => {
        setIsAllSyncing(true);
        if (enabledSources['kr.gov24']) setSyncStatus(current => ({...current, status: 'running', stage: 'list', current: 0, total: 0}));
        if (enabledSources['kr.biz_support']) setBizSupportSyncStatus(current => ({...current, status: 'running', stage: 'list', current: 0, total: 0}));
        try {
            await api.streamAllExternalDataSync(event => {
                if (event.sources['kr.gov24']) setSyncStatus(event.sources['kr.gov24']);
                if (event.sources['kr.biz_support']) setBizSupportSyncStatus(event.sources['kr.biz_support']);
            });
        } catch {
            toast.error(t('externalData.syncStartFailed'));
        } finally {
            setIsAllSyncing(false);
        }
    };

    const saveSchedule = async (enabled: boolean, intervalHours: number) => {
        const previous = [autoSyncEnabled, autoSyncIntervalHours] as const;
        setAutoSyncEnabled(enabled);
        setAutoSyncIntervalHours(intervalHours);
        setSavingSchedule(true);
        try { await api.saveGov24SyncSchedule(enabled, intervalHours); }
        catch {
            setAutoSyncEnabled(previous[0]); setAutoSyncIntervalHours(previous[1]);
            toast.error(t('externalData.autoSyncSaveFailed'));
        } finally { setSavingSchedule(false); }
    };

    const formatter = new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language);
    const lastSync = syncStatus.last_successful_sync_at
        ? new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(syncStatus.last_successful_sync_at))
        : t('externalData.neverSynced');
    const supportedEnabledSources = DATA_SOURCES.filter(source => (source.id === 'gov24' || source.id === 'bizSupport') && enabledSources[source.sourceId]);
    const intervalOptions = SYNC_INTERVAL_HOURS.map(hours => ({value: String(hours), label: t('externalData.autoSyncIntervalOption', {count: hours})}));
    const countryOptions = [{value: 'KR', label: `🇰🇷 ${t('externalData.countryKr')}`}];

    return <section className="external-data-section">
        <header className="external-data-heading">
            <h4>{t('externalData.title')}</h4>
            <div className="external-data-country-select"><label>{t('externalData.country')}</label><CustomSelect options={countryOptions} value={country} onChange={setCountry} triggerStyle={{width: '100%'}}/></div>
        </header>
        <div className="external-data-setup-card">
            <div className="external-data-guide-header"><h6>{t('externalData.guideTitle')}</h6><a href="https://www.data.go.kr/" target="_blank" rel="noreferrer">{t('externalData.openPortal')}<ExternalLink size={13}/></a></div>
            <ol>{[1, 2, 3, 4].map(step => <li key={step}>{t(`externalData.setupSteps.${step}`)}</li>)}</ol>
            <div className="external-data-key-form">
                <div className="external-data-key-label-row"><label htmlFor="public-data-service-key">{t('externalData.serviceKey')}</label>{hasServiceKey && <span className="external-data-key-saved">✓ {t('externalData.serviceKeyConfigured')}</span>}</div>
                <div className="external-data-key-input-row"><div className="external-data-key-input-wrap"><input id="public-data-service-key" type={showServiceKey ? 'text' : 'password'} value={serviceKey} placeholder={hasServiceKey ? t('externalData.serviceKeySavedPlaceholder') : t('externalData.serviceKeyPlaceholder')} autoComplete="off" onChange={event => setServiceKey(event.target.value)}/><button type="button" onClick={() => setShowServiceKey(value => !value)} aria-label={t(showServiceKey ? 'externalData.hideServiceKey' : 'externalData.showServiceKey')}>{showServiceKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div><button type="button" className="external-data-save-key" disabled={!serviceKey.trim() || savingKey} onClick={saveServiceKey}>{savingKey ? t('externalData.saving') : t('externalData.saveServiceKey')}</button></div>
            </div>
            {hasServiceKey && <div className="external-data-sync-panel">
                <div className="external-data-sync-row"><div className="external-data-sync-info"><strong>{t('externalData.syncAllData')}</strong><span className="external-data-sync-description">{t('externalData.syncAllDescription', {count: supportedEnabledSources.length})}</span><div className="external-data-sync-meta"><span>{t('externalData.lastUpdated', {date: lastSync})}</span><span>{t('externalData.documentCount', {count: formatter.format((syncStatus.document_count || 0) + (bizSupportSyncStatus.document_count || 0))})}</span></div></div><div className="external-data-sync-actions"><button type="button" className="external-data-sync-refresh" onClick={() => void startAllSync()} disabled={isAllSyncing || supportedEnabledSources.length === 0} aria-label={t('externalData.updateAllData')} title={t('externalData.updateAllData')}><RefreshCw className={isAllSyncing ? 'is-spinning' : ''} size={16}/></button></div></div>
                {isAllSyncing && <div className="external-data-overall-progress">{supportedEnabledSources.map(source => {
                    const status = source.id === 'gov24' ? syncStatus : bizSupportSyncStatus;
                    const current = status.current || 0;
                    const total = status.total || 0;
                    const percent = total ? Math.min(100, Math.round((current / total) * 100)) : 0;
                    const stageKey = source.id === 'gov24' ? (status.stage || 'list') : (status.status === 'completed' ? 'completed' : 'announcements');
                    const statusLabel = status.status === 'failed' ? t('externalData.syncFailed') : t(`externalData.syncStages.${stageKey}`);
                    return <div className={`external-data-service-progress is-${status.status}`} key={source.sourceId}><div className="external-data-service-progress-header"><strong>{t(`externalData.sources.${source.id}.name`)}</strong><span>{statusLabel}</span><span className="external-data-sync-count">{formatter.format(current)} / {total ? formatter.format(total) : '?'}</span></div><div className="external-data-sync-progress-track"><span style={{width: `${percent}%`}}/></div></div>;
                })}</div>}
                <div className="external-data-auto-sync"><div className="external-data-auto-sync-header"><div><strong>{t('externalData.autoSync')}</strong><span>{t('externalData.autoSyncDescription')}</span></div><label className="settings-switch"><input type="checkbox" checked={autoSyncEnabled} disabled={savingSchedule} onChange={event => void saveSchedule(event.target.checked, autoSyncIntervalHours)}/><span className="settings-switch-slider"/></label></div>{autoSyncEnabled && <div className="external-data-auto-sync-interval"><label>{t('externalData.autoSyncInterval')}</label><CustomSelect options={intervalOptions} value={String(autoSyncIntervalHours)} disabled={savingSchedule} ariaLabel={t('externalData.autoSyncInterval')} onChange={value => void saveSchedule(true, Number(value))} triggerStyle={{width: '100%'}} portal/></div>}</div>
            </div>}
        </div>
        {country === 'KR' && <div className="external-data-source-list"><div className="external-data-section-title"><span>{t('externalData.kr.title')}</span><span>{t('externalData.sourceCount', {count: DATA_SOURCES.length})}</span></div>
            {DATA_SOURCES.map(source => {
                const sourceStatus = source.id === 'bizSupport' ? bizSupportSyncStatus : syncStatus;
                const hasCollector = source.id === 'gov24' || source.id === 'bizSupport';
                const canBrowse = hasCollector && sourceStatus.status !== 'running' && (sourceStatus.document_count || 0) > 0;
                const canSync = hasCollector && Boolean(enabledSources[source.sourceId]);
                const sourceLastSync = sourceStatus.last_successful_sync_at ? new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(sourceStatus.last_successful_sync_at)) : t('externalData.neverSynced');
                const startSourceSync = source.id === 'bizSupport' ? startBizSupportSync : startSync;
                return <article className="external-data-source-card" key={source.id}><div className="external-data-source-summary"><div className="external-data-source-main"><div className="external-data-source-copy"><div className="external-data-source-title-row"><a className="external-data-source-link" href={source.url} target="_blank" rel="noreferrer" aria-label={t('externalData.openSourcePage')}><h5>{t(`externalData.sources.${source.id}.name`)}</h5><ExternalLink size={14}/></a></div><p>{t(`externalData.sources.${source.id}.description`)}</p></div><label className="settings-switch"><input type="checkbox" checked={enabledSources[source.sourceId] ?? false} disabled={savingSourceId === source.sourceId} onChange={event => void toggleSource(source.sourceId, event.target.checked)}/><span className="settings-switch-slider"/></label></div><div className="external-data-source-controls"><div className="external-data-source-state"><strong>{t('externalData.sourceData')}</strong>{hasCollector ? <span>{t('externalData.sourceDataSummary', {count: formatter.format(sourceStatus.document_count || 0), date: sourceLastSync})}</span> : <span>{t('externalData.collectorUnavailable')}</span>}</div><div className="external-data-source-actions"><button type="button" className="external-data-source-browse" disabled={!canBrowse} title={!canBrowse ? t('externalData.browseUnavailable') : undefined} onClick={() => { if (canBrowse) { setBrowseSource({sourceId: source.sourceId, sourceNameKey: source.id}); setShowDataModal(true); } }}><Database size={14}/>{t('externalData.browser.open')}</button><button type="button" className="external-data-source-refresh" disabled={!canSync || sourceStatus.status === 'running'} aria-label={t('externalData.updateSourceData')} title={canSync ? t('externalData.updateSourceData') : t('externalData.collectorUnavailable')} onClick={() => canSync && void startSourceSync()}><RefreshCw className={sourceStatus.status === 'running' ? 'is-spinning' : ''} size={15}/></button></div></div></div></article>;
            })}
        </div>}
        <Gov24DataModal isOpen={showDataModal} onClose={() => setShowDataModal(false)} sourceId={browseSource.sourceId} sourceNameKey={browseSource.sourceNameKey}/>
    </section>;
};

export default ExternalDataSection;
