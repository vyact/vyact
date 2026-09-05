import {formatLocalizedNumber} from '../../utils/localizedNumber';
import {useEffect, useRef, useState} from 'react';
import {HardDrive, Activity, SlidersHorizontal, ChevronDown, CircleQuestionMark, TriangleAlert, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api, VyactModelActivationError, type VyactModelProfile} from '../../services/api';
import ModalTabs from '../common/ModalTabs/ModalTabs';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import CustomSelect from '../CustomSelect/CustomSelect';
import SettingLabel from '../common/SettingLabel/SettingLabel';
import {Tooltip} from '../common/Tooltip/Tooltip';
import {getModelProfileLimits, normalizeModelContext, MODEL_SETTING_INPUT_MAX} from '../../utils/modelProfileLimits';
import {formatModelBytes} from '../../utils/vyactModelDisplay';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import ModelSettingsHelp from './ModelSettingsHelp';
import ModelBenchmarkPanel from './ModelBenchmarkPanel';
import {selectBenchmarkSettings} from '../../services/modelBenchmark';
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

const GPU_SPLIT_DECIMAL_PLACES = 2;
const GPU_SPLIT_STEP = 10 ** -GPU_SPLIT_DECIMAL_PLACES;
const GPU_SPLIT_SUM_TOLERANCE = GPU_SPLIT_STEP / 2;
const GPU_SPLIT_INPUT_PATTERN = /^\d{0,3}(?:\.\d{0,2})?$/;
const GPU_SPLIT_INPUT_MAX_LENGTH = 6;
const formatGpuSplitPercentage = (value: number) => String(Number(value.toFixed(GPU_SPLIT_DECIMAL_PLACES)));

export default function ModelSettingsModal({modelPath, runtime, repository, recommendedContext = 32768, activateOnApply = false, forceActivateOnApply = false, mtpSupported = false, dflash2Supported = false, onClose, onApplied}: Props) {
    const {t} = useTranslation('main');
    const modelHelp = <ModelSettingsHelp title={t('modelSettings.initialSettingsTitle')} description={t('modelSettings.initialSettingsEstimate')}/>;
    const [profile, setProfile] = useState<VyactModelProfile | null>(null);
    const [benchmarkOpen, setBenchmarkOpen] = useState(false);
    const [benchmarkBusy, setBenchmarkBusy] = useState(false);
    useEffect(() => {if (benchmarkBusy) setBenchmarkOpen(true);}, [benchmarkBusy]);
    const [benchmarkSelected, setBenchmarkSelected] = useState(false);
    const [numberInputs, setNumberInputs] = useState<Partial<Record<keyof VyactModelProfile, string>>>({});
    const [saving, setSaving] = useState(false);
    const interactionLocked = saving || benchmarkBusy;
    const [error, setError] = useState('');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [gpuSplitInputValues, setGpuSplitInputValues] = useState<string[]>([]);
    const initialProfileRef = useRef<VyactModelProfile | null>(null);
    const benchmarkBeforeRef = useRef<VyactModelProfile | null>(null);
    const benchmarkFieldChanged = (key: keyof VyactModelProfile) => benchmarkSelected && benchmarkBeforeRef.current?.[key] !== profile?.[key];
    const formRef = useRef<HTMLFormElement | null>(null);
    const validateBenchmark = () => {
        if (formRef.current?.checkValidity()) return true;
        setBenchmarkOpen(false);
        setAdvancedOpen(true);
        setTimeout(() => formRef.current?.reportValidity(), 0);
        return false;
    };

    const comparableProfile = (value: VyactModelProfile) => ({
        model_path: value.model_path, runtime: value.runtime, repository: value.repository ?? null,
        context_size: value.context_size, max_output_tokens: value.max_output_tokens,
        history_token_budget: value.history_token_budget, temperature: value.temperature,
        top_k: value.top_k, top_p: value.top_p, cache_quantization: value.cache_quantization,
        mtp_enabled: value.mtp_enabled ?? null, kv_cache_precision: value.kv_cache_precision ?? 'none',
        mtp_failure_code: value.mtp_failure_code ?? null,
        mtp_failure_message: value.mtp_failure_message ?? null,
        mtp_failed_at: value.mtp_failed_at ?? null,
        performance_mode: value.performance_mode ?? 'auto', cpu_threads: value.cpu_threads ?? null,
        gpu_split_percentages: value.gpu_split_percentages ?? [],
        gpu_manual_split_enabled: value.gpu_manual_split_enabled ?? false,
        seed: value.seed ?? null,
    });

    useEffect(() => {
        let cancelled = false;
        setProfile(null);
        setNumberInputs({});
        setError('');
        void api.getVyactModelProfile(modelPath, runtime, repository, recommendedContext)
            .then(value => {
                if (cancelled) return;
                const mtpEnabled = !dflash2Supported && mtpSupported && (value.mtp_enabled ?? false);
                const kvCachePrecision = value.kv_cache_precision ?? (value.cache_quantization ? 'q8' : 'none');
                const accelerationEnabled = dflash2Supported || mtpEnabled;
                const normalizedProfile = {...value, mtp_enabled: mtpEnabled, kv_cache_precision: accelerationEnabled ? 'none' as const : kvCachePrecision, cache_quantization: accelerationEnabled ? false : kvCachePrecision !== 'none'};
                initialProfileRef.current = normalizedProfile;
                setProfile(normalizedProfile);
                setGpuSplitInputValues((normalizedProfile.gpu_split_percentages ?? []).map(String));
            })
            .catch(value => {if (!cancelled) setError(String(value));});
        return () => {cancelled = true;};
    }, [modelPath, runtime, repository, recommendedContext, mtpSupported, dflash2Supported]);

    const updateNumber = (key: keyof VyactModelProfile, value: string, nullable = false) => {
        if (!profile) return;
        setNumberInputs(current => ({...current, [key]: value}));
        if (value === '') {
            if (nullable) setProfile({...profile, [key]: null});
            return;
        }
        if (Number.isFinite(Number(value))) setProfile({...profile, [key]: Number(value)});
    };
    const apply = async () => {
        if (!profile || interactionLocked || !formRef.current?.reportValidity()) return;
        if (profile.gpu_manual_split_enabled && !gpuSplitIsValid) {
            setError(t('modelSettings.gpuSplitInvalid'));
            return;
        }
        if (profile.mtp_enabled && profile.kv_cache_precision !== 'none') {
            setError(t('modelSettings.accelerationConflict'));
            return;
        }
        setSaving(true);
        setError('');
        try {
            const hasChanges = Boolean(profile.requires_apply) || initialProfileRef.current === null
                || JSON.stringify(comparableProfile(initialProfileRef.current)) !== JSON.stringify(comparableProfile(profile));
            if (!hasChanges && !forceActivateOnApply) {
                onClose();
                return;
            }
            const saved = hasChanges ? await api.saveVyactModelProfile(profile) : profile;
            if (activateOnApply) {
                const result = await api.activateVyactModel(modelPath, saved.context_size, undefined, runtime, repository, saved);
                if (result.mtpFallback) toast.warning(t('modelSettings.activationNotice'), t('modelSettings.mtpFallbackNotice'), 8000);
            }
            await onApplied();
            onClose();
        } catch (value) {
            const recovery = value instanceof VyactModelActivationError ? value.recovery : 'unknown';
            const notice = t(`modelSettings.activationRecovery.${recovery}`);
            if (recovery === 'restored') {
                toast.warning(t('modelSettings.activationNotice'), notice, 8000);
            } else {
                toast.error(t('modelSettings.activationNotice'), notice, 8000);
            }
            if (value instanceof VyactModelActivationError && value.code === 'model_insufficient_memory') {
                const modelName = modelPath.split('/').pop() || modelPath;
                setError(`${t('message.modelInsufficientMemoryTitle')}\n${t('message.modelInsufficientMemoryDescription', {model: modelName})}`);
            } else {
                setError(notice);
            }
        } finally {
            setSaving(false);
        }
    };

    const dedicatedGpus = profile?.capabilities?.hardware?.gpus.filter(gpu => !gpu.shared_memory && gpu.total_bytes > 0) ?? [];
    const detectedAllocationBackend = dedicatedGpus[0]?.backend;
    const allocationGpus = dedicatedGpus.filter(gpu => gpu.backend === detectedAllocationBackend);
    const gpuManualSplitEnabled = Boolean(profile?.gpu_manual_split_enabled);
    const gpuSplitPercentages = gpuSplitInputValues.map(value => value.trim() === '' ? Number.NaN : Number(value));
    const gpuSplitTotal = gpuSplitPercentages.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
    const gpuSplitIsValid = !gpuManualSplitEnabled || (
        gpuSplitPercentages.length === allocationGpus.length
        && gpuSplitPercentages.every(value => Number.isFinite(value) && value >= 0 && value <= 100)
        && Math.abs(gpuSplitTotal - 100) <= GPU_SPLIT_SUM_TOLERANCE
    );
    const limits = profile ? getModelProfileLimits(profile) : null;
    const memoryEstimateIsCurrent = profile && initialProfileRef.current
        && profile.context_size === initialProfileRef.current.context_size
        && profile.kv_cache_precision === initialProfileRef.current.kv_cache_precision
        && profile.mtp_enabled === initialProfileRef.current.mtp_enabled;
    const estimatedMemoryBytes = memoryEstimateIsCurrent ? profile?.estimated_memory_bytes ?? 0 : 0;
    const gpuCapacityWarnings = gpuManualSplitEnabled && estimatedMemoryBytes > 0
        ? allocationGpus.flatMap((gpu, index) => {
            const percentage = gpuSplitPercentages[index];
            const estimatedGpuBytes = Number.isFinite(percentage) ? estimatedMemoryBytes * percentage / 100 : 0;
            return gpu.total_bytes > 0 && estimatedGpuBytes > gpu.total_bytes
                ? [{gpuIndex: index + 1, estimatedGpuBytes, capacityBytes: gpu.total_bytes}]
                : [];
        })
        : [];
    const updateGpuSplitPercentage = (index: number, value: string) => {
        if (!profile) return;
        if (!GPU_SPLIT_INPUT_PATTERN.test(value)) return;
        const inputValues = [...gpuSplitInputValues];
        inputValues[index] = value;
        setGpuSplitInputValues(inputValues);
        if (value.trim() === '' || !Number.isFinite(Number(value))) return;
        const percentages = [...(profile.gpu_split_percentages ?? [])];
        percentages[index] = Number(value);
        setProfile({...profile, gpu_split_percentages: percentages});
    };
    const normalizeGpuSplitPercentage = (index: number) => {
        const value = gpuSplitInputValues[index]?.trim() ?? '';
        if (value === '' || !Number.isFinite(Number(value))) return;
        const roundedValue = Math.round(
            Math.min(Math.max(0, Number(value)), 100) / GPU_SPLIT_STEP,
        ) * GPU_SPLIT_STEP;
        const normalizedValue = Number(roundedValue.toFixed(GPU_SPLIT_DECIMAL_PLACES));
        const inputValues = [...gpuSplitInputValues];
        inputValues[index] = String(normalizedValue);
        setGpuSplitInputValues(inputValues);
        if (profile) {
            const percentages = [...(profile.gpu_split_percentages ?? [])];
            percentages[index] = normalizedValue;
            setProfile({...profile, gpu_split_percentages: percentages});
        }
    };

    return <ModalOverlay className="model-settings-overlay" onClose={interactionLocked ? undefined : onClose} closeOnBackdrop={false}>
        <form ref={formRef} className="model-settings-modal" onInvalidCapture={() => setAdvancedOpen(true)} onSubmit={event => {event.preventDefault(); void apply();}}>
            <header><div><h2>{t('modelSettings.title')}</h2><div className="model-settings-model"><Tooltip hoverOnly content={modelHelp} multiline size="medium"><button type="button" className="model-settings-model-help" aria-label={t('modelSettings.initialSettingsTitle')}><CircleQuestionMark size={14}/></button></Tooltip><span className="model-settings-model-name">{modelPath.split('/').pop()}</span>{profile?.model_file_bytes != null && profile.model_file_bytes > 0 && <Tooltip content={t('modelSettings.modelFileSizeTooltip')} multiline size="medium"><span className="model-settings-file-size"><HardDrive size={13} aria-hidden="true"/>{formatModelBytes(profile.model_file_bytes)}</span></Tooltip>}</div></div><button type="button" onClick={onClose} disabled={interactionLocked} aria-label={t('modelSettings.close')}><X size={20}/></button></header>
            {profile && <nav className="model-settings-tabs" aria-label={t('modelSettings.title')}><ModalTabs tabs={[{key: 'settings', label: <><SlidersHorizontal size={15}/>{t('modelSettings.title')}</>}, {key: 'benchmark', label: <><Activity size={15}/>{t('modelBenchmark.title')}</>}]} activeKey={benchmarkOpen ? 'benchmark' : 'settings'} disabled={interactionLocked} onChange={key => setBenchmarkOpen(key === 'benchmark')}/></nav>}
            {profile && <ModelBenchmarkPanel dflashEnabled={dflash2Supported} canTestMtp={mtpSupported && !dflash2Supported && !profile.mtp_failure_code} profile={profile} visible={benchmarkOpen} disabled={saving || !gpuSplitIsValid} validate={validateBenchmark} onBusy={setBenchmarkBusy} onSelect={value => {benchmarkBeforeRef.current = profile; setProfile(selectBenchmarkSettings(profile, value)); setNumberInputs({}); setBenchmarkSelected(true); setAdvancedOpen(true); setBenchmarkOpen(false);}}/>}
            {!profile ? <div className="model-settings-loading">{error || t('modelSettings.loading')}</div> : <div className="model-settings-body" hidden={benchmarkOpen}>
                {benchmarkSelected && <p className="model-settings-selection-notice" role="status">{t('modelBenchmark.selected')}</p>}
                <label><SettingLabel helpHoverOnly label={t('modelSettings.context')} help={<ModelSettingsHelp title={t('modelSettings.context')} description={t('modelSettings.contextTooltip')}/>}/><input className="model-settings-input" type="number" required min={limits!.contextMin} max={limits!.contextMax ?? MODEL_SETTING_INPUT_MAX.tokens} value={numberInputs.context_size ?? profile.context_size} onChange={e => updateNumber('context_size', e.target.value)} onBlur={() => {
                    if (numberInputs.context_size === '') return;
                    setProfile(current => current ? normalizeModelContext(current) : current);
                    setNumberInputs(current => ({...current, context_size: undefined}));
                }}/></label>
                <label><SettingLabel helpHoverOnly label={t('modelSettings.maxOutput')} help={<ModelSettingsHelp title={t('modelSettings.maxOutput')} description={t('modelSettings.maxOutputTooltip')}/>}/><input className="model-settings-input" type="number" required min="1" max={MODEL_SETTING_INPUT_MAX.tokens} value={numberInputs.max_output_tokens ?? profile.max_output_tokens} onChange={e => updateNumber('max_output_tokens', e.target.value)}/></label>
                <label><SettingLabel helpHoverOnly label={t('modelSettings.historyTokenBudget')} help={<ModelSettingsHelp title={t('modelSettings.historyTokenBudget')} description={t('modelSettings.historyTokenBudgetTooltip')}/>}/><input className="model-settings-input" type="number" required min="0" max={MODEL_SETTING_INPUT_MAX.tokens} value={numberInputs.history_token_budget ?? profile.history_token_budget} onChange={e => updateNumber('history_token_budget', e.target.value)}/></label>
                <label><SettingLabel helpHoverOnly label={t('modelSettings.temperature')} help={<ModelSettingsHelp title={t('modelSettings.temperature')} description={t('modelSettings.temperatureTooltip')}/>}/><input className="model-settings-input" type="number" required min="0" max={MODEL_SETTING_INPUT_MAX.temperature} step="any" value={numberInputs.temperature ?? profile.temperature} onChange={e => updateNumber('temperature', e.target.value)}/></label>
                <label><SettingLabel helpHoverOnly label={t('modelSettings.topK')} help={<ModelSettingsHelp title={t('modelSettings.topK')} description={t('modelSettings.topKTooltip')}/>}/><input className="model-settings-input" type="number" min="0" max={MODEL_SETTING_INPUT_MAX.topK} value={numberInputs.top_k ?? profile.top_k ?? ''} placeholder={t('modelSettings.modelDefault')} onChange={e => updateNumber('top_k', e.target.value, true)}/></label>
                <label><SettingLabel helpHoverOnly label={t('modelSettings.topP')} help={<ModelSettingsHelp title={t('modelSettings.topP')} description={t('modelSettings.topPTooltip')}/>}/><input className="model-settings-input" type="number" min="0" max="1" step="any" value={numberInputs.top_p ?? profile.top_p ?? ''} placeholder={t('modelSettings.modelDefault')} onChange={e => updateNumber('top_p', e.target.value, true)}/></label>
                {dflash2Supported && <div className="model-settings-toggle"><SettingLabel helpHoverOnly label="DFlash2" help={<ModelSettingsHelp title="DFlash2" description={t('modelSettings.dflash2AccelerationTooltip')}/>} description={t('modelSettings.dflash2AccelerationHelp')}/><span className="vyact-mtp-badge">{t('modelSettings.auto')}</span></div>}
                {mtpSupported && !dflash2Supported && <div className="model-settings-toggle" data-benchmark-changed={benchmarkFieldChanged('mtp_enabled')}><SettingLabel helpHoverOnly label={t('modelSettings.mtpAcceleration')} help={<ModelSettingsHelp title={t('modelSettings.mtpAcceleration')} description={t(runtime === 'mlx' ? 'modelSettings.omlxMtpAccelerationTooltip' : 'modelSettings.mtpAccelerationTooltip')}/>} description={t(runtime === 'mlx' ? 'modelSettings.omlxMtpAccelerationHelp' : 'modelSettings.mtpAccelerationHelp')}/><button type="button" className={`model-settings-switch${profile.mtp_enabled ? ' is-on' : ''}`} role="switch" aria-checked={Boolean(profile.mtp_enabled)} disabled={Boolean(profile.mtp_failure_code)} onClick={() => setProfile({...profile, mtp_enabled: !profile.mtp_enabled, kv_cache_precision: !profile.mtp_enabled ? 'none' : profile.kv_cache_precision, cache_quantization: !profile.mtp_enabled ? false : profile.cache_quantization})}><span/></button>{profile.mtp_failure_code && <div className="model-settings-mtp-failure" role="status"><span>{t(`modelSettings.mtpFailures.${profile.mtp_failure_code}`)}</span><button type="button" onClick={() => setProfile({...profile, mtp_enabled: true, mtp_failure_code: null, mtp_failure_message: null, mtp_failed_at: null, kv_cache_precision: 'none', cache_quantization: false})}>{t('modelSettings.retryMtp')}</button></div>}</div>}
                <section className={`model-settings-advanced${advancedOpen ? ' is-open' : ''}`}>
                    <button type="button" className="model-settings-advanced-trigger" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(open => !open)}><span>{t('modelSettings.advanced')}</span><ChevronDown size={16} aria-hidden="true"/></button>
                    <div className="model-settings-advanced-panel" aria-hidden={!advancedOpen}><div className="model-settings-advanced-fields">
                        {runtime === 'gguf' && allocationGpus.length >= 2 && <section className="model-settings-gpu-allocation">
                            <div className="model-settings-gpu-heading"><SettingLabel helpHoverOnly label={t('modelSettings.gpuManualSplit')} help={<ModelSettingsHelp title={t('modelSettings.gpuManualSplit')} description={t('modelSettings.gpuManualSplitTooltip')}/>} description={t(gpuManualSplitEnabled ? 'modelSettings.gpuManualSplitOnHelp' : 'modelSettings.gpuManualSplitOffHelp')}/><button type="button" className={`model-settings-switch${gpuManualSplitEnabled ? ' is-on' : ''}`} role="switch" aria-label={t('modelSettings.gpuManualSplit')} aria-checked={gpuManualSplitEnabled} onClick={() => setProfile({...profile, gpu_manual_split_enabled: !profile.gpu_manual_split_enabled})}><span/></button></div>
                            {gpuManualSplitEnabled && <><div className="model-settings-gpu-backend"><span>{t('modelSettings.gpuAllocation')}</span></div><div className="model-settings-gpu-list">{allocationGpus.map((gpu, index) => <label key={`${gpu.backend}-${gpu.index}-${gpu.name}`}>
                                <span><strong>{t('modelSettings.gpuIndex', {index: gpu.index + 1})}</strong><small title={gpu.name}>{gpu.name} · {t('modelSettings.gpuCapacity', {value: formatLocalizedNumber(gpu.total_bytes / 1024 ** 3, 1)})}</small></span>
                                <span className="model-settings-gpu-input"><input type="text" inputMode="decimal" maxLength={GPU_SPLIT_INPUT_MAX_LENGTH} value={gpuSplitInputValues[index] ?? ''} onChange={event => updateGpuSplitPercentage(index, event.target.value)} onBlur={() => normalizeGpuSplitPercentage(index)}/><b>%</b></span>
                            </label>)}</div><div className={`model-settings-gpu-total${gpuSplitIsValid ? '' : ' is-invalid'}`}>{t('modelSettings.gpuSplitTotal', {value: formatGpuSplitPercentage(gpuSplitTotal)})}</div>{gpuCapacityWarnings.map(warning => <div className="model-settings-gpu-warning" role="alert" key={warning.gpuIndex}><TriangleAlert size={15} aria-hidden="true"/><span>{t('modelSettings.gpuSplitCapacityWarning', {index: warning.gpuIndex, required: formatModelBytes(warning.estimatedGpuBytes), capacity: formatModelBytes(warning.capacityBytes)})}</span></div>)}</>}
                        </section>}
                        {Boolean(profile.capabilities?.performance_modes.length) && <div className="model-settings-option" data-benchmark-changed={benchmarkFieldChanged('performance_mode')}><SettingLabel helpHoverOnly label={t('modelSettings.performanceMode')} help={<ModelSettingsHelp title={t('modelSettings.performanceMode')} description={t('modelSettings.performanceModeTooltip')}/>} description={t('modelSettings.performanceModeHelp')}/><CustomSelect portal options={profile.capabilities!.performance_modes.map(value => ({value, label: t(`modelSettings.performanceModes.${value}`)}))} value={profile.performance_mode ?? 'auto'} onChange={value => setProfile({...profile, performance_mode: value as VyactModelProfile['performance_mode']})}/></div>}
                        {profile.capabilities?.cpu_threads && <label className="model-settings-option"><SettingLabel helpHoverOnly label={t('modelSettings.cpuThreads')} help={<ModelSettingsHelp title={t('modelSettings.cpuThreads')} description={t('modelSettings.cpuThreadsTooltip')}/>} description={t('modelSettings.cpuThreadsHelp')}/><input className="model-settings-input" type="number" min="1" max={MODEL_SETTING_INPUT_MAX.cpuThreads} value={numberInputs.cpu_threads ?? profile.cpu_threads ?? ''} placeholder={t('modelSettings.auto')} onChange={event => updateNumber('cpu_threads', event.target.value, true)}/></label>}
                        {Boolean(profile.capabilities?.kv_cache_precisions.length) && <div data-benchmark-changed={benchmarkFieldChanged('kv_cache_precision')} className={`model-settings-option${profile.mtp_enabled || dflash2Supported ? ' is-disabled' : ''}`}><SettingLabel helpHoverOnly label={t('modelSettings.kvCachePrecision')} help={<ModelSettingsHelp title={t('modelSettings.kvCachePrecision')} description={t('modelSettings.kvCachePrecisionTooltip')}/>} description={t(profile.mtp_enabled || dflash2Supported ? 'modelSettings.cacheQuantizationMtpHelp' : 'modelSettings.kvCachePrecisionHelp')}/><CustomSelect portal disabled={Boolean(profile.mtp_enabled || dflash2Supported)} options={[{value: 'none', label: t('modelSettings.kvCachePrecisions.none')}, ...profile.capabilities!.kv_cache_precisions.map(value => ({value, label: t(`modelSettings.kvCachePrecisions.${value}`)}))]} value={profile.kv_cache_precision ?? 'none'} onChange={value => setProfile({...profile, kv_cache_precision: value as VyactModelProfile['kv_cache_precision'], cache_quantization: value !== 'none'})}/></div>}
                        {profile.capabilities?.seed && <label className="model-settings-option"><SettingLabel helpHoverOnly label={t('modelSettings.seed')} help={<ModelSettingsHelp title={t('modelSettings.seed')} description={t('modelSettings.seedTooltip')}/>} description={t('modelSettings.seedHelp')}/><input className="model-settings-input" type="number" min="0" max={MODEL_SETTING_INPUT_MAX.seed} value={numberInputs.seed ?? profile.seed ?? ''} placeholder={t('modelSettings.randomSeed')} onChange={event => updateNumber('seed', event.target.value, true)}/></label>}
                    </div></div>
                </section>
                {error && <div className="model-settings-error">{error}</div>}
            </div>}
            <footer><button className="model-settings-cancel" type="button" onClick={onClose} disabled={interactionLocked}>{t('modelSettings.cancel')}</button><button className="primary" type="submit" disabled={!profile || saving || benchmarkBusy || !gpuSplitIsValid}>{saving ? t('modelSettings.applying') : t('modelSettings.apply')}</button></footer>
        </form>
    </ModalOverlay>;
}
