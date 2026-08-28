import {useEffect, useRef, useState} from 'react';
import {ChevronDown, CircleQuestionMark, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api, type VyactModelProfile} from '../../services/api';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import CustomSelect from '../CustomSelect/CustomSelect';
import SettingLabel from '../common/SettingLabel/SettingLabel';
import {Tooltip} from '../common/Tooltip/Tooltip';
import './ModelSettingsModal.css';

interface Props {
    modelPath: string;
    runtime: 'gguf' | 'mlx';
    repository?: string;
    recommendedContext?: number;
    activateOnApply?: boolean;
    forceActivateOnApply?: boolean;
    mtpSupported?: boolean;
    dflash2Supported?: boolean;
    onClose: () => void;
    onApplied: () => Promise<void>;
}

export default function ModelSettingsModal({modelPath, runtime, repository, recommendedContext = 32768, activateOnApply = false, forceActivateOnApply = false, mtpSupported = false, dflash2Supported = false, onClose, onApplied}: Props) {
    const {t} = useTranslation('main');
    const automaticSetupTooltip = t(`modelSettings.${runtime === 'gguf' ? 'automaticSetupGgufTooltip' : 'automaticSetupMlxTooltip'}`);
    const [profile, setProfile] = useState<VyactModelProfile | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const initialProfileRef = useRef<VyactModelProfile | null>(null);

    const comparableProfile = (value: VyactModelProfile) => ({
        model_path: value.model_path, runtime: value.runtime, repository: value.repository ?? null,
        context_size: value.context_size, max_output_tokens: value.max_output_tokens,
        history_token_budget: value.history_token_budget, temperature: value.temperature,
        top_k: value.top_k, top_p: value.top_p, cache_quantization: value.cache_quantization,
        mtp_enabled: value.mtp_enabled ?? null, kv_cache_precision: value.kv_cache_precision ?? 'none',
        performance_mode: value.performance_mode ?? 'auto', cpu_threads: value.cpu_threads ?? null,
        seed: value.seed ?? null,
    });

    useEffect(() => {
        void api.getVyactModelProfile(modelPath, runtime, repository, recommendedContext)
            .then(value => {
                const mtpEnabled = !dflash2Supported && mtpSupported && (value.mtp_enabled ?? true);
                const kvCachePrecision = value.kv_cache_precision ?? (value.cache_quantization ? 'q8' : 'none');
                const accelerationEnabled = dflash2Supported || mtpEnabled;
                const normalizedProfile = {...value, mtp_enabled: mtpEnabled, kv_cache_precision: accelerationEnabled ? 'none' as const : kvCachePrecision, cache_quantization: accelerationEnabled ? false : kvCachePrecision !== 'none'};
                initialProfileRef.current = normalizedProfile;
                setProfile(normalizedProfile);
            })
            .catch(value => setError(String(value)));
    }, [modelPath, runtime, repository, recommendedContext, mtpSupported, dflash2Supported]);

    const updateNumber = (key: keyof VyactModelProfile, value: string, nullable = false) => {
        if (!profile) return;
        setProfile({...profile, [key]: nullable && value === '' ? null : Number(value)});
    };
    const apply = async () => {
        if (!profile) return;
        if (profile.mtp_enabled && profile.kv_cache_precision !== 'none') {
            setError(t('modelSettings.accelerationConflict'));
            return;
        }
        setSaving(true);
        setError('');
        try {
            const hasChanges = initialProfileRef.current === null
                || JSON.stringify(comparableProfile(initialProfileRef.current)) !== JSON.stringify(comparableProfile(profile));
            if (!hasChanges && !forceActivateOnApply) {
                onClose();
                return;
            }
            const saved = hasChanges ? await api.saveVyactModelProfile(profile) : profile;
            if (activateOnApply) await api.activateVyactModel(modelPath, saved.context_size, undefined, runtime, repository, saved);
            await onApplied();
            onClose();
        } catch (value) {
            setError(String(value));
        } finally {
            setSaving(false);
        }
    };

    return <ModalOverlay className="model-settings-overlay" onClose={onClose} closeOnBackdrop={false}>
        <div className="model-settings-modal">
            <header><div><h2>{t('modelSettings.title')}</h2><div className="model-settings-model"><Tooltip content={automaticSetupTooltip} multiline size="medium"><button type="button" className="model-settings-model-help" aria-label={automaticSetupTooltip}><CircleQuestionMark size={14}/></button></Tooltip><span title={modelPath}>{modelPath.split('/').pop()}</span></div></div><button type="button" onClick={onClose} aria-label={t('modelSettings.close')}><X size={20}/></button></header>
            {!profile ? <div className="model-settings-loading">{error || t('modelSettings.loading')}</div> : <div className="model-settings-body">
                <p className="model-settings-description">{t('modelSettings.description')}</p>
                <label><SettingLabel label={t('modelSettings.context')} help={t('modelSettings.contextTooltip')}/><input className="model-settings-input" type="number" min="512" max="131072" value={profile.context_size} onChange={e => updateNumber('context_size', e.target.value)}/></label>
                <label><SettingLabel label={t('modelSettings.maxOutput')} help={t('modelSettings.maxOutputTooltip')}/><input className="model-settings-input" type="number" min="1" max="32768" value={profile.max_output_tokens} onChange={e => updateNumber('max_output_tokens', e.target.value)}/></label>
                <label><SettingLabel label={t('modelSettings.historyTokenBudget')} help={t('modelSettings.historyTokenBudgetTooltip')}/><input className="model-settings-input" type="number" min="0" max={profile.context_size} value={profile.history_token_budget} onChange={e => updateNumber('history_token_budget', e.target.value)}/></label>
                <label><SettingLabel label={t('modelSettings.temperature')} help={t('modelSettings.temperatureTooltip')}/><input className="model-settings-input" type="number" min="0" max="1" step="0.01" value={profile.temperature} onChange={e => updateNumber('temperature', e.target.value)}/></label>
                <label><SettingLabel label={t('modelSettings.topK')} help={t('modelSettings.topKTooltip')}/><input className="model-settings-input" type="number" min="0" max="100" value={profile.top_k ?? ''} placeholder={t('modelSettings.modelDefault')} onChange={e => updateNumber('top_k', e.target.value, true)}/></label>
                <label><SettingLabel label={t('modelSettings.topP')} help={t('modelSettings.topPTooltip')}/><input className="model-settings-input" type="number" min="0" max="1" step="0.01" value={profile.top_p ?? ''} placeholder={t('modelSettings.modelDefault')} onChange={e => updateNumber('top_p', e.target.value, true)}/></label>
                {dflash2Supported && <div className="model-settings-toggle"><SettingLabel label="DFlash2" help={t('modelSettings.dflash2AccelerationTooltip')} description={t('modelSettings.dflash2AccelerationHelp')}/><span className="vyact-mtp-badge">{t('modelSettings.auto')}</span></div>}
                {mtpSupported && !dflash2Supported && <div className="model-settings-toggle"><SettingLabel label={t('modelSettings.mtpAcceleration')} help={t('modelSettings.mtpAccelerationTooltip')} description={t('modelSettings.mtpAccelerationHelp')}/><button type="button" className={`model-settings-switch${profile.mtp_enabled ? ' is-on' : ''}`} role="switch" aria-checked={Boolean(profile.mtp_enabled)} onClick={() => setProfile({...profile, mtp_enabled: !profile.mtp_enabled, kv_cache_precision: !profile.mtp_enabled ? 'none' : profile.kv_cache_precision, cache_quantization: !profile.mtp_enabled ? false : profile.cache_quantization})}><span/></button></div>}
                <details className="model-settings-advanced">
                    <summary><span>{t('modelSettings.advanced')}</span><ChevronDown size={16} aria-hidden="true"/></summary>
                    <div className="model-settings-advanced-fields">
                        {Boolean(profile.capabilities?.performance_modes.length) && <div className="model-settings-option"><SettingLabel label={t('modelSettings.performanceMode')} help={t('modelSettings.performanceModeTooltip')} description={t('modelSettings.performanceModeHelp')}/><CustomSelect portal options={profile.capabilities!.performance_modes.map(value => ({value, label: t(`modelSettings.performanceModes.${value}`)}))} value={profile.performance_mode ?? 'auto'} onChange={value => setProfile({...profile, performance_mode: value as VyactModelProfile['performance_mode']})}/></div>}
                        {profile.capabilities?.cpu_threads && <label className="model-settings-option"><SettingLabel label={t('modelSettings.cpuThreads')} help={t('modelSettings.cpuThreadsTooltip')} description={t('modelSettings.cpuThreadsHelp')}/><input className="model-settings-input" type="number" min="1" max="256" value={profile.cpu_threads ?? ''} placeholder={t('modelSettings.auto')} onChange={event => updateNumber('cpu_threads', event.target.value, true)}/></label>}
                        {Boolean(profile.capabilities?.kv_cache_precisions.length) && <div className={`model-settings-option${profile.mtp_enabled || dflash2Supported ? ' is-disabled' : ''}`}><SettingLabel label={t('modelSettings.kvCachePrecision')} help={t('modelSettings.kvCachePrecisionTooltip')} description={t(profile.mtp_enabled || dflash2Supported ? 'modelSettings.cacheQuantizationMtpHelp' : 'modelSettings.kvCachePrecisionHelp')}/><CustomSelect portal disabled={Boolean(profile.mtp_enabled || dflash2Supported)} options={[{value: 'none', label: t('modelSettings.kvCachePrecisions.none')}, ...profile.capabilities!.kv_cache_precisions.map(value => ({value, label: t(`modelSettings.kvCachePrecisions.${value}`)}))]} value={profile.kv_cache_precision ?? 'none'} onChange={value => setProfile({...profile, kv_cache_precision: value as VyactModelProfile['kv_cache_precision'], cache_quantization: value !== 'none'})}/></div>}
                        {profile.capabilities?.seed && <label className="model-settings-option"><SettingLabel label={t('modelSettings.seed')} help={t('modelSettings.seedTooltip')} description={t('modelSettings.seedHelp')}/><input className="model-settings-input" type="number" min="0" max="2147483647" value={profile.seed ?? ''} placeholder={t('modelSettings.randomSeed')} onChange={event => updateNumber('seed', event.target.value, true)}/></label>}
                    </div>
                </details>
                {error && <div className="model-settings-error">{error}</div>}
            </div>}
            <footer><button className="model-settings-cancel" type="button" onClick={onClose}>{t('modelSettings.cancel')}</button><button className="primary" type="button" disabled={!profile || saving} onClick={() => void apply()}>{saving ? t('modelSettings.applying') : t('modelSettings.apply')}</button></footer>
        </div>
    </ModalOverlay>;
}
