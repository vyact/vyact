import {useCallback, useEffect, useRef, useState} from 'react';
import {Calculator, Check, Eye, EyeOff, KeyRound, LoaderCircle, Search, Sparkles} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api, type VyactHardwareInfo, type VyactHubModel, VyactRuntimeInstallError} from '../../services/api';
import {inspectRemoteGguf, type GgufModelMetadata} from '../../utils/ggufMetadata';
import {
    formatCompactDownloads,
    formatModelBytes,
    estimateModelMemoryBytes,
    getModelMemoryTone,
    getModelQuantization,
    getOptimizedModelContext,
    getSelectableModelFiles,
} from '../../utils/vyactModelDisplay';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModelSettingsModal from '../ModelSettingsModal/ModelSettingsModal';
import OverflowTooltipText from '../common/OverflowTooltipText/OverflowTooltipText';
import {Tooltip} from '../common/Tooltip/Tooltip';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import '../ProviderSettingsModal/ProviderSettingsModal.css';
import './VyactModelModal.css';

interface VyactModelModalProps {
    onClose: () => void;
    onSelected: () => Promise<void>;
}

interface SelectedModelFile {
    repository: string;
    filename: string;
    revision: string;
    fileSize: number;
    runtime: 'gguf' | 'mlx';
    mtpModel?: {repository: string; revision: string; size: number};
    dflash2Model?: {repository: string; revision: string; filename?: string; size: number};
    dflash2Bundled?: boolean;
}

type DownloadPhase = 'runtime' | 'model' | 'mtp' | 'activation' | null;

const EMPTY_HARDWARE_INFO: VyactHardwareInfo = {
    platform: '', apple_silicon: false, memory_mode: 'system',
    system_memory: {total_bytes: 0, available_bytes: 0},
    gpus: [],
};

const formatBytes = formatModelBytes;

const formatContextLength = (tokens: number) => tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens);

const buildInstalledModelCards = (
    installed: string[], mtpSupported: string[], dflash2Supported: string[],
): VyactHubModel[] => {
    const models = new Map<string, VyactHubModel>();
    installed.forEach(modelPath => {
        const runtime = modelPath.startsWith('mlx/') ? 'mlx' : 'gguf';
        const relativePath = runtime === 'mlx' ? modelPath.slice(4) : modelPath;
        const pathParts = relativePath.split('/');
        if (pathParts.length < 2) return;
        const repository = pathParts.slice(0, 2).join('/');
        const filename = runtime === 'mlx' ? pathParts[1] : pathParts.slice(2).join('/');
        if (!filename) return;
        const modelKey = `${runtime}:${repository}`;
        const model = models.get(modelKey) || {
            id: repository, runtime, revision: 'main', downloads: 0, files: [], file_sizes: {},
            mtp_supported_files: [], dflash2_supported_files: [],
        };
        model.files.push(filename);
        if (mtpSupported.includes(modelPath)) model.mtp_supported_files.push(filename);
        if (dflash2Supported.includes(modelPath)) model.dflash2_supported_files.push(filename);
        models.set(modelKey, model);
    });
    return [...models.values()];
};

export default function VyactModelModal({onClose, onSelected}: VyactModelModalProps) {
    const {t} = useTranslation('main');
    const [token, setToken] = useState('');
    const [tokenConfigured, setTokenConfigured] = useState(false);
    const [showToken, setShowToken] = useState(false);
    const [query, setQuery] = useState('');
    const [mlxOnly, setMlxOnly] = useState(() => navigator.platform.toUpperCase().includes('MAC'));
    const [models, setModels] = useState<VyactHubModel[]>([]);
    const [installedModels, setInstalledModels] = useState<string[]>(() => api.getCachedVyactInstalledModels());
    const [mtpSupportedModels, setMtpSupportedModels] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<SelectedModelFile | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isSavingToken, setIsSavingToken] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [message, setMessage] = useState('');
    const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>(null);
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [hardware, setHardware] = useState<VyactHardwareInfo>(EMPTY_HARDWARE_INFO);
    const [metadataByFile, setMetadataByFile] = useState<Record<string, GgufModelMetadata>>({});
    const [analyzingFile, setAnalyzingFile] = useState('');
    const [downloadedSettings, setDownloadedSettings] = useState<{modelPath: string; runtime: 'gguf' | 'mlx'; repository: string; context: number} | null>(null);
    const [showRuntimeInstallHelp, setShowRuntimeInstallHelp] = useState(false);
    const searchRequestIdRef = useRef(0);
    const cacheCheckedFilesRef = useRef(new Set<string>());
    const busy = isSearching || isDownloading || isSavingToken;
    const selectedFileKey = selectedFile
        ? `${selectedFile.repository}@${selectedFile.revision}/${selectedFile.filename}`
        : '';
    const selectedMetadata = selectedFileKey ? metadataByFile[selectedFileKey] : undefined;
    const selectedModelPath = selectedFile
        ? selectedFile.runtime === 'mlx' ? `mlx/${selectedFile.repository}` : `${selectedFile.repository}/${selectedFile.filename}`
        : '';
    const selectedFileDisplayName = selectedFile?.runtime === 'mlx'
        ? selectedFile.repository.split('/').pop()
        : selectedFile?.filename;
    const selectedModelIsInstalled = Boolean(selectedModelPath && installedModels.includes(selectedModelPath));
    const selectedModelWeightBytes = selectedFile
        ? selectedFile.fileSize + (selectedFile.dflash2Model?.size || selectedFile.mtpModel?.size || 0)
        : 0;
    const mlxAvailable = navigator.platform.toUpperCase().includes('MAC')
        || hardware.apple_silicon
        || installedModels.some(model => model.startsWith('mlx/'));

    const searchModels = useCallback(async (searchQuery: string, searchMlxOnly = mlxOnly) => {
        const requestId = ++searchRequestIdRef.current;
        setHasSearched(true);
        setIsSearching(true);
        setModels([]);
        setSelectedFile(null);
        setMessage('');
        try {
            const searchResponse = await api.searchVyactModels(searchQuery, searchMlxOnly);
            if (requestId === searchRequestIdRef.current) {
                setModels(searchResponse.models);
                setHardware(searchResponse.hardware);
                setInstalledModels(searchResponse.installed);
                setMtpSupportedModels(searchResponse.mtp_supported);
            }
        } catch (error) {
            if (requestId === searchRequestIdRef.current) setMessage(String(error));
        } finally {
            if (requestId === searchRequestIdRef.current) setIsSearching(false);
        }
    }, [mlxOnly]);

    useEffect(() => {
        void api.getModels()
            .then(response => {
                const installed = response.installed || [];
                const mtpSupported = response.mtp_supported || [];
                const dflash2Supported = response.dflash2_supported || [];
                setInstalledModels(installed);
                setMtpSupportedModels(mtpSupported);
                setModels(buildInstalledModelCards(installed, mtpSupported, dflash2Supported));
            })
            .catch(error => setMessage(String(error)));
        void api.getVyactHuggingFaceTokenStatus()
            .then(status => setTokenConfigured(status.configured))
            .catch(error => console.error('Failed to load Hugging Face token status:', error));
    }, []);

    const saveToken = async () => {
        const trimmedToken = token.trim();
        if (!trimmedToken) return;
        setIsSavingToken(true);
        try {
            await api.saveVyactHuggingFaceToken(trimmedToken);
            setToken('');
            setTokenConfigured(true);
        } catch (error) {
            if (error instanceof VyactRuntimeInstallError && error.code === 'runtime_package_manager_missing') {
                setMessage('');
                setShowRuntimeInstallHelp(true);
            } else {
                setMessage(String(error));
            }
        } finally {
            setIsSavingToken(false);
        }
    };

    const downloadSelectedModel = async () => {
        if (!selectedFile) return;
        setIsDownloading(true);
        setDownloadPhase('runtime');
        setDownloadProgress(null);
        const runtimeMessageKey = selectedFile.runtime === 'mlx' ? 'modelDownload.preparingOmlx' : 'modelDownload.preparingRuntime';
        setMessage(t(runtimeMessageKey));
        try {
            if (selectedFile.runtime === 'gguf') {
                await api.installVyactRuntime(() => setMessage(t(runtimeMessageKey)));
            } else if (selectedFile.dflash2Model || selectedFile.dflash2Bundled) {
                await api.installVyactRuntime(() => setMessage(t(runtimeMessageKey)), true);
            }
            setDownloadPhase(selectedModelIsInstalled ? 'mtp' : 'model');
            setDownloadProgress(0);
            setMessage(t(selectedModelIsInstalled ? 'modelDownload.preparingMtp' : 'modelDownload.downloading'));
            await api.streamVyactModelDownload(
                selectedFile.repository,
                selectedFile.filename,
                (_downloadMessage, progress) => {
                    const messageKey = progress != null && progress >= 99
                        ? 'modelDownload.finalizing'
                        : selectedModelIsInstalled
                            ? 'modelDownload.preparingMtp'
                            : 'modelDownload.downloading';
                    setMessage(t(messageKey));
                    if (progress != null) setDownloadProgress(progress);
                },
                selectedFile.revision,
                selectedFile.runtime,
                token.trim(),
                selectedFile.fileSize,
                selectedFile.mtpModel,
                selectedFile.dflash2Model,
                selectedFile.dflash2Bundled,
            );
            setInstalledModels(api.getCachedVyactInstalledModels());
            let optimizedMetadata = selectedMetadata;
            if (!optimizedMetadata) {
                try {
                    optimizedMetadata = selectedFile.runtime === 'mlx'
                        ? await api.inspectVyactMlxMetadata(selectedFile.repository, selectedFile.revision, selectedModelWeightBytes, 32768)
                        : await inspectRemoteGguf(selectedFile.repository, selectedFile.filename, selectedFile.revision, selectedFile.fileSize, 32768, token.trim());
                } catch (error) {
                    console.warn('Model metadata inspection failed; using the safe context default:', error);
                }
            }
            const optimizedContextSize = getOptimizedModelContext(
                optimizedMetadata,
                selectedModelWeightBytes,
                hardware,
            );
            if (!selectedModelIsInstalled) {
                const defaultProfile = await api.getVyactModelProfile(
                    selectedModelPath,
                    selectedFile.runtime,
                    selectedFile.repository,
                    optimizedContextSize,
                );
                await api.saveVyactModelProfile(defaultProfile);
            }
            setDownloadedSettings({modelPath: selectedModelPath, runtime: selectedFile.runtime, repository: selectedFile.repository, context: optimizedContextSize});
        } catch (error) {
            setMessage(String(error));
        } finally {
            setIsDownloading(false);
            setDownloadPhase(null);
            setDownloadProgress(null);
        }
    };

    const calculateAccurateMemory = async () => {
        if (!selectedFile) return;
        const {repository, filename, revision} = selectedFile;
        const fileKey = `${repository}@${revision}/${filename}`;
        if (metadataByFile[fileKey]) return;
        setAnalyzingFile(fileKey);
        try {
            const fileSize = selectedFile.fileSize || await api.getVyactModelFileSize(
                repository, filename, selectedFile.runtime,
            );
            setSelectedFile(current => current && `${current.repository}@${current.revision}/${current.filename}` === fileKey
                ? {...current, fileSize}
                : current);
            const cachedMetadata = selectedFile.runtime === 'mlx'
                ? null
                : cacheCheckedFilesRef.current.has(fileKey)
                    ? null
                    : await api.getVyactModelMetadataCache(repository, filename, revision, 32768);
            cacheCheckedFilesRef.current.add(fileKey);
            const metadata = cachedMetadata || (selectedFile.runtime === 'mlx'
                ? await api.inspectVyactMlxMetadata(
                    repository, revision, fileSize + (selectedFile.dflash2Model?.size || selectedFile.mtpModel?.size || 0), 32768,
                )
                : await inspectRemoteGguf(repository, filename, revision, fileSize, 32768, token.trim()));
            if (!cachedMetadata && selectedFile.runtime === 'gguf') {
                await api.saveVyactModelMetadataCache(repository, filename, revision, 32768, fileSize, metadata);
            }
            setMetadataByFile(current => ({...current, [fileKey]: metadata}));
            setMessage('');
        } catch (error) {
            setMessage(`${t('modelSelector.metadataAnalysisFailed')} ${String(error)}`);
        } finally {
            setAnalyzingFile(current => current === fileKey ? '' : current);
        }
    };

    const selectModelFile = async (model: VyactHubModel, filename: string, fileSize: number) => {
        const selected = {
            repository: model.id, filename, revision: model.revision, fileSize,
            runtime: model.runtime, mtpModel: model.mtp_model, dflash2Model: model.dflash2_model, dflash2Bundled: model.dflash2_bundled,
        };
        const fileKey = `${model.id}@${model.revision}/${filename}`;
        setSelectedFile(selected);
        if (model.runtime !== 'gguf' || metadataByFile[fileKey] || cacheCheckedFilesRef.current.has(fileKey)) return;

        cacheCheckedFilesRef.current.add(fileKey);
        setAnalyzingFile(fileKey);
        try {
            const cachedMetadata = await api.getVyactModelMetadataCache(
                model.id, filename, model.revision, 32768,
            );
            if (cachedMetadata) {
                setMetadataByFile(current => ({...current, [fileKey]: cachedMetadata}));
            }
        } catch {
            // 캐시 확인 실패도 원격 헤더 조회로 자동 전환하지 않고 사용자 동작을 기다린다.
        } finally {
            setAnalyzingFile(current => current === fileKey ? '' : current);
        }
    };

    return (<>
        <ModalOverlay className="provider-editor-overlay" onClose={onClose} closeOnBackdrop={false} closeOnEscape={!isDownloading}>
            <section
                className="provider-editor vyact-model-editor"
                aria-labelledby="vyact-model-editor-title"
                onClick={event => event.stopPropagation()}
            >
                <header className="provider-editor-header">
                    <div className="provider-editor-title-icon"><Sparkles size={20}/></div>
                    <div>
                        <h2 id="vyact-model-editor-title">Vyact</h2>
                    </div>
                    <button type="button" className="provider-editor-close" onClick={onClose} aria-label={t('customProvider.close')} disabled={busy}>×</button>
                </header>

                <div className="provider-editor-body vyact-model-editor-body">
                    <section className="provider-editor-section vyact-model-controls">
                        <label className="provider-editor-field">
                            <span>
                                <Tooltip content={t('modelSelector.huggingFaceTokenHelp')} multiline size="medium">
                                    <span className="vyact-token-help" tabIndex={0}>?</span>
                                </Tooltip>
                                <KeyRound size={14}/>{t('customProvider.apiKey')} <small>{t('customProvider.optional')}</small>
                                {tokenConfigured && !token.trim() && (
                                    <Tooltip content={t('modelSelector.tokenSaved')}>
                                        <span className="vyact-token-saved" role="img" aria-label={t('modelSelector.tokenSaved')}>
                                            <Check size={11}/>
                                        </span>
                                    </Tooltip>
                                )}
                            </span>
                            <div className="vyact-token-input-row">
                                <div className="provider-api-key-field">
                                    <input
                                        type={showToken ? 'text' : 'password'}
                                        value={token}
                                        placeholder={tokenConfigured ? '••••••••••••' : ''}
                                        onChange={event => setToken(event.target.value)}
                                        autoComplete="off"
                                    />
                                    <button type="button" onClick={() => setShowToken(current => !current)} aria-label={t(showToken ? 'customProvider.hideApiKey' : 'customProvider.showApiKey')}>
                                        {showToken ? <EyeOff size={17}/> : <Eye size={17}/>}
                                    </button>
                                </div>
                                <button type="button" className="vyact-token-save" onClick={() => void saveToken()} disabled={!token.trim() || isSavingToken}>
                                    {t(isSavingToken ? 'modelSelector.savingToken' : 'modelSelector.saveToken')}
                                </button>
                            </div>
                        </label>

                        <label className="provider-editor-field">
                            <span className="vyact-search-label">
                                <span><Search size={14}/>{t('modelSelector.searchLabel')}</span>
                                {mlxAvailable && <button
                                    type="button"
                                    className={`vyact-mlx-switch${mlxOnly ? ' is-on' : ''}`}
                                    role="switch"
                                    aria-checked={mlxOnly}
                                    disabled={busy}
                                    onClick={() => setMlxOnly(current => !current)}
                                >
                                    <span aria-hidden="true"><i/></span>{t('modelSelector.mlxOnly')}
                                </button>}
                            </span>
                            <div className="vyact-model-search-field">
                                <input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void searchModels(query)} placeholder={t('common:search')} aria-label={t('modelSelector.modelSearch')}/>
                                <button type="button" onClick={() => void searchModels(query)} disabled={busy}>
                                    <Search size={17}/><span>{t('modelSelector.searchAction')}</span>
                                </button>
                            </div>
                        </label>
                    </section>

                    <section className="vyact-model-results" aria-busy={busy}>
                        {!isSearching && hardware.system_memory.total_bytes > 0 && (
                            <div className="vyact-memory-summary">
                                <div className="vyact-memory-capacity">
                                    <span>
                                        {t(hardware.memory_mode === 'unified' ? 'modelSelector.unifiedMemory' : 'modelSelector.systemMemory')}
                                        <strong>{formatBytes(hardware.system_memory.total_bytes)}</strong>
                                    </span>
                                    {hardware.memory_mode !== 'unified' && hardware.gpus.map(gpu => (
                                        <span key={`${gpu.backend}-${gpu.name}`}>
                                            {gpu.name}
                                            {gpu.total_bytes
                                                ? <>· {t('modelSelector.vram')} <strong>{formatBytes(gpu.total_bytes)}</strong></>
                                                : <strong>{gpu.backend}</strong>
                                            }
                                        </span>
                                    ))}
                                    {hardware.memory_mode !== 'unified' && hardware.gpus.length === 0 && <span>{t('modelSelector.cpuExecution')}</span>}
                                </div>
                                {selectedFile && (
                                    <div className="vyact-memory-selection">
                                        <OverflowTooltipText text={selectedFileDisplayName || ''}/>
                                        {!selectedMetadata && (
                                            <Tooltip content={t('modelSelector.accurateMemoryHint')} multiline size="medium">
                                                <button
                                                    type="button"
                                                    onClick={() => void calculateAccurateMemory()}
                                                    disabled={busy || analyzingFile === selectedFileKey}
                                                    aria-label={t('modelSelector.calculateAccurateMemory')}
                                                >
                                                    {analyzingFile === selectedFileKey
                                                        ? <LoaderCircle className="vyact-model-spinner" size={17}/>
                                                        : <Calculator size={17}/>
                                                    }
                                                </button>
                                            </Tooltip>
                                        )}
                                    </div>
                                )}
                                {selectedMetadata && (
                                    <div className="vyact-model-metadata vyact-memory-details">
                                        <span>
                                            <small>
                                                {t('modelSelector.layers')}
                                                <Tooltip content={t('modelSelector.layersHelp')} multiline size="medium">
                                                    <i className="vyact-memory-help" tabIndex={0}>?</i>
                                                </Tooltip>
                                            </small>
                                            <strong>{selectedMetadata.blockCount}</strong>
                                        </span>
                                        <span><small>{t('modelSelector.maxContext')}</small><strong>{formatContextLength(selectedMetadata.contextLength)}</strong></span>
                                        <span>
                                            <small>{t('modelSelector.modelMemory')}</small>
                                            <strong>{formatBytes(Math.max(0, selectedMetadata.estimatedMemoryBytes - selectedMetadata.kvCacheBytes))}</strong>
                                        </span>
                                        <span>
                                            <small>
                                                {t('modelSelector.conversationMemory')}
                                                <Tooltip content={t('modelSelector.conversationMemoryHelp')} multiline size="medium">
                                                    <i className="vyact-memory-help" tabIndex={0}>?</i>
                                                </Tooltip>
                                            </small>
                                            <strong>{formatBytes(selectedMetadata.kvCacheBytes)}</strong>
                                        </span>
                                        <span className="vyact-total-memory">
                                            <small>{t('modelSelector.totalEstimatedMemory')}</small>
                                            <strong>{formatBytes(selectedMetadata.estimatedMemoryBytes)}</strong>
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                        {isSearching && (
                            <div className="vyact-model-empty"><LoaderCircle className="vyact-model-spinner" size={22}/><span>{t('modelSelector.searching')}</span></div>
                        )}
                        {!isSearching && models.length === 0 && (
                            <div className="vyact-model-empty"><Search size={22}/><span>{t(hasSearched ? 'modelSelector.noSearchResults' : 'modelSelector.noInstalledModels')}</span></div>
                        )}
                        {models.map(model => {
                            const selectableFiles = getSelectableModelFiles(model.files);
                            return <article className={`vyact-model-card${selectableFiles.length === 1 ? ' is-compact' : ''}${hasSearched ? '' : ' is-installed-list'}`} key={model.id}>
                                {selectableFiles.length > 1 && <div className="vyact-model-card-heading">
                                    <OverflowTooltipText text={model.id}/>{hasSearched && <span>{formatCompactDownloads(model.downloads)}</span>}
                                </div>}
                                <div className="vyact-model-files">
                                    {selectableFiles.map(filename => {
                                        const fileKey = `${model.id}@${model.revision}/${filename}`;
                                        const isSelected = selectedFile?.repository === model.id && selectedFile.filename === filename;
                                        const fileSize = model.file_sizes?.[filename] || 0;
                                        const estimatedMemory = estimateModelMemoryBytes(model, filename);
                                        const memoryTone = getModelMemoryTone(estimatedMemory, hardware);
                                        const isInstalled = installedModels.includes(
                                            model.runtime === 'mlx' ? `mlx/${model.id}` : `${model.id}/${filename}`,
                                        );
                                        const supportsMtp = model.mtp_supported_files?.includes(filename)
                                            || mtpSupportedModels.includes(`${model.id}/${filename}`);
                                        const supportsDFlash2 = model.dflash2_supported_files?.includes(filename);
                                        const quantization = getModelQuantization(model, filename);
                                        const displayName = model.runtime === 'mlx' ? model.id.split('/').pop() || model.id : filename;
                                        return (
                                            <button type="button" className={`${isSelected ? 'is-selected ' : ''}memory-${memoryTone}`} key={filename} onClick={() => void selectModelFile(model, filename, fileSize)} disabled={busy}>
                                                <span className="vyact-model-file-name">
                                                    {model.runtime === 'mlx' && <span className="vyact-mtp-badge">{t('modelSelector.mlxRuntime')}</span>}
                                                    {supportsMtp && <span className="vyact-mtp-badge">MTP</span>}
                                                    {supportsDFlash2 && <span className="vyact-mtp-badge">DFlash2</span>}
                                                    <OverflowTooltipText text={displayName}/>
                                                </span>
                                                {estimatedMemory > 0 && <small className="vyact-model-file-meta">{fileSize > 0 && <>{formatBytes(fileSize)} · </>}{t('modelSelector.estimatedMemory')} ≈ {formatBytes(estimatedMemory)}{quantization && <span className="vyact-mtp-badge">{quantization}</span>}</small>}
                                                <span className="vyact-model-file-status">
                                                    {hasSearched && selectableFiles.length === 1 && <span className="vyact-model-file-downloads">{formatCompactDownloads(model.downloads)}</span>}
                                                    {isInstalled && <span className="vyact-model-installed">{t('modelSelector.installed')}</span>}
                                                    {analyzingFile === fileKey ? <LoaderCircle className="vyact-model-spinner" size={15}/> : isSelected && <Check size={15}/>}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </article>;
                        })}
                    </section>

                    {message && (
                        <div
                            className={`vyact-model-status${isDownloading ? ' is-progress' : ''}`}
                            role="status"
                            aria-live="polite"
                        >
                            {isDownloading && (
                                <div
                                    className={`vyact-model-progress${downloadProgress == null ? ' is-indeterminate' : ''}`}
                                    role="progressbar"
                                    aria-label={t(`modelDownload.${downloadPhase === 'runtime' ? 'preparingRuntime' : downloadPhase === 'activation' ? 'activating' : downloadPhase === 'mtp' ? 'preparingMtp' : 'downloading'}`)}
                                    aria-valuemin={downloadProgress == null ? undefined : 0}
                                    aria-valuemax={downloadProgress == null ? undefined : 100}
                                    aria-valuenow={downloadProgress == null ? undefined : downloadProgress}
                                >
                                    <span style={downloadProgress == null ? undefined : {width: `${downloadProgress}%`}}/>
                                </div>
                            )}
                            <div className="vyact-model-status-copy">
                                <span>{message}</span>
                                {isDownloading && downloadProgress != null && <strong>{downloadProgress}%</strong>}
                            </div>
                        </div>
                    )}
                </div>

                <footer className="provider-editor-footer">
                    <button type="button" className="provider-editor-cancel" onClick={onClose} disabled={busy}>{t('customProvider.cancel')}</button>
                    <button type="button" className="provider-editor-save" onClick={() => void downloadSelectedModel()} disabled={!selectedFile || busy}>
                        {isDownloading
                            ? t(`modelDownload.${downloadPhase === 'runtime' ? 'preparingRuntime' : downloadPhase === 'activation' ? 'activating' : downloadPhase === 'mtp' ? 'preparingMtp' : 'downloading'}`)
                            : t(selectedModelIsInstalled ? 'modelDownload.useInstalledAction' : 'modelDownload.downloadAction')}
                    </button>
                </footer>
            </section>
        </ModalOverlay>
        {downloadedSettings && <ModelSettingsModal modelPath={downloadedSettings.modelPath} runtime={downloadedSettings.runtime} repository={downloadedSettings.repository} recommendedContext={downloadedSettings.context} activateOnApply forceActivateOnApply mtpSupported={Boolean(selectedFile?.mtpModel)} dflash2Supported={Boolean(selectedFile?.dflash2Model || selectedFile?.dflash2Bundled)} onClose={() => {setDownloadedSettings(null); void onSelected(); onClose();}} onApplied={async () => {await onSelected(); onClose();}}/>}
        {showRuntimeInstallHelp && <ConfirmModal
            title={t('modelDownload.runtimeInstallRequiredTitle')}
            description={t('modelDownload.runtimeInstallRequiredDescription')}
            details={[
                t(hardware.platform === 'windows'
                    ? 'modelDownload.runtimeInstallWindows'
                    : 'modelDownload.runtimeInstallBrew'),
                t('modelDownload.runtimeInstallRetryHelp'),
            ]}
            options={[
                {label: t('modelDownload.runtimeInstallGuide'), value: 'guide'},
                {label: t('modelDownload.runtimeInstallRetry'), value: 'retry', variant: 'primary'},
                {label: t('modelDownload.runtimeInstallClose'), value: 'close'},
            ]}
            onClose={() => setShowRuntimeInstallHelp(false)}
            onSelect={value => {
                if (value === 'guide') {
                    window.open(
                        hardware.platform === 'windows'
                            ? 'https://learn.microsoft.com/windows/package-manager/winget/'
                            : 'https://brew.sh/',
                        '_blank',
                        'noopener,noreferrer',
                    );
                    return;
                }
                setShowRuntimeInstallHelp(false);
                if (value === 'retry') void downloadSelectedModel();
            }}
        />}
    </>);
}
