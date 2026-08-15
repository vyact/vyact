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
    {id: 'housing', sourceId: 'kr.housing', url: 'https://www.data.go.kr/data/15108420/openapi.do'},
    {id: 'lhLeaseComplex', sourceId: 'kr.lh_lease_complex', url: 'https://www.data.go.kr/data/15059475/openapi.do'},
    {id: 'lhLeaseNotice', sourceId: 'kr.lh_lease_notice', url: 'https://www.data.go.kr/data/15058530/openapi.do'},
] as const;

type Gov24SyncStatus = Awaited<ReturnType<typeof api.getGov24SyncStatus>>;
const GOV24_SYNC_STAGE_NUMBERS: Record<string, number> = {list: 1, detail: 2, conditions: 3, completed: 3};
const BIZ_SUPPORT_SYNC_STAGE_NUMBERS: Record<string, number> = {list: 1, indexing: 2, completed: 3};
const K_STARTUP_SYNC_STAGE_NUMBERS: Record<string, number> = {startupAnnouncements: 1, startupBusinesses: 2, indexing: 3, completed: 3};
const WELFARE_SYNC_STAGE_NUMBERS: Record<string, number> = {welfareList: 1, welfareDetail: 2, indexing: 3, completed: 3};
const HOUSING_SYNC_STAGE_NUMBERS: Record<string, number> = {housingRental: 1, housingSale: 2, indexing: 3, completed: 3};
const LH_SYNC_STAGE_NUMBERS: Record<string, number> = {lhLeaseComplex: 1, lhLeaseNotice: 1, indexing: 2, completed: 3};
const SYNC_INTERVAL_HOURS = [1, 3, 6, 12, 24] as const;
const UNAVAILABLE_SOURCE_STATUS: Gov24SyncStatus = {status: 'idle'};

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
    const [kStartupSyncStatus, setKStartupSyncStatus] = useState<Gov24SyncStatus>({status: 'idle'});
    const [welfareSyncStatus, setWelfareSyncStatus] = useState<Gov24SyncStatus>({status: 'idle'});
    const [housingSyncStatus, setHousingSyncStatus] = useState<Gov24SyncStatus>({status: 'idle'});
    const [lhComplexSyncStatus, setLhComplexSyncStatus] = useState<Gov24SyncStatus>({status: 'idle'});
    const [lhNoticeSyncStatus, setLhNoticeSyncStatus] = useState<Gov24SyncStatus>({status: 'idle'});
    const [visibleSyncErrors, setVisibleSyncErrors] = useState<Set<string>>(new Set());
    const [isAllSyncing, setIsAllSyncing] = useState(false);
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
    const [autoSyncIntervalHours, setAutoSyncIntervalHours] = useState(24);
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [autoDeleteExpiredEnabled, setAutoDeleteExpiredEnabled] = useState(false);
    const [savingCleanup, setSavingCleanup] = useState(false);
    const [eligibilityProfile, setEligibilityProfile] = useState('');
    const [savedEligibilityProfile, setSavedEligibilityProfile] = useState('');
    const [savingEligibilityProfile, setSavingEligibilityProfile] = useState(false);
    const [customInstruction, setCustomInstruction] = useState('');
    const [savedCustomInstruction, setSavedCustomInstruction] = useState('');
    const [savingPrompt, setSavingPrompt] = useState(false);
    const [showDataModal, setShowDataModal] = useState(false);
    const [browseSource, setBrowseSource] = useState<{sourceId: string; sourceNameKey: string}>({sourceId: 'kr.gov24', sourceNameKey: 'gov24'});

    useEffect(() => {
        api.getExternalDataBootstrap().then(({connections, statuses, schedule, cleanup, prompt}) => {
            setHasServiceKey(Boolean(connections['kr.gov24']?.has_service_key));
            setEnabledSources(Object.fromEntries(DATA_SOURCES.map(source => [
                source.sourceId,
                connections[source.sourceId]?.enabled ?? source.sourceId === 'kr.gov24',
            ])));
            setSyncStatus(statuses['kr.gov24'] || {status: 'idle'});
            setBizSupportSyncStatus(statuses['kr.biz_support'] || {status: 'idle'});
            setKStartupSyncStatus(statuses['kr.k_startup'] || {status: 'idle'});
            setWelfareSyncStatus(statuses['kr.welfare'] || {status: 'idle'});
            setHousingSyncStatus(statuses['kr.housing'] || {status: 'idle'});
            setLhComplexSyncStatus(statuses['kr.lh_lease_complex'] || {status: 'idle'});
            setLhNoticeSyncStatus(statuses['kr.lh_lease_notice'] || {status: 'idle'});
            setAutoSyncEnabled(schedule.enabled);
            setAutoSyncIntervalHours(schedule.interval_hours);
            setAutoDeleteExpiredEnabled(cleanup.enabled);
            setEligibilityProfile(prompt?.eligibility_profile || '');
            setSavedEligibilityProfile(prompt?.eligibility_profile || '');
            setCustomInstruction(prompt?.instruction || '');
            setSavedCustomInstruction(prompt?.instruction || '');
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
        setVisibleSyncErrors(current => { const next = new Set(current); next.delete('kr.gov24'); return next; });
        setSyncStatus(current => ({...current, status: 'running', stage: 'list', current: 0, total: 0}));
        try {
            const finalStatus = await api.streamGov24Sync(setSyncStatus);
            setSyncStatus(finalStatus);
            if (finalStatus.status === 'failed') setVisibleSyncErrors(current => new Set(current).add('kr.gov24'));
        } catch {
            setSyncStatus(current => ({...current, status: 'failed'}));
            setVisibleSyncErrors(current => new Set(current).add('kr.gov24'));
            toast.error(t('externalData.syncStartFailed'));
        }
    };

    const startBizSupportSync = async () => {
        setVisibleSyncErrors(current => { const next = new Set(current); next.delete('kr.biz_support'); return next; });
        setBizSupportSyncStatus(current => ({...current, status: 'running', stage: 'list', current: 0, total: 0}));
        try {
            const finalStatus = await api.streamExternalSourceSync('kr.biz_support', setBizSupportSyncStatus);
            setBizSupportSyncStatus(finalStatus);
            if (finalStatus.status === 'failed') setVisibleSyncErrors(current => new Set(current).add('kr.biz_support'));
        } catch {
            setBizSupportSyncStatus(current => ({...current, status: 'failed'}));
            setVisibleSyncErrors(current => new Set(current).add('kr.biz_support'));
            toast.error(t('externalData.syncStartFailed'));
        }
    };

    const startKStartupSync = async () => {
        setVisibleSyncErrors(current => { const next = new Set(current); next.delete('kr.k_startup'); return next; });
        setKStartupSyncStatus(current => ({...current, status: 'running', stage: 'startupAnnouncements', current: 0, total: 0}));
        try {
            const finalStatus = await api.streamExternalSourceSync('kr.k_startup', setKStartupSyncStatus);
            setKStartupSyncStatus(finalStatus);
            if (finalStatus.status === 'failed') setVisibleSyncErrors(current => new Set(current).add('kr.k_startup'));
        } catch {
            setKStartupSyncStatus(current => ({...current, status: 'failed'}));
            setVisibleSyncErrors(current => new Set(current).add('kr.k_startup'));
            toast.error(t('externalData.syncStartFailed'));
        }
    };

    const startWelfareSync = async () => {
        setVisibleSyncErrors(current => { const next = new Set(current); next.delete('kr.welfare'); return next; });
        setWelfareSyncStatus(current => ({...current, status: 'running', stage: 'welfareList', current: 0, total: 0}));
        try {
            const finalStatus = await api.streamExternalSourceSync('kr.welfare', setWelfareSyncStatus);
            setWelfareSyncStatus(finalStatus);
            if (finalStatus.status === 'failed') {
                setVisibleSyncErrors(current => new Set(current).add('kr.welfare'));
                toast.error(t(finalStatus.error_code === 'request_limit_exceeded'
                    ? 'externalData.welfare.requestLimitExceeded'
                    : 'externalData.syncStartFailed'));
            }
        } catch {
            setWelfareSyncStatus(current => ({...current, status: 'failed'}));
            setVisibleSyncErrors(current => new Set(current).add('kr.welfare'));
            toast.error(t('externalData.syncStartFailed'));
        }
    };

    const startHousingSync = async () => {
        setVisibleSyncErrors(current => { const next = new Set(current); next.delete('kr.housing'); return next; });
        setHousingSyncStatus(current => ({...current, status: 'running', stage: 'housingRental', current: 0, total: 0, request_limit: 1000}));
        try {
            const finalStatus = await api.streamExternalSourceSync('kr.housing', setHousingSyncStatus);
            setHousingSyncStatus(finalStatus);
            if (finalStatus.status === 'failed') {
                setVisibleSyncErrors(current => new Set(current).add('kr.housing'));
                toast.error(t('externalData.housing.syncFailed'));
            }
        } catch {
            setHousingSyncStatus(current => ({...current, status: 'failed'}));
            setVisibleSyncErrors(current => new Set(current).add('kr.housing'));
            toast.error(t('externalData.housing.syncFailed'));
        }
    };

    const startLhSync = async (sourceId: 'kr.lh_lease_complex' | 'kr.lh_lease_notice') => {
        const setter = sourceId === 'kr.lh_lease_complex' ? setLhComplexSyncStatus : setLhNoticeSyncStatus;
        const stage = sourceId === 'kr.lh_lease_complex' ? 'lhLeaseComplex' : 'lhLeaseNotice';
        setVisibleSyncErrors(current => { const next = new Set(current); next.delete(sourceId); return next; });
        setter(current => ({...current, status: 'running', stage, current: 0, total: 0, request_limit: 10000}));
        try {
            const finalStatus = await api.streamExternalSourceSync(sourceId, setter);
            setter(finalStatus);
            if (finalStatus.status === 'failed') setVisibleSyncErrors(current => new Set(current).add(sourceId));
        } catch {
            setter(current => ({...current, status: 'failed'}));
            setVisibleSyncErrors(current => new Set(current).add(sourceId));
            toast.error(t('externalData.syncStartFailed'));
        }
    };

    const startAllSync = async () => {
        setVisibleSyncErrors(new Set());
        setIsAllSyncing(true);
        if (enabledSources['kr.gov24']) setSyncStatus(current => ({...current, status: 'running', stage: 'list', current: 0, total: 0}));
        if (enabledSources['kr.biz_support']) setBizSupportSyncStatus(current => ({...current, status: 'running', stage: 'list', current: 0, total: 0}));
        if (enabledSources['kr.k_startup']) setKStartupSyncStatus(current => ({...current, status: 'running', stage: 'startupAnnouncements', current: 0, total: 0}));
        if (enabledSources['kr.welfare']) setWelfareSyncStatus(current => ({...current, status: 'running', stage: 'welfareList', current: 0, total: 0}));
        if (enabledSources['kr.housing']) setHousingSyncStatus(current => ({...current, status: 'running', stage: 'housingRental', current: 0, total: 0, request_limit: 1000}));
        if (enabledSources['kr.lh_lease_complex']) setLhComplexSyncStatus(current => ({...current, status: 'running', stage: 'lhLeaseComplex', current: 0, total: 0, request_limit: 10000}));
        if (enabledSources['kr.lh_lease_notice']) setLhNoticeSyncStatus(current => ({...current, status: 'running', stage: 'lhLeaseNotice', current: 0, total: 0, request_limit: 10000}));
        try {
            await api.streamAllExternalDataSync(event => {
                if (event.sources['kr.gov24']) setSyncStatus(event.sources['kr.gov24']);
                if (event.sources['kr.biz_support']) setBizSupportSyncStatus(event.sources['kr.biz_support']);
                if (event.sources['kr.k_startup']) setKStartupSyncStatus(event.sources['kr.k_startup']);
                if (event.sources['kr.welfare']) setWelfareSyncStatus(event.sources['kr.welfare']);
                if (event.sources['kr.housing']) setHousingSyncStatus(event.sources['kr.housing']);
                if (event.sources['kr.lh_lease_complex']) setLhComplexSyncStatus(event.sources['kr.lh_lease_complex']);
                if (event.sources['kr.lh_lease_notice']) setLhNoticeSyncStatus(event.sources['kr.lh_lease_notice']);
                setVisibleSyncErrors(current => {
                    const next = new Set(current);
                    Object.entries(event.sources).forEach(([sourceId, status]) => {
                        if (status.status === 'failed') next.add(sourceId);
                    });
                    return next;
                });
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

    const saveCleanup = async (enabled: boolean) => {
        const previous = autoDeleteExpiredEnabled;
        setAutoDeleteExpiredEnabled(enabled);
        setSavingCleanup(true);
        try { await api.saveExternalDataCleanup(enabled); }
        catch {
            setAutoDeleteExpiredEnabled(previous);
            toast.error(t('externalData.autoDeleteSaveFailed'));
        } finally { setSavingCleanup(false); }
    };

    const saveCustomInstruction = async () => {
        setSavingPrompt(true);
        try {
            const result = await api.saveExternalDataPrompt(customInstruction);
            setCustomInstruction(result.instruction);
            setSavedCustomInstruction(result.instruction);
            toast.success(t('externalData.promptSaved'));
        } catch {
            toast.error(t('externalData.promptSaveFailed'));
        } finally {
            setSavingPrompt(false);
        }
    };

    const saveEligibilityProfile = async () => {
        setSavingEligibilityProfile(true);
        try {
            const result = await api.saveExternalDataEligibilityProfile(eligibilityProfile);
            setEligibilityProfile(result.profile);
            setSavedEligibilityProfile(result.profile);
            toast.success(t('externalData.eligibilityProfileSaved'));
        } catch {
            toast.error(t('externalData.eligibilityProfileSaveFailed'));
        } finally {
            setSavingEligibilityProfile(false);
        }
    };

    const formatter = new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language);
    const lastSync = syncStatus.last_successful_sync_at
        ? new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(syncStatus.last_successful_sync_at))
        : t('externalData.neverSynced');
    const supportedEnabledSources = DATA_SOURCES.filter(source => enabledSources[source.sourceId]);
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
            <div className="external-data-prompt-form">
                <div className="external-data-prompt-heading"><div><strong>{t('externalData.eligibilityProfileTitle')}</strong><p>{t('externalData.eligibilityProfileDescription')}</p></div><span>{eligibilityProfile.length} / 4,000</span></div>
                <textarea value={eligibilityProfile} maxLength={4000} placeholder={t('externalData.eligibilityProfilePlaceholder')} onChange={event => setEligibilityProfile(event.target.value)}/>
                <div className="external-data-prompt-actions"><button type="button" className="external-data-save-key" disabled={savingEligibilityProfile || eligibilityProfile === savedEligibilityProfile} onClick={() => void saveEligibilityProfile()}>{savingEligibilityProfile ? t('externalData.saving') : t('externalData.saveEligibilityProfile')}</button></div>
            </div>
            <div className="external-data-prompt-form">
                <div className="external-data-prompt-heading"><div><strong>{t('externalData.promptTitle')}</strong><p>{t('externalData.promptDescription')}</p></div><span>{customInstruction.length} / 4,000</span></div>
                <textarea value={customInstruction} maxLength={4000} placeholder={t('externalData.promptPlaceholder')} onChange={event => setCustomInstruction(event.target.value)}/>
                <div className="external-data-prompt-actions"><button type="button" className="external-data-save-key" disabled={savingPrompt || customInstruction === savedCustomInstruction} onClick={() => void saveCustomInstruction()}>{savingPrompt ? t('externalData.saving') : t('externalData.savePrompt')}</button></div>
            </div>
            {hasServiceKey && <div className="external-data-sync-panel">
                <div className="external-data-sync-row"><div className="external-data-sync-info"><strong>{t('externalData.syncAllData')}</strong><span className="external-data-sync-description">{t('externalData.syncAllDescription', {count: supportedEnabledSources.length})}</span><div className="external-data-sync-meta"><span>{t('externalData.lastUpdated', {date: lastSync})}</span><span>{t('externalData.documentCount', {count: formatter.format((syncStatus.document_count || 0) + (bizSupportSyncStatus.document_count || 0) + (kStartupSyncStatus.document_count || 0) + (welfareSyncStatus.document_count || 0) + (housingSyncStatus.document_count || 0) + (lhComplexSyncStatus.document_count || 0) + (lhNoticeSyncStatus.document_count || 0))})}</span></div></div><div className="external-data-sync-actions"><button type="button" className="external-data-sync-refresh" onClick={() => void startAllSync()} disabled={isAllSyncing || supportedEnabledSources.length === 0} aria-label={t('externalData.updateAllData')}><RefreshCw className={isAllSyncing ? 'is-spinning' : ''} size={16}/></button></div></div>
                {isAllSyncing && <div className="external-data-overall-progress">{supportedEnabledSources.map(source => {
                    const status = source.id === 'gov24' ? syncStatus : source.id === 'bizSupport' ? bizSupportSyncStatus : source.id === 'kStartup' ? kStartupSyncStatus : source.id === 'welfare' ? welfareSyncStatus : source.id === 'housing' ? housingSyncStatus : source.id === 'lhLeaseComplex' ? lhComplexSyncStatus : lhNoticeSyncStatus;
                    const current = status.current || 0;
                    const total = status.total || 0;
                    const stageKey = source.id === 'gov24' ? (status.stage || 'list') : source.id === 'bizSupport' ? (status.stage || 'list') : source.id === 'kStartup' ? (status.stage || 'startupAnnouncements') : source.id === 'welfare' ? (status.stage || 'welfareList') : source.id === 'housing' ? (status.stage || 'housingRental') : source.id === 'lhLeaseComplex' ? (status.stage || 'lhLeaseComplex') : (status.stage || 'lhLeaseNotice');
                    const stageNumbers = source.id === 'gov24' ? GOV24_SYNC_STAGE_NUMBERS : source.id === 'bizSupport' ? BIZ_SUPPORT_SYNC_STAGE_NUMBERS : source.id === 'kStartup' ? K_STARTUP_SYNC_STAGE_NUMBERS : source.id === 'welfare' ? WELFARE_SYNC_STAGE_NUMBERS : source.id === 'housing' ? HOUSING_SYNC_STAGE_NUMBERS : LH_SYNC_STAGE_NUMBERS;
                    const stageNumber = status.status === 'completed' ? 3 : (stageNumbers[stageKey] || 1);
                    const itemPercent = total ? Math.min(1, current / total) : 0;
                    const percent = status.status === 'completed' ? 100 : Math.round((((stageNumber - 1) + itemPercent) / 3) * 100);
                    const translatedStageKey = stageKey === 'lhLeaseComplex' ? 'housingRental' : stageKey === 'lhLeaseNotice' ? 'announcements' : stageKey;
                    const statusLabel = status.status === 'failed' ? t('externalData.syncFailed') : t(`externalData.syncStages.${translatedStageKey}`);
                    return <div className={`external-data-service-progress is-${status.status}`} key={source.sourceId}><div className="external-data-service-progress-header"><strong>{t(`externalData.sources.${source.id}.name`)}</strong><span><strong className="external-data-sync-stage">{stageNumber} / 3</strong>{statusLabel}</span><span className="external-data-sync-count">{formatter.format(current)} / {total ? formatter.format(total) : '?'}</span></div><div className="external-data-sync-progress-track"><span style={{width: `${percent}%`}}/></div></div>;
                })}</div>}
                <div className="external-data-auto-sync"><div className="external-data-auto-sync-header"><div><strong>{t('externalData.autoSync')}</strong><span>{t('externalData.autoSyncDescription')}</span></div><label className="settings-switch"><input type="checkbox" checked={autoSyncEnabled} disabled={savingSchedule} onChange={event => void saveSchedule(event.target.checked, autoSyncIntervalHours)}/><span className="settings-switch-slider"/></label></div>{autoSyncEnabled && <div className="external-data-auto-sync-interval"><label>{t('externalData.autoSyncInterval')}</label><CustomSelect options={intervalOptions} value={String(autoSyncIntervalHours)} disabled={savingSchedule} ariaLabel={t('externalData.autoSyncInterval')} onChange={value => void saveSchedule(true, Number(value))} triggerStyle={{width: '100%'}} portal/></div>}</div>
                <div className="external-data-auto-sync external-data-auto-delete"><div className="external-data-auto-sync-header"><div><strong>{t('externalData.autoDeleteExpired')}</strong><span>{t('externalData.autoDeleteExpiredDescription')}</span></div><label className="settings-switch"><input type="checkbox" checked={autoDeleteExpiredEnabled} disabled={savingCleanup} onChange={event => void saveCleanup(event.target.checked)}/><span className="settings-switch-slider"/></label></div></div>
            </div>}
        </div>
        {country === 'KR' && <div className="external-data-source-list"><div className="external-data-section-title"><span>{t('externalData.kr.title')}</span><span>{t('externalData.sourceCount', {count: DATA_SOURCES.length})}</span></div>
            {DATA_SOURCES.map(source => {
                const sourceStatus = source.id === 'gov24'
                    ? syncStatus
                    : source.id === 'bizSupport'
                        ? bizSupportSyncStatus
                        : source.id === 'kStartup'
                            ? kStartupSyncStatus
                            : source.id === 'welfare'
                                ? welfareSyncStatus
                            : source.id === 'housing'
                                ? housingSyncStatus
                            : source.id === 'lhLeaseComplex'
                                ? lhComplexSyncStatus
                            : source.id === 'lhLeaseNotice'
                                ? lhNoticeSyncStatus
                            : UNAVAILABLE_SOURCE_STATUS;
                const hasCollector = true;
                const canBrowse = hasCollector && sourceStatus.status !== 'running' && (sourceStatus.document_count || 0) > 0;
                const canSync = hasCollector && Boolean(enabledSources[source.sourceId]);
                const sourceLastSync = sourceStatus.last_successful_sync_at ? new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(sourceStatus.last_successful_sync_at)) : t('externalData.neverSynced');
                const startSourceSync = source.id === 'bizSupport' ? startBizSupportSync : source.id === 'kStartup' ? startKStartupSync : source.id === 'welfare' ? startWelfareSync : source.id === 'housing' ? startHousingSync : source.id === 'lhLeaseComplex' ? () => startLhSync('kr.lh_lease_complex') : source.id === 'lhLeaseNotice' ? () => startLhSync('kr.lh_lease_notice') : startSync;
                const sourceProgress = sourceStatus.total
                    ? Math.min(100, Math.round(((sourceStatus.current || 0) / sourceStatus.total) * 100))
                    : 0;
                return <article className={`external-data-source-card source-${source.id} ${enabledSources[source.sourceId] ? 'is-enabled' : ''}`} key={source.id}>
                    <div className="external-data-source-summary">
                        <div className="external-data-source-main"><div className="external-data-source-copy"><div className="external-data-source-title-row"><a className="external-data-source-link" href={source.url} target="_blank" rel="noreferrer" aria-label={t('externalData.openSourcePage')}><h5>{t(`externalData.sources.${source.id}.name`)}</h5><ExternalLink size={14}/></a><span className="external-data-source-quota">{t('externalData.requestUsage', {used: formatter.format(sourceStatus.request_count || 0), limit: formatter.format(sourceStatus.request_limit || 0)})}</span></div><p>{t(`externalData.sources.${source.id}.description`)}</p></div><label className="settings-switch"><input type="checkbox" checked={enabledSources[source.sourceId] ?? false} disabled={savingSourceId === source.sourceId} onChange={event => void toggleSource(source.sourceId, event.target.checked)}/><span className="settings-switch-slider"/></label></div>
                        <div className="external-data-source-controls"><div className="external-data-source-state"><strong>{t('externalData.sourceData')}</strong>{hasCollector ? <span>{t('externalData.sourceDataSummary', {count: formatter.format(sourceStatus.document_count || 0), date: sourceLastSync})}</span> : <span>{t('externalData.collectorUnavailable')}</span>}</div><div className="external-data-source-actions"><button type="button" className="external-data-source-browse" disabled={!canBrowse} onClick={() => { if (canBrowse) { setBrowseSource({sourceId: source.sourceId, sourceNameKey: source.id}); setShowDataModal(true); } }}><Database size={14}/>{t('externalData.browser.open')}</button><button type="button" className="external-data-source-refresh" disabled={!canSync || sourceStatus.status === 'running'} aria-label={t('externalData.updateSourceData')} onClick={() => canSync && void startSourceSync()}><RefreshCw className={sourceStatus.status === 'running' ? 'is-spinning' : ''} size={15}/></button></div></div>
                        {sourceStatus.status === 'running' && (() => { const stageNumbers = source.id === 'gov24' ? GOV24_SYNC_STAGE_NUMBERS : source.id === 'bizSupport' ? BIZ_SUPPORT_SYNC_STAGE_NUMBERS : source.id === 'kStartup' ? K_STARTUP_SYNC_STAGE_NUMBERS : source.id === 'welfare' ? WELFARE_SYNC_STAGE_NUMBERS : source.id === 'housing' ? HOUSING_SYNC_STAGE_NUMBERS : LH_SYNC_STAGE_NUMBERS; const defaultStage = source.id === 'gov24' || source.id === 'bizSupport' ? 'list' : source.id === 'kStartup' ? 'startupAnnouncements' : source.id === 'welfare' ? 'welfareList' : source.id === 'housing' ? 'housingRental' : source.id === 'lhLeaseComplex' ? 'lhLeaseComplex' : 'lhLeaseNotice'; const stage = sourceStatus.stage || defaultStage; const stageNumber = stageNumbers[stage] || 1; const translatedStage = stage === 'lhLeaseComplex' ? 'housingRental' : stage === 'lhLeaseNotice' ? 'announcements' : stage; const stagePercent = Math.round((((stageNumber - 1) + sourceProgress / 100) / 3) * 100); return <div className="external-data-sync-progress external-data-source-sync-progress"><div className="external-data-sync-progress-label"><span><strong className="external-data-sync-stage">{stageNumber} / 3</strong><span className="external-data-sync-stage-label">{t(`externalData.syncStages.${translatedStage}`)}</span></span><span className="external-data-sync-count">{formatter.format(sourceStatus.current || 0)} / {sourceStatus.total ? formatter.format(sourceStatus.total) : '?'}</span></div><div className="external-data-sync-progress-track"><span style={{width: `${stagePercent}%`}}/></div></div>; })()}
                        {hasCollector && sourceStatus.status === 'failed' && visibleSyncErrors.has(source.sourceId) && <p className="external-data-sync-error">{sourceStatus.error_code === 'request_limit_exceeded' ? t('externalData.requestLimitExceeded') : t('externalData.syncFailed')}</p>}
                    </div>
                </article>;
            })}
        </div>}
        <Gov24DataModal key={showDataModal ? browseSource.sourceId : 'closed'} isOpen={showDataModal} onClose={() => setShowDataModal(false)} sourceId={browseSource.sourceId} sourceNameKey={browseSource.sourceNameKey}/>
    </section>;
};

export default ExternalDataSection;
