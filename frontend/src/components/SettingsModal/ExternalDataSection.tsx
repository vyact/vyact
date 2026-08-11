import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ExternalLink, Eye, EyeOff} from 'lucide-react';
import {api} from '../../services/api';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import CustomSelect from '../CustomSelect/CustomSelect';
import './ExternalDataSection.css';

const DATA_SOURCES = [
    {
        id: 'gov24',
        applicationUrl: 'https://www.data.go.kr/data/15113968/openapi.do',
        available: true,
    },
    {
        id: 'youthCenter',
        applicationUrl: 'https://www.youthcenter.go.kr/cmnFooter/openapiIntro/oaiGuide',
        available: false,
    },
    {
        id: 'bizInfo',
        applicationUrl: 'https://www.bizinfo.go.kr/apiList.do',
        available: false,
    },
] as const;

type Gov24SyncStatus = Awaited<ReturnType<typeof api.getGov24SyncStatus>>;

const ExternalDataSection: React.FC = () => {
    const {t, i18n} = useTranslation('settings');
    const [country, setCountry] = useState('KR');
    const [expandedSourceId, setExpandedSourceId] = useState<string | null>('gov24');
    const [gov24ServiceKey, setGov24ServiceKey] = useState('');
    const [hasGov24ServiceKey, setHasGov24ServiceKey] = useState(false);
    const [showGov24ServiceKey, setShowGov24ServiceKey] = useState(false);
    const [savingGov24ServiceKey, setSavingGov24ServiceKey] = useState(false);
    const [gov24SyncStatus, setGov24SyncStatus] = useState<Gov24SyncStatus>({status: 'idle'});
    const countryOptions = [{value: 'KR', label: `🇰🇷 ${t('externalData.countryKr')}`}];

    useEffect(() => {
        api.getExternalDataConnections()
            .then(({connections}) => setHasGov24ServiceKey(Boolean(connections['kr.gov24']?.has_service_key)))
            .catch(() => undefined);
        api.getGov24SyncStatus().then(setGov24SyncStatus).catch(() => undefined);
    }, []);

    useEffect(() => {
        if (gov24SyncStatus.status !== 'running') return;
        const intervalId = window.setInterval(() => {
            api.getGov24SyncStatus().then(setGov24SyncStatus).catch(() => undefined);
        }, 1500);
        return () => window.clearInterval(intervalId);
    }, [gov24SyncStatus.status]);

    const saveGov24ServiceKey = async () => {
        if (!gov24ServiceKey.trim()) return;
        setSavingGov24ServiceKey(true);
        try {
            await api.saveExternalDataConnection('kr.gov24', gov24ServiceKey);
            setGov24ServiceKey('');
            setHasGov24ServiceKey(true);
            toast.success(t('externalData.serviceKeySaved'));
        } catch {
            toast.error(t('externalData.serviceKeySaveFailed'));
        } finally {
            setSavingGov24ServiceKey(false);
        }
    };

    const startGov24Sync = async () => {
        try {
            await api.startGov24Sync();
            setGov24SyncStatus(current => ({...current, status: 'running', stage: 'list', current: 0, total: 0}));
        } catch {
            toast.error(t('externalData.syncStartFailed'));
        }
    };

    const syncProgress = gov24SyncStatus.total
        ? Math.min(100, Math.round(((gov24SyncStatus.current || 0) / gov24SyncStatus.total) * 100))
        : 0;
    const lastSyncLabel = gov24SyncStatus.last_successful_sync_at
        ? new Intl.DateTimeFormat(i18n.language, {dateStyle: 'medium', timeStyle: 'short'}).format(
            new Date(gov24SyncStatus.last_successful_sync_at),
        )
        : t('externalData.neverSynced');

    return (
        <section className="external-data-section">
            <header className="external-data-heading">
                <div>
                    <h4>{t('externalData.title')}</h4>
                    <p>{t('externalData.description')}</p>
                </div>
                <div className="external-data-country-select">
                    <label>{t('externalData.country')}</label>
                    <CustomSelect
                        options={countryOptions}
                        value={country}
                        onChange={setCountry}
                        triggerStyle={{width: '100%'}}
                    />
                </div>
            </header>

            <div className="external-data-local-note">
                <span aria-hidden="true">🛡️</span>
                <span>{t('externalData.localNote')}</span>
            </div>

            {country === 'KR' && (
                <div className="external-data-source-list">
                    <div className="external-data-section-title">
                        <span>{t('externalData.kr.title')}</span>
                        <span>{t('externalData.sourceCount', {count: DATA_SOURCES.length})}</span>
                    </div>

                    {DATA_SOURCES.map(source => {
                        const isExpanded = expandedSourceId === source.id;
                        return (
                            <article className="external-data-source-card" key={source.id}>
                                <div className="external-data-source-summary">
                                    <div className="external-data-source-copy">
                                        <div className="external-data-source-title-row">
                                            <h5>{t(`externalData.sources.${source.id}.name`)}</h5>
                                            <span className={`external-data-status${source.available ? '' : ' is-planned'}`}>
                                                {t(source.available ? 'externalData.status.applicationRequired' : 'externalData.status.planned')}
                                            </span>
                                        </div>
                                        <p>{t(`externalData.sources.${source.id}.description`)}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="external-data-guide-toggle"
                                    aria-expanded={isExpanded}
                                    onClick={() => setExpandedSourceId(isExpanded ? null : source.id)}
                                >
                                    <span className={`external-data-guide-arrow${isExpanded ? ' is-open' : ''}`} aria-hidden="true">▶</span>
                                    <span>{t('externalData.guide')}</span>
                                </button>

                                <div className={`external-data-guide-collapse${isExpanded ? ' is-open' : ''}`}>
                                    <div className="external-data-guide">
                                        <div className="external-data-guide-header">
                                            <h6>{t('externalData.guideTitle')}</h6>
                                            <a href={source.applicationUrl} target="_blank" rel="noreferrer">
                                                {t('externalData.openApplicationPage')}
                                                <ExternalLink size={13}/>
                                            </a>
                                        </div>
                                        <ol>
                                            <li>{t(`externalData.sources.${source.id}.steps.1`)}</li>
                                            <li>{t(`externalData.sources.${source.id}.steps.2`)}</li>
                                            <li>{t(`externalData.sources.${source.id}.steps.3`)}</li>
                                            <li>{t(`externalData.sources.${source.id}.steps.4`)}</li>
                                        </ol>
                                        {source.id === 'gov24' && (
                                            <div className="external-data-key-form">
                                                <div className="external-data-key-label-row">
                                                    <label htmlFor="gov24-service-key">{t('externalData.serviceKey')}</label>
                                                    {hasGov24ServiceKey && (
                                                        <span className="external-data-key-saved">✓ {t('externalData.serviceKeyConfigured')}</span>
                                                    )}
                                                </div>
                                                <div className="external-data-key-input-row">
                                                    <div className="external-data-key-input-wrap">
                                                        <input
                                                            id="gov24-service-key"
                                                            type={showGov24ServiceKey ? 'text' : 'password'}
                                                            value={gov24ServiceKey}
                                                            placeholder={hasGov24ServiceKey
                                                                ? t('externalData.serviceKeySavedPlaceholder')
                                                                : t('externalData.serviceKeyPlaceholder')}
                                                            autoComplete="off"
                                                            onChange={event => setGov24ServiceKey(event.target.value)}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowGov24ServiceKey(value => !value)}
                                                            aria-label={t(showGov24ServiceKey ? 'externalData.hideServiceKey' : 'externalData.showServiceKey')}
                                                        >
                                                            {showGov24ServiceKey ? <EyeOff size={16}/> : <Eye size={16}/>}
                                                        </button>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="external-data-save-key"
                                                        disabled={!gov24ServiceKey.trim() || savingGov24ServiceKey}
                                                        onClick={saveGov24ServiceKey}
                                                    >
                                                        {savingGov24ServiceKey ? t('externalData.saving') : t('externalData.saveServiceKey')}
                                                    </button>
                                                </div>
                                                {hasGov24ServiceKey && (
                                                    <div className="external-data-sync-panel">
                                                        <div className="external-data-sync-row">
                                                            <div>
                                                                <strong>{t('externalData.syncData')}</strong>
                                                                <span>{t('externalData.lastUpdated', {date: lastSyncLabel})}</span>
                                                                <span>{t('externalData.documentCount', {count: gov24SyncStatus.document_count || 0})}</span>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={startGov24Sync}
                                                                disabled={gov24SyncStatus.status === 'running'}
                                                            >
                                                                {gov24SyncStatus.status === 'running'
                                                                    ? t('externalData.syncing')
                                                                    : gov24SyncStatus.last_successful_sync_at
                                                                        ? t('externalData.updateData')
                                                                        : t('externalData.fetchData')}
                                                            </button>
                                                        </div>
                                                        {gov24SyncStatus.status === 'running' && (
                                                            <div className="external-data-sync-progress">
                                                                <div className="external-data-sync-progress-label">
                                                                    <span>{t(`externalData.syncStages.${gov24SyncStatus.stage || 'list'}`)}</span>
                                                                    <span>{gov24SyncStatus.current || 0} / {gov24SyncStatus.total || '?'}</span>
                                                                </div>
                                                                <div className="external-data-sync-progress-track">
                                                                    <span style={{width: `${syncProgress}%`}}/>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {gov24SyncStatus.status === 'failed' && (
                                                            <p className="external-data-sync-error">{t('externalData.syncFailed')}</p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {source.id !== 'gov24' && (
                                            <p className="external-data-guide-note">{t(`externalData.sources.${source.id}.note`)}</p>
                                        )}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

export default ExternalDataSection;
