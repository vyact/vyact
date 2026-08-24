import {useCallback, useEffect, useRef, useState} from 'react';
import {Calculator, Check, Eye, EyeOff, KeyRound, LoaderCircle, Search, Sparkles} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api, type VyactHardwareInfo, type VyactHubModel} from '../../services/api';
import {inspectRemoteGguf, type GgufModelMetadata} from '../../utils/ggufMetadata';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import {Tooltip} from '../common/Tooltip/Tooltip';
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
}

const MAX_FILES_PER_MODEL = 8;
const MODEL_MEMORY_OVERHEAD_RATIO = 1.2;
const EMPTY_HARDWARE_INFO: VyactHardwareInfo = {
    platform: '', memory_mode: 'system',
    system_memory: {total_bytes: 0, available_bytes: 0},
    gpus: [],
};

const formatBytes = (bytes: number) => {
    if (!bytes) return '—';
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

const formatContextLength = (tokens: number) => tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens);

const getSelectableModelFiles = (files: string[]) => files
    .filter(filename => !/^(BF16|MTP)\//i.test(filename))
    .filter(filename => !/(^|\/)mmproj[^/]*\.gguf$/i.test(filename))
    .filter(filename => !/-\d{5}-of-\d{5}\.gguf$/i.test(filename))
    .sort((left, right) => {
        const priority = (filename: string) => {
            if (/Q4_K_M/i.test(filename)) return 0;
            if (/Q4_0/i.test(filename)) return 1;
            if (/Q5_K_M/i.test(filename)) return 2;
            if (/Q6_K/i.test(filename)) return 3;
            if (/Q8_0/i.test(filename)) return 4;
            return 5;
        };
        return priority(left) - priority(right);
    })
    .slice(0, MAX_FILES_PER_MODEL);

type MemoryTone = 'comfortable' | 'tight' | 'over';

const getTotalModelMemoryCapacity = (hardware: VyactHardwareInfo) => {
    if (hardware.memory_mode !== 'dedicated') return hardware.system_memory.total_bytes;
    const dedicatedVram = hardware.gpus
        .filter(gpu => !gpu.shared_memory)
        .reduce((total, gpu) => total + gpu.total_bytes, 0);
    return hardware.system_memory.total_bytes + dedicatedVram;
};

const getMemoryTone = (estimatedMemory: number, hardware: VyactHardwareInfo): MemoryTone => {
    const capacity = getTotalModelMemoryCapacity(hardware);
    if (!capacity || estimatedMemory > capacity * .85) return 'over';
    if (estimatedMemory > capacity * .6) return 'tight';
    return 'comfortable';
};

export default function VyactModelModal({onClose, onSelected}: VyactModelModalProps) {
    const {t} = useTranslation('main');
    const [token, setToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [query, setQuery] = useState('');
    const [models, setModels] = useState<VyactHubModel[]>([]);
    const [selectedFile, setSelectedFile] = useState<SelectedModelFile | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [message, setMessage] = useState('');
    const [hardware, setHardware] = useState<VyactHardwareInfo>(EMPTY_HARDWARE_INFO);
    const [metadataByFile, setMetadataByFile] = useState<Record<string, GgufModelMetadata>>({});
    const [analyzingFile, setAnalyzingFile] = useState('');
    const searchRequestIdRef = useRef(0);
    const cacheCheckedFilesRef = useRef(new Set<string>());
    const busy = isSearching || isDownloading;
    const selectedFileKey = selectedFile
        ? `${selectedFile.repository}@${selectedFile.revision}/${selectedFile.filename}`
        : '';
    const selectedMetadata = selectedFileKey ? metadataByFile[selectedFileKey] : undefined;

    const searchModels = useCallback(async (searchQuery: string) => {
        const requestId = ++searchRequestIdRef.current;
        setIsSearching(true);
        setModels([]);
        setSelectedFile(null);
        setMessage('');
        try {
            const searchResponse = await api.searchVyactModels(searchQuery);
            if (requestId === searchRequestIdRef.current) {
                setModels(searchResponse.models);
                setHardware(searchResponse.hardware);
            }
        } catch (error) {
            if (requestId === searchRequestIdRef.current) setMessage(String(error));
        } finally {
            if (requestId === searchRequestIdRef.current) setIsSearching(false);
        }
    }, []);

    useEffect(() => {
        void searchModels('');
        // 인기 모델은 모달을 열 때 한 번만 불러온다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const downloadSelectedModel = async () => {
        if (!selectedFile) return;
        setIsDownloading(true);
        setMessage(t('modelDownload.downloading'));
        try {
            if (token.trim()) await api.saveVyactHuggingFaceToken(token.trim());
            await api.streamVyactModelDownload(
                selectedFile.repository,
                selectedFile.filename,
                (_downloadMessage, progress) => setMessage(progress == null ? t('modelDownload.downloading') : `${progress}%`),
            );
            await api.activateVyactModel(
                `${selectedFile.repository}/${selectedFile.filename}`,
                32768,
                (activationMessage, progress) => setMessage(progress == null ? activationMessage : `${activationMessage} ${progress}%`),
            );
            await onSelected();
            onClose();
        } catch (error) {
            setMessage(String(error));
        } finally {
            setIsDownloading(false);
        }
    };

    const calculateAccurateMemory = async () => {
        if (!selectedFile || !selectedFile.fileSize) return;
        const {repository, filename, revision, fileSize} = selectedFile;
        const fileKey = `${repository}@${revision}/${filename}`;
        if (metadataByFile[fileKey]) return;
        setAnalyzingFile(fileKey);
        try {
            const cachedMetadata = cacheCheckedFilesRef.current.has(fileKey)
                ? null
                : await api.getVyactModelMetadataCache(repository, filename, revision, 32768);
            cacheCheckedFilesRef.current.add(fileKey);
            const metadata = cachedMetadata || await inspectRemoteGguf(
                repository, filename, revision, fileSize, 32768, token.trim(),
            );
            if (!cachedMetadata) {
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
        const selected = {repository: model.id, filename, revision: model.revision, fileSize};
        const fileKey = `${model.id}@${model.revision}/${filename}`;
        setSelectedFile(selected);
        if (metadataByFile[fileKey] || cacheCheckedFilesRef.current.has(fileKey)) return;

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

    return (
        <ModalOverlay className="provider-editor-overlay" onClose={onClose} closeOnBackdrop={false} blur={5}>
            <section
                className="provider-editor vyact-model-editor"
                aria-labelledby="vyact-model-editor-title"
                onClick={event => event.stopPropagation()}
            >
                <header className="provider-editor-header">
                    <div className="provider-editor-title-icon"><Sparkles size={20}/></div>
                    <div>
                        <h2 id="vyact-model-editor-title">Vyact</h2>
                        <p>{t('modelSelector.selectModel')}</p>
                    </div>
                    <button type="button" className="provider-editor-close" onClick={onClose} aria-label={t('customProvider.close')} disabled={busy}>×</button>
                </header>

                <div className="provider-editor-body vyact-model-editor-body">
                    <section className="provider-editor-section vyact-model-controls">
                        <label className="provider-editor-field">
                            <span>
                                <Tooltip content={t('modelSelector.huggingFaceTokenHelp')} multiline large>
                                    <span className="vyact-token-help" tabIndex={0}>?</span>
                                </Tooltip>
                                <KeyRound size={14}/>{t('customProvider.apiKey')} <small>{t('customProvider.optional')}</small>
                            </span>
                            <div className="provider-api-key-field">
                                <input type={showToken ? 'text' : 'password'} value={token} onChange={event => setToken(event.target.value)} autoComplete="off"/>
                                <button type="button" onClick={() => setShowToken(current => !current)} aria-label={t(showToken ? 'customProvider.hideApiKey' : 'customProvider.showApiKey')}>
                                    {showToken ? <EyeOff size={17}/> : <Eye size={17}/>}
                                </button>
                            </div>
                        </label>

                        <label className="provider-editor-field">
                            <span><Search size={14}/>{t('modelSelector.searchLabel')}</span>
                            <div className="vyact-model-search-field">
                                <input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void searchModels(query)} placeholder={t('modelSelector.modelSearch')}/>
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
                                            {gpu.name} <strong>{gpu.total_bytes ? formatBytes(gpu.total_bytes) : gpu.backend}</strong>
                                        </span>
                                    ))}
                                    {hardware.memory_mode !== 'unified' && hardware.gpus.length === 0 && <span>{t('modelSelector.cpuExecution')}</span>}
                                </div>
                                {selectedFile && (
                                    <div className="vyact-memory-selection">
                                        <span>{selectedFile.filename}</span>
                                        {!selectedMetadata && (
                                            <>
                                                <span className="vyact-memory-requirement">
                                                    {t('modelSelector.quickEstimatedMemory')}
                                                    <strong>{formatBytes(selectedFile.fileSize * MODEL_MEMORY_OVERHEAD_RATIO)}</strong>
                                                </span>
                                                <Tooltip content={t('modelSelector.accurateMemoryHint')} multiline large>
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
                                            </>
                                        )}
                                    </div>
                                )}
                                {selectedMetadata && (
                                    <div className="vyact-model-metadata vyact-memory-details">
                                        <span>
                                            <small>
                                                {t('modelSelector.layers')}
                                                <Tooltip content={t('modelSelector.layersHelp')} multiline large>
                                                    <i className="vyact-memory-help" tabIndex={0}>?</i>
                                                </Tooltip>
                                            </small>
                                            <strong>{selectedMetadata.blockCount}</strong>
                                        </span>
                                        <span><small>{t('modelSelector.maxContext')}</small><strong>{formatContextLength(selectedMetadata.contextLength)}</strong></span>
                                        <span>
                                            <small>
                                                {t('modelSelector.conversationMemory')}
                                                <Tooltip content={t('modelSelector.conversationMemoryHelp')} multiline large>
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
                            <div className="vyact-model-empty"><Search size={22}/><span>{t('modelSelector.noSearchResults')}</span></div>
                        )}
                        {models.map(model => (
                            <article className="vyact-model-card" key={model.id}>
                                <div className="vyact-model-card-heading">
                                    <strong>{model.id}</strong><span>{t('modelSelector.monthlyDownloads')} {model.downloads.toLocaleString()}</span>
                                </div>
                                <div className="vyact-model-files">
                                    {getSelectableModelFiles(model.files).map(filename => {
                                        const fileKey = `${model.id}@${model.revision}/${filename}`;
                                        const isSelected = selectedFile?.repository === model.id && selectedFile.filename === filename;
                                        const fileSize = model.file_sizes?.[filename] || 0;
                                        const estimatedMemory = fileSize * MODEL_MEMORY_OVERHEAD_RATIO;
                                        const memoryTone = getMemoryTone(estimatedMemory, hardware);
                                        return (
                                            <button type="button" className={`${isSelected ? 'is-selected ' : ''}memory-${memoryTone}`} key={filename} onClick={() => void selectModelFile(model, filename, fileSize)} disabled={busy}>
                                                <span className="vyact-model-file-name">{filename}</span>
                                                {fileSize > 0 && <small>{formatBytes(fileSize)} · {t('modelSelector.estimatedMemory')} {formatBytes(estimatedMemory)}</small>}
                                                {analyzingFile === fileKey ? <LoaderCircle className="vyact-model-spinner" size={15}/> : isSelected && <Check size={15}/>} 
                                            </button>
                                        );
                                    })}
                                </div>
                            </article>
                        ))}
                    </section>

                    {message && <div className="vyact-model-status" role="status">{message}</div>}
                </div>

                <footer className="provider-editor-footer">
                    <button type="button" className="provider-editor-cancel" onClick={onClose} disabled={busy}>{t('customProvider.cancel')}</button>
                    <button type="button" className="provider-editor-save" onClick={() => void downloadSelectedModel()} disabled={!selectedFile || busy}>
                        {isDownloading ? t('modelDownload.downloading') : t('modelDownload.downloadAction')}
                    </button>
                </footer>
            </section>
        </ModalOverlay>
    );
}
