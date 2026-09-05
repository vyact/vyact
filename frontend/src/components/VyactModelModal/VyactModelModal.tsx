import {MODEL_ESTIMATE_CONTEXT} from '../../constants/modelMemory';
import ModelMemoryCapacity, {LayersHelp, MaxContextHelp, ModelArchitectureDetail} from '../common/ModelMemoryCapacity/ModelMemoryCapacity';
import ModelCapabilityIcons from '../common/ModelCapabilityIcons/ModelCapabilityIcons';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Calculator, Check, Eye, EyeOff, KeyRound, LoaderCircle, Search, Sparkles} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api, type VyactHardwareInfo, type VyactHubModel, VyactRuntimeInstallError} from '../../services/api';
import {inspectRemoteGguf, type GgufModelMetadata} from '../../utils/ggufMetadata';
import {
    formatCompactDownloads,
    formatModelBytes,
    getModelPublisher,
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
    activeModelPath?: string;
    onClose: () => void;
    onSelected: () => Promise<void>;
}

interface SelectedModelFile {
    repository: string;
    filename: string;
    revision: string;
    fileSize: number;
    runtime: 'gguf' | 'mlx';
    mtpSupported?: boolean;
    mtpModel?: {repository: string; revision: string; size: number};
    specprefillModel?: {repository: string; revision: string; size: number};
    dflash2Model?: {repository: string; revision: string; filename?: string; size: number};
    dflash2Bundled?: boolean;
}

const modelDetailsKey = (runtime: string, repository: string, filename: string, revision: string) =>
    JSON.stringify([runtime, repository, filename, revision]);

type CachedModelDetails = {file: SelectedModelFile; metadata: GgufModelMetadata};

type DownloadPhase = 'runtime' | 'model' | 'mtp' | 'activation' | null;

const EMPTY_HARDWARE_INFO: VyactHardwareInfo = {
    platform: '', apple_silicon: false, memory_mode: 'system',
    system_memory: {total_bytes: 0, available_bytes: 0},
    gpus: [],
};

const formatBytes = formatModelBytes;

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

export default function VyactModelModal({onClose, onSelected, activeModelPath}: VyactModelModalProps) {
    const {t} = useTranslation('main');
    const [token, setToken] = useState('');
    const [tokenConfigured, setTokenConfigured] = useState(false);
    const [showToken, setShowToken] = useState(false);
    const [query, setQuery] = useState('');
    const [mlxOnly, setMlxOnly] = useState(() => navigator.platform.toUpperCase().includes('MAC'));
    const [models, setModels] = useState<VyactHubModel[]>([]);
    const [installedModels, setInstalledModels] = useState<string[]>(() => api.getCachedVyactInstalledModels());
    const [visionSupportedModels, setVisionSupportedModels] = useState<string[]>([]);
    const [audioSupportedModels, setAudioSupportedModels] = useState<string[]>([]);
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
    const [modelDetailsCache, setModelDetailsCache] = useState<Record<string, CachedModelDetails>>({});
    const [selectedMetadata, setSelectedMetadata] = useState<GgufModelMetadata | null>(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [downloadedSettings, setDownloadedSettings] = useState<{modelPath: string; runtime: 'gguf' | 'mlx'; repository: string; context: number} | null>(null);
    const [showRuntimeInstallHelp, setShowRuntimeInstallHelp] = useState(false);
    const searchRequestIdRef = useRef(0);
    const detailsRequestIdRef = useRef(0);
    const busy = isSearching || isDownloading || isSavingToken;
    const selectedModelPath = selectedFile
        ? selectedFile.runtime === 'mlx' ? `mlx/${selectedFile.repository}` : `${selectedFile.repository}/${selectedFile.filename}`
        : '';
    const selectedFileDisplayName = selectedFile?.runtime === 'mlx'
        ? selectedFile.repository.split('/').pop()
        : selectedFile?.filename;
    const selectedModelIsInstalled = Boolean(selectedModelPath && installedModels.includes(selectedModelPath));
    const mlxAvailable = navigator.platform.toUpperCase().includes('MAC')
        || hardware.apple_silicon
        || installedModels.some(model => model.startsWith('mlx/'));

    const searchModels = useCallback(async (searchQuery: string, searchMlxOnly = mlxOnly) => {
        const requestId = ++searchRequestIdRef.current;
        detailsRequestIdRef.current += 1;
        setHasSearched(true);
        setIsSearching(true);
        setIsLoadingDetails(false);
        setModels([]);
        setSelectedFile(null);
        setSelectedMetadata(null);
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
    }, [mlxOnly, token]);

    useEffect(() => {
        void api.getModels()
            .then(response => {
                if (response.hardware) setHardware(response.hardware);
                setVisionSupportedModels(response.vision_supported || []);
                setAudioSupportedModels(response.audio_supported || []);
                const installed = response.installed || [];
                const mtpSupported = response.mtp_supported || [];
                const dflash2Supported = response.dflash2_supported || [];
                setInstalledModels(installed);
                setMtpSupportedModels(mtpSupported);
                const cards = buildInstalledModelCards(installed, mtpSupported, dflash2Supported);
                const detailsCache: Record<string, CachedModelDetails> = {};
                for (const model of cards) {
                    for (const filename of model.files) {
                        const path = model.runtime === 'mlx' ? `mlx/${model.id}` : `${model.id}/${filename}`;
                        const detail = response.installed_details?.[path];
                        if (!detail) continue;
                        model.file_sizes[filename] = detail.fileSize;
                        detailsCache[modelDetailsKey(model.runtime, model.id, filename, model.revision)] = {
                            file: {repository: model.id, filename, revision: model.revision, runtime: model.runtime, fileSize: detail.fileSize, mtpSupported: mtpSupported.includes(path)},
                            metadata: {...detail.metadata, parameterCount: 0, quantization: '', kvCacheBytes: 0, runtimeBufferBytes: 0, estimatedMemoryBytes: 0},
                        };
                    }
                }
                setModelDetailsCache(current => ({...current, ...detailsCache}));
                setModels(cards);
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
        if (selectedModelIsInstalled && selectedModelPath === activeModelPath) {
            onClose();
            return;
        }
        setIsDownloading(true);
        setDownloadProgress(null);
        try {
            let modelToDownload = selectedFile.fileSize > 0 ? selectedFile : {
                ...selectedFile,
                fileSize: await api.getVyactModelFileSize(
                    selectedFile.repository, selectedFile.filename, selectedFile.runtime,
                ),
            };
            if (modelToDownload.fileSize !== selectedFile.fileSize) setSelectedFile(modelToDownload);
            let optimizedMetadata: GgufModelMetadata | undefined;
            if (modelToDownload.runtime === 'mlx') {
                const details = await api.inspectVyactMlxMetadata(
                    modelToDownload.repository, modelToDownload.revision, modelToDownload.fileSize, MODEL_ESTIMATE_CONTEXT,
                );
                optimizedMetadata = details.metadata;
                if (details.mtpModel) {
                    modelToDownload = {
                        ...modelToDownload,
                        mtpSupported: true,
                        mtpModel: details.mtpModel,
                    };
                    setSelectedFile(modelToDownload);
                }
            }
            const modelToDownloadWeightBytes = modelToDownload.fileSize + (
                modelToDownload.dflash2Model?.size
                || modelToDownload.mtpModel?.size
                || modelToDownload.specprefillModel?.size
                || 0
            );
            if (modelToDownload.runtime === 'gguf') {
                setDownloadPhase('runtime');
                const runtimeMessageKey = 'modelDownload.preparingRuntime';
                setMessage(t(runtimeMessageKey));
                await api.installVyactRuntime(() => setMessage(t(runtimeMessageKey)));
            } else {
                setDownloadPhase('runtime');
                const runtimeMessageKey = 'modelDownload.preparingOmlx';
                setMessage(t(runtimeMessageKey));
                await api.installVyactRuntime(() => setMessage(t(runtimeMessageKey)), true);
            }
            setDownloadPhase(selectedModelIsInstalled ? 'mtp' : 'model');
            setDownloadProgress(0);
            setMessage(t(selectedModelIsInstalled ? 'modelDownload.preparingMtp' : 'modelDownload.downloading'));
            await api.streamVyactModelDownload(
                modelToDownload.repository,
                modelToDownload.filename,
                (_downloadMessage, progress) => {
                    const messageKey = progress != null && progress >= 99
                        ? 'modelDownload.finalizing'
                        : selectedModelIsInstalled
                            ? 'modelDownload.preparingMtp'
                            : 'modelDownload.downloading';
                    setMessage(t(messageKey));
                    if (progress != null) setDownloadProgress(progress);
                },
                modelToDownload.revision,
                modelToDownload.runtime,
                token.trim(),
                modelToDownload.fileSize,
                modelToDownload.mtpModel,
                modelToDownload.specprefillModel,
                modelToDownload.dflash2Model,
                modelToDownload.dflash2Bundled,
            );
            setInstalledModels(api.getCachedVyactInstalledModels());
            if (!optimizedMetadata) {
                try {
                    optimizedMetadata = await inspectRemoteGguf(
                        modelToDownload.repository, modelToDownload.filename, modelToDownload.revision,
                        modelToDownload.fileSize, MODEL_ESTIMATE_CONTEXT, token.trim(),
                    );
                } catch (error) {
                    console.warn('Model metadata inspection failed; using the safe context default:', error);
                }
            }
            const optimizedContextSize = getOptimizedModelContext(
                optimizedMetadata,
                modelToDownloadWeightBytes,
                hardware,
            );
            if (!selectedModelIsInstalled) {
                const defaultProfile = await api.getVyactModelProfile(
                    selectedModelPath,
                    modelToDownload.runtime,
                    modelToDownload.repository,
                    optimizedContextSize,
                );
                await api.saveVyactModelProfile(defaultProfile);
            }
            setDownloadedSettings({modelPath: selectedModelPath, runtime: modelToDownload.runtime, repository: modelToDownload.repository, context: optimizedContextSize});
        } catch (error) {
            setMessage(String(error));
        } finally {
            setIsDownloading(false);
            setDownloadPhase(null);
            setDownloadProgress(null);
        }
    };

    const selectModelFile = (model: VyactHubModel, filename: string, fileSize: number) => {
        detailsRequestIdRef.current += 1;
        const modelPath = model.runtime === 'mlx' ? `mlx/${model.id}` : `${model.id}/${filename}`;
        const selected = {
            repository: model.id, filename, revision: model.revision, fileSize,
            runtime: model.runtime,
            mtpSupported: Boolean(model.mtp_supported_files?.includes(filename)
                || mtpSupportedModels.includes(modelPath)),
            mtpModel: model.mtp_model,
            specprefillModel: model.specprefill_model,
            dflash2Model: model.dflash2_model,
            dflash2Bundled: model.dflash2_bundled,
        };
        const cached = installedModels.includes(modelPath)
            ? Object.values(modelDetailsCache).find(detail => detail.file.runtime === selected.runtime
                && detail.file.repository === selected.repository && detail.file.filename === selected.filename)
            : modelDetailsCache[modelDetailsKey(selected.runtime, selected.repository, selected.filename, selected.revision)];
        setSelectedFile(cached?.file || selected);
        setSelectedMetadata(cached?.metadata || null);
        setIsLoadingDetails(false);
        setMessage('');

    };

    const loadModelDetails = async (file: SelectedModelFile) => {
        const path = file.runtime === 'mlx' ? `mlx/${file.repository}` : `${file.repository}/${file.filename}`;
        if (installedModels.includes(path)) return;
        const requestId = ++detailsRequestIdRef.current;
        setIsLoadingDetails(true);
        setMessage('');
        try {
            const modelForDetails = file.fileSize > 0 ? file : {
                ...file,
                fileSize: await api.getVyactModelFileSize(
                    file.repository, file.filename, file.runtime,
                ),
            };
            if (requestId !== detailsRequestIdRef.current) return;
            if (modelForDetails.fileSize !== file.fileSize) setSelectedFile(modelForDetails);
            let detailedFile = modelForDetails;
            let metadata: GgufModelMetadata;
            if (modelForDetails.runtime === 'mlx') {
                const details = await api.inspectVyactMlxMetadata(
                    modelForDetails.repository, modelForDetails.revision, modelForDetails.fileSize, MODEL_ESTIMATE_CONTEXT,
                );
                metadata = details.metadata;
                if (details.mtpModel) {
                    detailedFile = {...modelForDetails, mtpSupported: true, mtpModel: details.mtpModel};
                }
            } else {
                const cached = await api.getVyactModelMetadataCache(
                    modelForDetails.repository, modelForDetails.filename, modelForDetails.revision, MODEL_ESTIMATE_CONTEXT,
                );
                metadata = cached || await inspectRemoteGguf(
                    modelForDetails.repository, modelForDetails.filename, modelForDetails.revision,
                    modelForDetails.fileSize, MODEL_ESTIMATE_CONTEXT, token.trim(),
                );
                if (!cached) {
                    void api.saveVyactModelMetadataCache(
                        modelForDetails.repository, modelForDetails.filename, modelForDetails.revision,
                        MODEL_ESTIMATE_CONTEXT, modelForDetails.fileSize, metadata,
                    ).catch(() => undefined);
                }
                const selectedModel = models.find(model => model.id === modelForDetails.repository);
                const projector = selectedModel?.files.find(filename => /(^|\/)mmproj[^/]*\.gguf$/i.test(filename));
                if (projector) {
                    const projectorMetadata = await inspectRemoteGguf(
                        modelForDetails.repository, projector, modelForDetails.revision,
                        selectedModel?.file_sizes?.[projector] || 0, MODEL_ESTIMATE_CONTEXT, token.trim(),
                    );
                    metadata = {...metadata, modalities: projectorMetadata.modalities};
                }
            }
            const key = modelDetailsKey(detailedFile.runtime, detailedFile.repository, detailedFile.filename, detailedFile.revision);
            setModelDetailsCache(current => ({...current, [key]: {file: detailedFile, metadata}}));
            if (requestId === detailsRequestIdRef.current) {
                setSelectedFile(detailedFile);
                setSelectedMetadata(metadata);
            }
        } catch {
            if (requestId === detailsRequestIdRef.current) setMessage(t('modelSelector.metadataAnalysisFailed'));
        } finally {
            if (requestId === detailsRequestIdRef.current) setIsLoadingDetails(false);
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
                                <ModelMemoryCapacity hardware={hardware}/>
                                {selectedFile && (
                                    <div className="vyact-memory-selection">
                                        <span className="vyact-selected-model-labels">
                                            {selectedFile.runtime === 'mlx' && <span className="vyact-mtp-badge">MLX</span>}
                                            {selectedFile.mtpSupported && <span className="vyact-mtp-badge">MTP</span>}
                                            {(selectedFile.dflash2Model || selectedFile.dflash2Bundled) && <span className="vyact-mtp-badge">DFlash2</span>}
                                            <ModelCapabilityIcons image={visionSupportedModels.includes(selectedModelPath) || selectedMetadata?.modalities?.includes('image')} audio={audioSupportedModels.includes(selectedModelPath) || selectedMetadata?.modalities?.includes('audio')}/>
                                            <strong>{selectedFileDisplayName}</strong>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => selectedFile && void loadModelDetails(selectedFile)}
                                            disabled={busy || isLoadingDetails || selectedModelIsInstalled}
                                            aria-label={t(isLoadingDetails ? 'modelSelector.analyzingMetadata' : 'modelSelector.calculateAccurateMemory')}
                                            title={t(isLoadingDetails ? 'modelSelector.analyzingMetadata' : 'modelSelector.calculateAccurateMemory')}
                                        >
                                            {isLoadingDetails
                                                ? <LoaderCircle className="vyact-model-spinner" size={17}/>
                                                : <Calculator size={17}/>
                                            }
                                        </button>
                                    </div>
                                )}
                                {selectedFile && selectedMetadata && (
                                    <div className="vyact-model-metadata vyact-memory-details">
                                                <ModelArchitectureDetail architecture={selectedMetadata.architecture}/>
                                        <span><small><LayersHelp/>{t('modelSelector.layers')}</small><strong>{selectedMetadata.blockCount}</strong></span>
                                        <span><small><MaxContextHelp/>{t('modelSelector.maxContext')}</small><strong>{selectedMetadata.contextLength >= 1024 ? `${Math.round(selectedMetadata.contextLength / 1024)}K` : selectedMetadata.contextLength}</strong></span>
                                        <span><small>{t('modelSelector.modelFileSize')}</small><strong>{formatBytes(selectedFile.fileSize)}</strong></span>
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
                            const publisher = getModelPublisher(model.id);
                            const showsPublisher = hasSearched && Boolean(publisher);
                            const showsCompactDownloads = hasSearched && selectableFiles.length === 1;
                            return <article className={`vyact-model-card${selectableFiles.length === 1 ? ' is-compact' : ''}${hasSearched ? '' : ' is-installed-list'}`} key={model.id}>
                                {selectableFiles.length > 1 && <div className="vyact-model-card-heading">
                                    <OverflowTooltipText text={model.id}/>{hasSearched && <span>{formatCompactDownloads(model.downloads)}</span>}
                                </div>}
                                <div className="vyact-model-files">
                                    {selectableFiles.map(filename => {
                                        const isSelected = selectedFile?.repository === model.id && selectedFile.filename === filename;
                                        const fileSize = model.file_sizes?.[filename] || 0;
                                        const isInstalled = installedModels.includes(
                                            model.runtime === 'mlx' ? `mlx/${model.id}` : `${model.id}/${filename}`,
                                        );
                                        const modelPath = model.runtime === 'mlx'
                                            ? `mlx/${model.id}`
                                            : `${model.id}/${filename}`;
                                        const supportsMtp = model.mtp_supported_files?.includes(filename)
                                            || mtpSupportedModels.includes(modelPath);
                                        const supportsDFlash2 = model.dflash2_supported_files?.includes(filename);
                                        const quantization = getModelQuantization(model, filename);
                                        const displayName = model.runtime === 'mlx' ? model.id.split('/').pop() || model.id : filename;
                                        return (
                                            <button type="button" aria-pressed={isSelected} className={`${isSelected ? 'is-selected ' : ''}memory-${getModelMemoryTone(fileSize, hardware)}`} key={filename} onClick={() => void selectModelFile(model, filename, fileSize)} disabled={busy}>
                                                <span className="vyact-model-file-name">
                                                    {model.runtime === 'mlx' && <span className="vyact-mtp-badge">{t('modelSelector.mlxOnly')}</span>}
                                                    {supportsMtp && <span className="vyact-mtp-badge">MTP</span>}
                                                    {supportsDFlash2 && <span className="vyact-mtp-badge">DFlash2</span>}
                                                    <ModelCapabilityIcons image={visionSupportedModels.includes(modelPath) || modelDetailsCache[modelDetailsKey(model.runtime, model.id, filename, model.revision)]?.metadata.modalities?.includes('image')} audio={audioSupportedModels.includes(modelPath) || modelDetailsCache[modelDetailsKey(model.runtime, model.id, filename, model.revision)]?.metadata.modalities?.includes('audio')}/>
                                                    <OverflowTooltipText text={displayName}/>
                                                </span>
                                                {(showsPublisher || fileSize > 0) && <small className="vyact-model-file-meta">
                                                    {showsPublisher && <span className="vyact-model-publisher">@{publisher}</span>}
                                                    {showsPublisher && fileSize > 0 && <span aria-hidden="true">·</span>}
                                                    {fileSize > 0 && <>{t('modelSelector.modelFileSize')} · {formatBytes(fileSize)}</>}
                                                </small>}
                                                <span className="vyact-model-file-status">
                                                    <span className="vyact-model-file-status-top">
                                                        {showsCompactDownloads && <span className="vyact-model-file-downloads">{formatCompactDownloads(model.downloads)}</span>}
                                                        <span className="vyact-model-file-check" aria-hidden="true"><Check size={15}/></span>
                                                    </span>
                                                    <span className="vyact-model-file-stats">
                                                        {quantization && <span className="vyact-mtp-badge">{quantization}</span>}
                                                        {isInstalled && <span className="vyact-model-installed">{t('modelSelector.installed')}</span>}
                                                    </span>
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
        {downloadedSettings && <ModelSettingsModal modelPath={downloadedSettings.modelPath} runtime={downloadedSettings.runtime} repository={downloadedSettings.repository} recommendedContext={downloadedSettings.context} activateOnApply forceActivateOnApply mtpSupported={Boolean(selectedFile?.mtpSupported)} dflash2Supported={Boolean(selectedFile?.dflash2Model || selectedFile?.dflash2Bundled)} onClose={() => {setDownloadedSettings(null); void onSelected(); onClose();}} onApplied={async () => {await onSelected(); onClose();}}/>}
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
