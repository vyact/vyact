import React, { useEffect, useMemo, useRef, useState } from 'react';
import {Check, Eye, EyeOff, ExternalLink, LoaderCircle, Plus, Search} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LogEntry } from '../../types';
import { syncPendingLanguageAfterSetup } from '../../i18n';
import {syncPendingThemeAfterSetup} from '../../services/theme';
import EsModeSelector from './EsModeSelector';
import CustomSelect from '../CustomSelect/CustomSelect';
import {getCustomProtocolOptions, OPENAI_COMPATIBLE_DOCS_URL} from '../../constants/customProviders';
import {api, type VyactHardwareInfo, type VyactHubModel, VyactRuntimeInstallError} from '../../services/api';
import {Tooltip} from '../common/Tooltip/Tooltip';
import OverflowTooltipText from '../common/OverflowTooltipText/OverflowTooltipText';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import type {GgufModelMetadata} from '../../utils/ggufMetadata';
import {
    formatCompactDownloads,
    formatModelBytes,
    getModelFileKey,
    getModelMemoryTone,
    getModelQuantization,
    getSelectableModelFiles,
    resolveModelMemoryBytes,
} from '../../utils/vyactModelDisplay';
import {loadSearchModelMetadata} from '../../utils/modelMetadataLoader';
import './SetupPage.css';
import '../VyactModelModal/VyactModelModal.css';

interface SetupPageProps {
    onInstallComplete: () => void;
    notifyAppReadyOnMount?: boolean;
}

type Provider = 'vyact' | 'openai' | 'gemini' | 'claude' | 'custom';
type CustomProtocol = 'openai-compatible';
type SelectedHubModelFile = {
    repository: string;
    filename: string;
    revision: string;
    runtime: 'gguf' | 'mlx';
    modelPath: string;
    fileSize: number;
    mtpModel?: {repository: string; revision: string; size: number};
    specprefillModel?: {repository: string; revision: string; size: number};
    dflash2Model?: {repository: string; revision: string; filename?: string; size: number};
    dflash2Bundled?: boolean;
};

const DEFAULT_MODELS: Record<Exclude<Provider, 'vyact' | 'custom'>, string> = {
    openai: 'gpt-4o-mini',
    gemini: 'gemini-3.1-flash-lite-preview',
    claude: 'claude-3-5-sonnet',
};

const DEFAULT_VYACT_MODEL_QUERY = 'qwen3.5';
const EMPTY_HARDWARE_INFO: VyactHardwareInfo = {
    platform: '', apple_silicon: false, memory_mode: 'system',
    system_memory: {total_bytes: 0, available_bytes: 0},
    gpus: [],
};
const formatContextLength = (tokens: number) => tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens);

const SetupPage: React.FC<SetupPageProps> = ({ onInstallComplete, notifyAppReadyOnMount = false }) => {
    const { t } = useTranslation(['setup', 'main']);
    const [provider, setProvider] = useState<Provider>('vyact');
    const [esMode, setEsMode] = useState<'docker' | 'native'>('docker');
    // null = 확인 중(상태 조회 완료 전). 확인 전에는 선택지를 잠가 "됐다 안 됐다"처럼 보이는 것을 방지.
    const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
    const [nativeSupported, setNativeSupported] = useState<boolean | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [selectedHubModelFile, setSelectedHubModelFile] = useState<SelectedHubModelFile | null>(null);
    const [apiKey, setApiKey] = useState<string>('');
    const [huggingFaceToken, setHuggingFaceToken] = useState<string>('');
    const [huggingFaceQuery, setHuggingFaceQuery] = useState(DEFAULT_VYACT_MODEL_QUERY);
    const [huggingFaceModels, setHuggingFaceModels] = useState<VyactHubModel[]>([]);
    const [vyactHardware, setVyactHardware] = useState<VyactHardwareInfo>(EMPTY_HARDWARE_INFO);
    const [metadataByFile, setMetadataByFile] = useState<Record<string, GgufModelMetadata>>({});
    const [mtpSupportedModels, setMtpSupportedModels] = useState<string[]>([]);
    const [mlxOnly, setMlxOnly] = useState(true);
    const [isSearchingHub, setIsSearchingHub] = useState(false);
    const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
    const [connectionName, setConnectionName] = useState<string>('');
    const [baseUrl, setBaseUrl] = useState<string>('');
    const [customProtocol, setCustomProtocol] = useState<CustomProtocol>('openai-compatible');
    const [customHeaders, setCustomHeaders] = useState<Array<{id: string; name: string; value: string; isValueVisible: boolean}>>([]);

    const addCustomHeader = () => {
        setCustomHeaders(current => [
            ...current,
            {id: `setup-${Date.now()}-${current.length}`, name: '', value: '', isValueVisible: false},
        ]);
    };

    const [isInstalling, setIsInstalling] = useState(false);
    const [progress, setProgress] = useState<number | null>(0);

    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [errorLogs, setErrorLogs] = useState<string[]>([]);
    const [showRuntimeInstallHelp, setShowRuntimeInstallHelp] = useState(false);

    const logRef = useRef<HTMLDivElement>(null);
    const shouldFollowLogTailRef = useRef(true);

    const selectedFileKey = selectedHubModelFile ? `${selectedHubModelFile.repository}@${selectedHubModelFile.revision}/${selectedHubModelFile.filename}` : '';
    const selectedMetadata = selectedFileKey ? metadataByFile[selectedFileKey] : undefined;
    const selectedFileDisplayName = selectedHubModelFile?.runtime === 'mlx' ? selectedHubModelFile.repository.split('/').pop() : selectedHubModelFile?.filename;

    useEffect(() => {
        if (!notifyAppReadyOnMount) return;

        // The initial setup BrowserView must remain detached until this lazy-loaded
        // page has committed, otherwise Suspense's empty fallback is briefly shown.
        window.ragAPI?.notifyAppReady?.();
    }, [notifyAppReadyOnMount]);

    const searchVyactModels = async (query: string, searchMlxOnly = mlxOnly) => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return;
        setIsSearchingHub(true);
        setSelectedModel('');
        setSelectedHubModelFile(null);
        try {
            let response = await api.searchVyactModels(trimmedQuery, searchMlxOnly);
            // 최초에는 하드웨어 정보를 알 수 없으므로 GGUF 검색으로 확인한 뒤,
            // Apple Silicon이면 기존 Vyact 모달과 같이 MLX를 기본으로 보여준다.
            if (searchMlxOnly && response.hardware.apple_silicon && response.models.some(model => model.runtime !== 'mlx')) {
                response = await api.searchVyactModels(trimmedQuery, true);
            }
            if (!response.hardware.apple_silicon) setMlxOnly(false);
            const loadedMetadata = await loadSearchModelMetadata(
                response.models, huggingFaceToken.trim(), undefined, false,
            );
            setHuggingFaceModels(
                response.hardware.apple_silicon
                    ? response.models
                    : response.models.filter(model => model.runtime !== 'mlx'),
            );
            setMetadataByFile(loadedMetadata);
            setVyactHardware(response.hardware);
            setMtpSupportedModels(response.mtp_supported);
        } catch (error) {
            console.error('Failed to search Hugging Face models:', error);
            setHuggingFaceModels([]);
        } finally {
            setIsSearchingHub(false);
        }
    };

    const isCloud = provider !== 'vyact';

    const selectHubModelFile = (model: VyactHubModel, filename: string) => {
        const modelPath = model.runtime === 'mlx' ? `mlx/${model.id}` : `${model.id}/${filename}`;
        setSelectedModel(modelPath);
        setSelectedHubModelFile({
            repository: model.id,
            filename,
            revision: model.revision,
            runtime: model.runtime,
            modelPath,
            fileSize: model.file_sizes?.[filename] || 0,
            mtpModel: model.mtp_model, specprefillModel: model.specprefill_model,
            dflash2Model: model.dflash2_model, dflash2Bundled: model.dflash2_bundled,
        });
    };

    // 시스템 상태 조회 — Docker 설치 여부/네이티브 지원 여부에 따라 ES 방식 선택지 제어
    useEffect(() => {
        fetch('/api/setup/status')
            .then(res => res.json())
            .then(data => {
                const dockerOk = data.docker_available ?? false;
                const nativeOk = data.native_supported ?? false;
                setDockerAvailable(dockerOk);
                setNativeSupported(nativeOk);
                // 확인이 끝난 시점에 기본 선택을 확정한다.
                // Docker 사용 가능하면 docker, 아니면 네이티브(가능할 때)로.
                setEsMode(dockerOk ? 'docker' : (nativeOk ? 'native' : 'docker'));
            })
            .catch(err => {
                console.error('Failed to load setup status:', err);
                // 조회 실패 시 선택지를 잠그지 않도록 둘 다 허용으로 처리
                setDockerAvailable(true);
                setNativeSupported(true);
            });
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void searchVyactModels(DEFAULT_VYACT_MODEL_QUERY);
        // 최초 설치 화면에서는 Qwen 3.5 후보를 한 번만 자동 조회한다.
    }, []);

    // 사용자가 이전 로그를 읽는 동안에는 자동 스크롤을 멈춘다.
    useEffect(() => {
        if (logRef.current && shouldFollowLogTailRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logs]);

    const handleLogScroll = () => {
        const element = logRef.current;
        if (!element) return;
        shouldFollowLogTailRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
    };

    useEffect(() => {
        if (provider === 'vyact') {
            setSelectedModel('');
            setSelectedHubModelFile(null);
            setApiKey('');
        } else if (provider === 'custom') {
            setSelectedModel('');
            setSelectedHubModelFile(null);
            setApiKey('');
            setConnectionName('');
            setBaseUrl('');
            setCustomHeaders([]);
        } else {
            setSelectedModel(DEFAULT_MODELS[provider]);
        }
    }, [provider]);

    const addLog = (type: LogEntry['type'], message: string, displayErrorMessage = message) => {
        if (type === 'log') {
            // 진행률 로그는 마지막 줄 덮어쓰기
            setLogs(prev => {
                const newLogs = [...prev];
                if (newLogs.length > 0 && newLogs[newLogs.length - 1].type === 'log') {
                    // 마지막이 log면 덮어쓰기
                    newLogs[newLogs.length - 1] = { type, message };
                } else {
                    // 새로 추가
                    newLogs.push({ type, message });
                }
                return newLogs;
            });
        } else {
            // 다른 타입은 새 줄 추가
            setLogs(prev => [...prev, { type, message }]);
        }

        if (type === 'error') {
            setErrorLogs(prev => [...prev, displayErrorMessage]);
        }
    };

    const isInstallDisabled = useMemo(() => {
        if (provider === 'custom') return !connectionName.trim() || !baseUrl.trim() || !selectedModel.trim()
            || customHeaders.some(header => !header.name.trim() || !header.value.trim());
        if (isCloud) return !apiKey.trim() || !selectedModel.trim();
        return !selectedModel.trim();
    }, [provider, isCloud, apiKey, selectedModel, connectionName, baseUrl, customHeaders]);

    const changeProvider = (next: Provider) => {
        setProvider(next);
        setLogs([]);
        setProgress(0);
        setIsInstalling(false);
    };

    const handleInstall = async () => {
        if (isCloud && isInstallDisabled) {
            addLog('error', provider === 'custom' ? t('customConnection.required') : t('apiKeyModelRequired'));
            return;
        }
        setIsInstalling(true);
        setProgress(0);
        setLogs([]);
        setErrorLogs([]); // 🔥 설치 시작 시 초기화

        const payload =
            provider === 'vyact'
                    ? {
                        type: 'vyact',
                        model: selectedModel,
                        config: {
                            es_mode: esMode,
                            model_path: selectedModel,
                            runtime: selectedModel.startsWith('mlx/') ? 'mlx' : 'gguf',
                            repository: selectedModel.startsWith('mlx/') ? selectedModel.slice(4) : selectedModel.split('/').slice(0, 2).join('/'),
                            huggingface_token: huggingFaceToken.trim(),
                        },
                    }
                : provider === 'custom'
                    ? {
                        type: 'custom',
                        model: selectedModel,
                        api_key: apiKey,
                        config: {es_mode: esMode, name: connectionName, protocol: customProtocol, base_url: baseUrl, headers: customHeaders.map(({name, value}) => ({name, value}))},
                    }
                    : {
                    type: provider,
                    model: selectedModel,
                    api_key: apiKey,
                    config: { es_mode: esMode },
                };

        try {
            if (provider === 'vyact') {
                setProgress(null);
                try {
                    if (selectedHubModelFile?.runtime === 'gguf') {
                        addLog('info', t('main:modelDownload.preparingRuntime'));
                        await api.installVyactRuntime(message => addLog('log', message));
                    } else if (selectedHubModelFile?.runtime === 'mlx') {
                        addLog('info', t('main:modelDownload.preparingOmlx'));
                        await api.installVyactRuntime(message => addLog('log', message), true);
                    }
                } catch (error) {
                    if (error instanceof VyactRuntimeInstallError && error.code === 'runtime_package_manager_missing') {
                        setShowRuntimeInstallHelp(true);
                        setIsInstalling(false);
                        return;
                    }
                    throw error;
                }
            }
            if (provider === 'vyact' && selectedHubModelFile) {
                setProgress(0);
                addLog('info', t('main:modelDownload.downloading'));
                await api.streamVyactModelDownload(
                    selectedHubModelFile.repository,
                    selectedHubModelFile.filename,
                    (message, downloadProgress) => {
                        addLog('log', message);
                        if (downloadProgress != null) setProgress(downloadProgress);
                    },
                    selectedHubModelFile.revision,
                    selectedHubModelFile.runtime,
                    huggingFaceToken,
                    selectedHubModelFile.fileSize,
                    selectedHubModelFile.mtpModel,
                    selectedHubModelFile.specprefillModel,
                    selectedHubModelFile.dflash2Model,
                    selectedHubModelFile.dflash2Bundled,
                );
            }

            const response = await fetch('/api/setup/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) throw new Error(`Installation request failed (${response.status})`);
            if (!response.body) throw new Error(t('main:networkError.streamFailed'));

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let hasError = false;
            let pendingChunk = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                pendingChunk += decoder.decode(value, {stream: true});
                const lines = pendingChunk.split('\n');
                pendingChunk = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;

                    const raw = line.replace('data: ', '').trim();
                    if (!raw) continue;

                    const parsed = JSON.parse(raw);

                    if (parsed.progress !== undefined) {
                        setProgress(parsed.progress);
                    }

                    if (parsed.message) {
                        const type = parsed.type;
                        const localizedMessage = parsed.i18nKey
                            ? t(parsed.i18nKey, parsed.i18nParams ?? {})
                            : parsed.message;

                        if (type === 'runtime_package_manager_missing') {
                            setShowRuntimeInstallHelp(true);
                            await reader.cancel();
                            setIsInstalling(false);
                            return;
                        }

                        if (type === 'error') {
                            hasError = true;
                            const alertMessage = parsed.i18nKey
                                ? localizedMessage
                                : t('installationFailed');
                            addLog('error', localizedMessage, alertMessage);
                            alert(alertMessage);
                            await reader.cancel();
                            setIsInstalling(false);
                            return;
                        }

                        if (type === 'done') {
                            addLog('ok', parsed.message);

                            if (!hasError) {
                                // setup 라우터가 ES 초기화와 .setup_done 생성을 끝낸 뒤에
                                // 전송하는 이벤트다. 이 시점에 초기 언어를 바로 저장한다.
                                await syncPendingLanguageAfterSetup();
                                await syncPendingThemeAfterSetup();
                                onInstallComplete();
                            }

                            setIsInstalling(false);
                            return;
                        }

                        const logType: LogEntry['type'] = (
                            type === 'info' || type === 'ok' || type === 'log' || type === 'error'
                        ) ? type : 'log';
                        addLog(logType, parsed.message);
                    }
                }
            }

            if (!hasError) {
                throw new Error(t('installationFailed'));
            }
            setIsInstalling(false);

        } catch (err) {
            addLog('error', String(err), t('installationFailed'));
            setIsInstalling(false);
        }
    };

    return (
        <div className="setup-page">
            <div className={`setup-card${provider === 'vyact' && !isInstalling ? ' vyact-setup' : ''}${isInstalling ? ' installing' : ''}`}>
                <header className="setup-header">
                    <div className="setup-brand-mark" aria-hidden="true">
                        <span>V</span>
                    </div>
                    <div className="setup-wordmark">VYACT</div>
                </header>

                {/* 🔥 GLOBAL ERROR (항상 표시) */}
                {errorLogs.length > 0 && (
                    <div className="global-error-box">
                        {errorLogs.map((e, i) => (
                            <div key={i} className="global-error">
                                ⚠ {e}
                            </div>
                        ))}
                    </div>
                )}

                <div className="sec-label">{t('provider')}</div>

                <div className="provider-grid">
                    {(['vyact', 'openai', 'gemini', 'claude', 'custom'] as const).map(id => ({
                        id,
                        name: id === 'vyact' ? 'Vyact' : t(`providers.${id}.name`),
                        desc: id === 'vyact' ? t('localExec') : t(`providers.${id}.desc`),
                    })).map(p => (
                        <div
                            key={p.id}
                            className={`provider-item ${provider === p.id ? 'selected' : ''} ${isInstalling && provider !== p.id ? 'disabled' : ''}`}
                            onClick={() => !isInstalling && changeProvider(p.id as Provider)}
                            aria-disabled={isInstalling}
                        >
                            <div className="provider-name">{p.name}</div>
                            <div className="provider-desc">{p.desc}</div>
                        </div>
                    ))}
                </div>

                {!isInstalling && (
                    <>
                        {provider === 'vyact' && (
                            <section className="setup-connection-panel setup-vyact-panel">
                                <div className="setup-vyact-controls">
                                <label className="setup-field"><span><Tooltip content={t('main:modelSelector.huggingFaceTokenHelp')} multiline size="medium"><i className="vyact-token-help" tabIndex={0}>?</i></Tooltip>{t('apiKey')} <small>{t('customConnection.optional')}</small></span><div className="setup-secret-field"><input className="input" type={isApiKeyVisible ? 'text' : 'password'} placeholder={t('apiKey')} value={huggingFaceToken} onChange={event => setHuggingFaceToken(event.target.value)} onBlur={() => huggingFaceToken.trim() && api.saveVyactHuggingFaceToken(huggingFaceToken.trim()).catch(error => console.error('Failed to save Hugging Face token:', error))}/><button type="button" onClick={() => setIsApiKeyVisible(current => !current)} aria-label={t(isApiKeyVisible ? 'main:customProvider.hideApiKey' : 'main:customProvider.showApiKey')}>{isApiKeyVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
                                <div className="setup-field"><span className="vyact-search-label"><span><Search size={14}/>{t('main:modelSelector.searchLabel')}</span>{vyactHardware.apple_silicon && <button type="button" className={`vyact-mlx-switch${mlxOnly ? ' is-on' : ''}`} role="switch" aria-checked={mlxOnly} disabled={isSearchingHub} onClick={() => setMlxOnly(current => !current)}><span aria-hidden="true"><i/></span>{t('main:modelSelector.mlxOnly')}</button>}</span><div className="setup-hub-search"><input className="input" value={huggingFaceQuery} onChange={event => setHuggingFaceQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void searchVyactModels(huggingFaceQuery)} placeholder={t('common:search')} aria-label={t('main:modelSelector.modelSearch')}/><button type="button" disabled={isSearchingHub || !huggingFaceQuery.trim()} onClick={() => void searchVyactModels(huggingFaceQuery)}>{isSearchingHub ? <LoaderCircle className="vyact-model-spinner" size={16}/> : <Search size={16}/>}<span>{t('main:modelSelector.searchAction')}</span></button></div></div>
                                </div>
                                <div className="setup-hub-browser">
                                    {!isSearchingHub && vyactHardware.system_memory.total_bytes > 0 && (
                                        <div className="vyact-memory-summary setup-memory-summary">
                                            <div className="vyact-memory-capacity">
                                                <span className="vyact-system-memory">
                                                    <small>{t(`main:modelSelector.${vyactHardware.memory_mode === 'unified' ? 'unifiedMemory' : 'systemMemory'}`)}</small>
                                                    <strong>{formatModelBytes(vyactHardware.system_memory.total_bytes)}</strong>
                                                </span>
                                                {vyactHardware.memory_mode !== 'unified' && vyactHardware.gpus.map(gpu => (
                                                    <span className="vyact-gpu-memory" key={`${gpu.backend}-${gpu.index}-${gpu.name}`}>
                                                        <small>{t('main:modelSettings.gpuIndex', {index: gpu.index + 1})} · {gpu.backend}</small>
                                                        <span title={gpu.name}>{gpu.name}</span>
                                                        {gpu.total_bytes
                                                            ? <strong className="vyact-gpu-vram"><small>{t('main:modelSelector.vram')}</small>{formatModelBytes(gpu.total_bytes)}</strong>
                                                            : <em>{t('main:modelSelector.sharedOrUnknownMemory')}</em>
                                                        }
                                                    </span>
                                                ))}
                                                {vyactHardware.memory_mode !== 'unified' && vyactHardware.gpus.length === 0 && <span>{t('main:modelSelector.cpuExecution')}</span>}
                                            </div>
                                            {selectedHubModelFile && <div className="vyact-memory-selection"><OverflowTooltipText text={selectedFileDisplayName || ''}/></div>}
                                            {selectedMetadata && <div className="vyact-model-metadata vyact-memory-details">
                                                <span><small><Tooltip content={t('main:modelSelector.layersHelp')} multiline size="medium"><i className="vyact-memory-help" tabIndex={0}>?</i></Tooltip>{t('main:modelSelector.layers')}</small><strong>{selectedMetadata.blockCount}</strong></span>
                                                <span><small>{t('main:modelSelector.maxContext')}</small><strong>{formatContextLength(selectedMetadata.contextLength)}</strong></span>
                                                <span><small>{t('main:modelSelector.modelMemory')}</small><strong>{formatModelBytes(Math.max(0, selectedMetadata.estimatedMemoryBytes - selectedMetadata.kvCacheBytes))}</strong></span>
                                                <span><small><Tooltip content={t('main:modelSelector.conversationMemoryHelp')} multiline size="medium"><i className="vyact-memory-help" tabIndex={0}>?</i></Tooltip>{t('main:modelSelector.conversationMemory')}</small><strong>{formatModelBytes(selectedMetadata.kvCacheBytes)}</strong></span>
                                                <span className="vyact-total-memory"><small>{t('main:modelSelector.totalEstimatedMemory')}</small><strong>{formatModelBytes(selectedMetadata.estimatedMemoryBytes)}</strong></span>
                                            </div>}
                                        </div>
                                    )}
                                    <div className="setup-hub-results" aria-busy={isSearchingHub}>
                                    {isSearchingHub && <div className="vyact-model-empty"><LoaderCircle className="vyact-model-spinner" size={22}/><span>{t('main:modelSelector.searching')}</span></div>}
                                    {!isSearchingHub && huggingFaceModels.map(model => {
                                        const selectableFiles = getSelectableModelFiles(model.files);
                                        const onlyFile = selectableFiles.length === 1 ? selectableFiles[0] : null;
                                        const onlyModelPath = onlyFile ? (model.runtime === 'mlx' ? `mlx/${model.id}` : `${model.id}/${onlyFile}`) : '';
                                        return <article
                                            className={`vyact-model-card${selectedModel === onlyModelPath ? ' is-selected' : ''}${onlyFile ? ' is-clickable' : ''}`}
                                            key={`${model.runtime}-${model.id}`}
                                            onClick={() => onlyFile && selectHubModelFile(model, onlyFile)}
                                        >
                                            <div className="vyact-model-card-heading"><OverflowTooltipText text={model.id}/><span>{formatCompactDownloads(model.downloads)}</span></div>
                                            <div className="vyact-model-files">{selectableFiles.map(file => {
                                                const modelPath = model.runtime === 'mlx' ? `mlx/${model.id}` : `${model.id}/${file}`;
                                                const fileSize = model.file_sizes?.[file] || 0;
                                                const estimatedMemory = resolveModelMemoryBytes(
                                                    model,
                                                    file,
                                                    metadataByFile[getModelFileKey(model, file)]?.estimatedMemoryBytes,
                                                );
                                                const supportsMtp = model.mtp_supported_files?.includes(file) || mtpSupportedModels.includes(`${model.id}/${file}`);
                                                const supportsDFlash2 = model.dflash2_supported_files?.includes(file);
                                                const displayName = model.runtime === 'mlx' ? model.id.split('/').pop() : file;
                                                const quantization = getModelQuantization(model, file);
                                                return <button className={`${selectedModel === modelPath ? 'is-selected ' : ''}memory-${getModelMemoryTone(estimatedMemory, vyactHardware)}`} key={file} type="button" onClick={event => { event.stopPropagation(); selectHubModelFile(model, file); }}><span className="vyact-model-file-name">{model.runtime === 'mlx' && <span className="vyact-mtp-badge">{t('main:modelSelector.mlxOnly')}</span>}{supportsMtp && <span className="vyact-mtp-badge">MTP</span>}{supportsDFlash2 && <span className="vyact-mtp-badge">DFlash2</span>}<span>{displayName}</span></span>{estimatedMemory > 0 && <small className="vyact-model-file-meta">{fileSize > 0 && <>{formatModelBytes(fileSize)} · </>}{t('main:modelSelector.estimatedMemory')} ≈ {formatModelBytes(estimatedMemory)}{quantization && <span className="vyact-mtp-badge">{quantization}</span>}</small>}<span className="vyact-model-file-status">{selectedModel === modelPath && <Check size={15}/>}</span></button>;
                                            })}</div>
                                        </article>;
                                    })}
                                    </div>
                                </div>
                            </section>
                        )}

                        {isCloud && <section className={`setup-connection-panel${provider === 'custom' ? ' setup-custom-connection-panel' : ''}`}>
                            <div className="setup-connection-heading">
                                <div><strong>{provider === 'custom' ? t('customConnection.title') : t('cloudConnection.title')}</strong></div>
                                {provider !== 'custom' && <span className="setup-protocol-badge">{t(`providers.${provider}.name`)}</span>}
                            </div>
                            {provider === 'custom' && <div className="setup-field-row">
                                <label className="setup-field"><span>{t('customConnection.name')}</span><input className="input" placeholder={t('customConnection.namePlaceholder')} value={connectionName} onChange={e => setConnectionName(e.target.value)}/></label>
                                <label className="setup-field"><span>{t('main:customProvider.protocol')}</span><CustomSelect className="setup-protocol-select" options={getCustomProtocolOptions(t)} value={customProtocol} onChange={value => setCustomProtocol(value as CustomProtocol)} ariaLabel={t('main:customProvider.protocol')}/></label>
                            </div>}
                            {provider === 'custom' && <div className="setup-protocol-help"><span>{t('main:customProvider.hint')}</span><a href={OPENAI_COMPATIBLE_DOCS_URL} target="_blank" rel="noreferrer">{t('main:customProvider.protocolDocs')}<ExternalLink size={13}/></a></div>}
                            {provider === 'custom' && <label className="setup-field"><span>{t('customConnection.baseUrl')}</span><input className="input" placeholder="http://localhost:8000/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}/></label>}
                            <div className={provider === 'custom' ? 'setup-field-row' : 'setup-cloud-fields'}>
                                <label className="setup-field"><span>{t('apiKey')}{provider === 'custom' && <small>{t('customConnection.optional')}</small>}</span><div className="setup-secret-field"><input className="input" type={isApiKeyVisible ? 'text' : 'password'} placeholder={t('apiKey')} value={apiKey} onChange={e => setApiKey(e.target.value)}/><button type="button" onClick={() => setIsApiKeyVisible(current => !current)} aria-label={t(isApiKeyVisible ? 'main:customProvider.hideApiKey' : 'main:customProvider.showApiKey')}>{isApiKeyVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
                                <label className="setup-field"><span>{t('modelId')}</span><input className="input" placeholder={t('modelIdPlaceholder')} value={selectedModel} onChange={e => setSelectedModel(e.target.value)}/></label>
                            </div>
                            {provider === 'custom' && <div className="setup-custom-headers">
                                <div className="setup-custom-headers-heading"><span>{t('main:customProvider.headers')}</span><button type="button" onClick={addCustomHeader}>+ {t('main:customProvider.addHeader')}</button></div>
                                {customHeaders.length === 0 ? <button type="button" className="setup-custom-headers-empty" onClick={addCustomHeader}><Plus size={18}/><span>{t('main:customProvider.noHeaders')}</span></button> : customHeaders.map(header => <div className="setup-custom-header-row" key={header.id}>
                                    <input className="input" value={header.name} onChange={event => setCustomHeaders(current => current.map(item => item.id === header.id ? {...item, name: event.target.value} : item))} placeholder="X-API-Key"/>
                                    <div className="setup-secret-field"><input className="input" type={header.isValueVisible ? 'text' : 'password'} value={header.value} onChange={event => setCustomHeaders(current => current.map(item => item.id === header.id ? {...item, value: event.target.value} : item))} placeholder={t('main:customProvider.headerValuePlaceholder')}/><button type="button" onClick={() => setCustomHeaders(current => current.map(item => item.id === header.id ? {...item, isValueVisible: !item.isValueVisible} : item))} aria-label={t(header.isValueVisible ? 'main:customProvider.hideHeaderValue' : 'main:customProvider.showHeaderValue')}>{header.isValueVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
                                    <button type="button" onClick={() => setCustomHeaders(current => current.filter(item => item.id !== header.id))} aria-label={t('main:customProvider.removeHeader')}>×</button>
                                </div>)}
                            </div>}
                        </section>}

                        {/* ES 설치 방식은 프로바이더와 무관하게 항상 표시 (RAG에 ES 필요) */}
                        <EsModeSelector
                            esMode={esMode}
                            onChange={setEsMode}
                            dockerAvailable={dockerAvailable}
                            nativeSupported={nativeSupported}
                        />

                        <button
                            className="btn-install"
                            onClick={handleInstall}
                            disabled={isInstallDisabled || (dockerAvailable === null && nativeSupported === null)}
                        >
                            {t('startInstall')}
                        </button>
                    </>
                )}

                {isInstalling && (
                    <div className="progress-wrap active">
                        <div className="pbar-row">
                            <div className="pbar-bg">
                                <div
                                    className={`pbar-fill${progress == null ? ' is-indeterminate' : ''}`}
                                    style={progress == null ? undefined : {width: `${progress}%`}}
                                />
                            </div>
                            <span className="pbar-percent">
                                {progress == null
                                    ? <LoaderCircle className="pbar-spinner" size={16} aria-label={t('installing')}/>
                                    : `${Math.round(progress)}%`}
                            </span>
                        </div>

                        <div className="progress-log" ref={logRef} onScroll={handleLogScroll}>
                            {logs.map((log, i) => (
                                <div key={i} className={`log-${log.type}`}>
                                    {log.message}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
            {showRuntimeInstallHelp && <ConfirmModal
                title={t('main:modelDownload.runtimeInstallRequiredTitle')}
                description={t('main:modelDownload.runtimeInstallRequiredDescription')}
                details={[
                    t(vyactHardware.platform === 'windows'
                        ? 'main:modelDownload.runtimeInstallWindows'
                        : 'main:modelDownload.runtimeInstallBrew'),
                    t('main:modelDownload.runtimeInstallRetryHelp'),
                ]}
                options={[
                    {label: t('main:modelDownload.runtimeInstallGuide'), value: 'guide'},
                    {label: t('main:modelDownload.runtimeInstallRetry'), value: 'retry', variant: 'primary'},
                    {label: t('main:modelDownload.runtimeInstallClose'), value: 'close'},
                ]}
                onClose={() => setShowRuntimeInstallHelp(false)}
                onSelect={value => {
                    if (value === 'guide') {
                        window.open(
                            vyactHardware.platform === 'windows'
                                ? 'https://learn.microsoft.com/windows/package-manager/winget/'
                                : 'https://brew.sh/',
                            '_blank',
                            'noopener,noreferrer',
                        );
                        return;
                    }
                    setShowRuntimeInstallHelp(false);
                    if (value === 'retry') void handleInstall();
                }}
            />}
        </div>
    );
};

export default SetupPage;
