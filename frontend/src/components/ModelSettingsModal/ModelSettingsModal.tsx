import {useEffect, useRef, useState} from 'react';
import {ChevronDown, CircleQuestionMark, MemoryStick, TriangleAlert, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api, VyactModelActivationError, type VyactModelProfile} from '../../services/api';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import CustomSelect from '../CustomSelect/CustomSelect';
import SettingLabel from '../common/SettingLabel/SettingLabel';
import {Tooltip} from '../common/Tooltip/Tooltip';
import {formatModelBytes} from '../../utils/vyactModelDisplay';
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
    const automaticSetupTooltip = t(`modelSettings.${runtime === 'gguf' ? 'automaticSetupGgufTooltip' : 'automaticSetupMlxTooltip'}`);
    const [profile, setProfile] = useState<VyactModelProfile | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [gpuSplitInputValues, setGpuSplitInputValues] = useState<string[]>([]);
    const initialProfileRef = useRef<VyactModelProfile | null>(null);

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
        void api.getVyactModelProfile(modelPath, runtime, repository, recommendedContext)
            .then(value => {
                const mtpEnabled = !dflash2Supported && mtpSupported && (value.mtp_enabled ?? true);
                const kvCachePrecision = value.kv_cache_precision ?? (value.cache_quantization ? 'q8' : 'none');
                const accelerationEnabled = dflash2Supported || mtpEnabled;
                const normalizedProfile = {...value, mtp_enabled: mtpEnabled, kv_cache_precision: accelerationEnabled ? 'none' as const : kvCachePrecision, cache_quantization: accelerationEnabled ? false : kvCachePrecision !== 'none'};
                initialProfileRef.current = normalizedProfile;
                setProfile(normalizedProfile);
                setGpuSplitInputValues((normalizedProfile.gpu_split_percentages ?? []).map(String));
            })
            .catch(value => setError(String(value)));
    }, [modelPath, runtime, repository, recommendedContext, mtpSupported, dflash2Supported]);

    const updateNumber = (key: keyof VyactModelProfile, value: string, nullable = false) => {
        if (!profile) return;
        setProfile({...profile, [key]: nullable && value === '' ? null : Number(value)});
    };
    const apply = async () => {
        if (!profile) return;
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
            if (value instanceof VyactModelActivationError && value.code === 'model_insufficient_memory') {
                const modelName = modelPath.split('/').pop() || modelPath;
                setError(`${t('message.modelInsufficientMemoryTitle')}\n${t('message.modelInsufficientMemoryDescription', {model: modelName})}`);
            } else {
                setError(String(value));
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
    const estimatedMemoryBytes = profile?.estimated_memory_bytes ?? 0;
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

    return <ModalOverlay className="model-settings-overlay" onClose={onClose} closeOnBackdrop={false}>
        <div className="model-settings-modal">
            <header><div><h2>{t('modelSettings.title')}</h2><div className="model-settings-model"><Tooltip content={automaticSetupTooltip} multiline size="medium"><button type="button" className="model-settings-model-help" aria-label={automaticSetupTooltip}><CircleQuestionMark size={14}/></button></Tooltip><span className="model-settings-model-name">{modelPath.split('/').pop()}</span>{estimatedMemoryBytes > 0 && <Tooltip content={t('modelSettings.estimatedMemoryTooltip')} multiline size="medium"><span className="model-settings-memory-badge" aria-label={t('modelSettings.estimatedMemoryAria', {value: formatModelBytes(estimatedMemoryBytes)})}><MemoryStick size={13} aria-hidden="true"/><span>≈ {formatModelBytes(estimatedMemoryBytes)}</span></span></Tooltip>}</div></div><button type="button" onClick={onClose} aria-label={t('modelSettings.close')}><X size={20}/></button></header>
            {!profile ? <div className="model-settings-loading">{error || t('modelSettings.loading')}</div> : <div className="model-settings-body">
                <p className="model-settings-description">{t('modelSettings.description')}</p>
                <label><SettingLabel label={t('modelSettings.context')} help={t('modelSettings.contextTooltip')}/><input className="model-settings-input" type="number" min="512" value={profile.context_size} onChange={e => updateNumber('context_size', e.target.value)}/></label>
                <label><SettingLabel label={t('modelSettings.maxOutput')} help={t('modelSettings.maxOutputTooltip')}/><input className="model-settings-input" type="number" min="1" max="32768" value={profile.max_output_tokens} onChange={e => updateNumber('max_output_tokens', e.target.value)}/></label>
                <label><SettingLabel label={t('modelSettings.historyTokenBudget')} help={t('modelSettings.historyTokenBudgetTooltip')}/><input className="model-settings-input" type="number" min="0" max={profile.context_size} value={profile.history_token_budget} onChange={e => updateNumber('history_token_budget', e.target.value)}/></label>
                <label><SettingLabel label={t('modelSettings.temperature')} help={t('modelSettings.temperatureTooltip')}/><input className="model-settings-input" type="number" min="0" max="1" step="0.01" value={profile.temperature} onChange={e => updateNumber('temperature', e.target.value)}/></label>
                <label><SettingLabel label={t('modelSettings.topK')} help={t('modelSettings.topKTooltip')}/><input className="model-settings-input" type="number" min="0" max="100" value={profile.top_k ?? ''} placeholder={t('modelSettings.modelDefault')} onChange={e => updateNumber('top_k', e.target.value, true)}/></label>
                <label><SettingLabel label={t('modelSettings.topP')} help={t('modelSettings.topPTooltip')}/><input className="model-settings-input" type="number" min="0" max="1" step="0.01" value={profile.top_p ?? ''} placeholder={t('modelSettings.modelDefault')} onChange={e => updateNumber('top_p', e.target.value, true)}/></label>
                {dflash2Supported && <div className="model-settings-toggle"><SettingLabel label="DFlash2" help={t('modelSettings.dflash2AccelerationTooltip')} description={t('modelSettings.dflash2AccelerationHelp')}/><span className="vyact-mtp-badge">{t('modelSettings.auto')}</span></div>}
                {mtpSupported && !dflash2Supported && <div className="model-settings-toggle"><SettingLabel label={t('modelSettings.mtpAcceleration')} help={t(runtime === 'mlx' ? 'modelSettings.omlxMtpAccelerationTooltip' : 'modelSettings.mtpAccelerationTooltip')} description={t(runtime === 'mlx' ? 'modelSettings.omlxMtpAccelerationHelp' : 'modelSettings.mtpAccelerationHelp')}/><button type="button" className={`model-settings-switch${profile.mtp_enabled ? ' is-on' : ''}`} role="switch" aria-checked={Boolean(profile.mtp_enabled)} disabled={Boolean(profile.mtp_failure_code)} onClick={() => setProfile({...profile, mtp_enabled: !profile.mtp_enabled, kv_cache_precision: !profile.mtp_enabled ? 'none' : profile.kv_cache_precision, cache_quantization: !profile.mtp_enabled ? false : profile.cache_quantization})}><span/></button>{profile.mtp_failure_code && <div className="model-settings-mtp-failure" role="status"><span>{t(`modelSettings.mtpFailures.${profile.mtp_failure_code}`)}</span><button type="button" onClick={() => setProfile({...profile, mtp_enabled: true, mtp_failure_code: null, mtp_failure_message: null, mtp_failed_at: null, kv_cache_precision: 'none', cache_quantization: false})}>{t('modelSettings.retryMtp')}</button></div>}</div>}
                <section className={`model-settings-advanced${advancedOpen ? ' is-open' : ''}`}>
                    <button type="button" className="model-settings-advanced-trigger" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(open => !open)}><span>{t('modelSettings.advanced')}</span><ChevronDown size={16} aria-hidden="true"/></button>
                    <div className="model-settings-advanced-panel" aria-hidden={!advancedOpen}><div className="model-settings-advanced-fields">
                        {runtime === 'gguf' && allocationGpus.length >= 2 && <section className="model-settings-gpu-allocation">
                            <div className="model-settings-gpu-heading"><SettingLabel label={t('modelSettings.gpuManualSplit')} help={t('modelSettings.gpuManualSplitTooltip')} description={t(gpuManualSplitEnabled ? 'modelSettings.gpuManualSplitOnHelp' : 'modelSettings.gpuManualSplitOffHelp')}/><button type="button" className={`model-settings-switch${gpuManualSplitEnabled ? ' is-on' : ''}`} role="switch" aria-label={t('modelSettings.gpuManualSplit')} aria-checked={gpuManualSplitEnabled} onClick={() => setProfile({...profile, gpu_manual_split_enabled: !profile.gpu_manual_split_enabled})}><span/></button></div>
                            {gpuManualSplitEnabled && <><div className="model-settings-gpu-backend"><span>{t('modelSettings.gpuAllocation')}</span></div><div className="model-settings-gpu-list">{allocationGpus.map((gpu, index) => <label key={`${gpu.backend}-${gpu.index}-${gpu.name}`}>
                                <span><strong>{t('modelSettings.gpuIndex', {index: gpu.index + 1})}</strong><small title={gpu.name}>{gpu.name} · {t('modelSettings.gpuCapacity', {value: (gpu.total_bytes / 1024 ** 3).toFixed(1)})}</small></span>
                                <span className="model-settings-gpu-input"><input type="text" inputMode="decimal" maxLength={GPU_SPLIT_INPUT_MAX_LENGTH} value={gpuSplitInputValues[index] ?? ''} onChange={event => updateGpuSplitPercentage(index, event.target.value)} onBlur={() => normalizeGpuSplitPercentage(index)}/><b>%</b></span>
                            </label>)}</div><div className={`model-settings-gpu-total${gpuSplitIsValid ? '' : ' is-invalid'}`}>{t('modelSettings.gpuSplitTotal', {value: formatGpuSplitPercentage(gpuSplitTotal)})}</div>{gpuCapacityWarnings.map(warning => <div className="model-settings-gpu-warning" role="alert" key={warning.gpuIndex}><TriangleAlert size={15} aria-hidden="true"/><span>{t('modelSettings.gpuSplitCapacityWarning', {index: warning.gpuIndex, required: formatModelBytes(warning.estimatedGpuBytes), capacity: formatModelBytes(warning.capacityBytes)})}</span></div>)}</>}
                        </section>}
                        {Boolean(profile.capabilities?.performance_modes.length) && <div className="model-settings-option"><SettingLabel label={t('modelSettings.performanceMode')} help={t('modelSettings.performanceModeTooltip')} description={t('modelSettings.performanceModeHelp')}/><CustomSelect portal options={profile.capabilities!.performance_modes.map(value => ({value, label: t(`modelSettings.performanceModes.${value}`)}))} value={profile.performance_mode ?? 'auto'} onChange={value => setProfile({...profile, performance_mode: value as VyactModelProfile['performance_mode']})}/></div>}
                        {profile.capabilities?.cpu_threads && <label className="model-settings-option"><SettingLabel label={t('modelSettings.cpuThreads')} help={t('modelSettings.cpuThreadsTooltip')} description={t('modelSettings.cpuThreadsHelp')}/><input className="model-settings-input" type="number" min="1" max="256" value={profile.cpu_threads ?? ''} placeholder={t('modelSettings.auto')} onChange={event => updateNumber('cpu_threads', event.target.value, true)}/></label>}
                        {Boolean(profile.capabilities?.kv_cache_precisions.length) && <div className={`model-settings-option${profile.mtp_enabled || dflash2Supported ? ' is-disabled' : ''}`}><SettingLabel label={t('modelSettings.kvCachePrecision')} help={t('modelSettings.kvCachePrecisionTooltip')} description={t(profile.mtp_enabled || dflash2Supported ? 'modelSettings.cacheQuantizationMtpHelp' : 'modelSettings.kvCachePrecisionHelp')}/><CustomSelect portal disabled={Boolean(profile.mtp_enabled || dflash2Supported)} options={[{value: 'none', label: t('modelSettings.kvCachePrecisions.none')}, ...profile.capabilities!.kv_cache_precisions.map(value => ({value, label: t(`modelSettings.kvCachePrecisions.${value}`)}))]} value={profile.kv_cache_precision ?? 'none'} onChange={value => setProfile({...profile, kv_cache_precision: value as VyactModelProfile['kv_cache_precision'], cache_quantization: value !== 'none'})}/></div>}
                        {profile.capabilities?.seed && <label className="model-settings-option"><SettingLabel label={t('modelSettings.seed')} help={t('modelSettings.seedTooltip')} description={t('modelSettings.seedHelp')}/><input className="model-settings-input" type="number" min="0" max="2147483647" value={profile.seed ?? ''} placeholder={t('modelSettings.randomSeed')} onChange={event => updateNumber('seed', event.target.value, true)}/></label>}
                    </div></div>
                </section>
                {error && <div className="model-settings-error">{error}</div>}
            </div>}
            <footer><button className="model-settings-cancel" type="button" onClick={onClose}>{t('modelSettings.cancel')}</button><button className="primary" type="button" disabled={!profile || saving || !gpuSplitIsValid} onClick={() => void apply()}>{saving ? t('modelSettings.applying') : t('modelSettings.apply')}</button></footer>
        </div>
    </ModalOverlay>;
}
