import React, {useState, useRef, useEffect, useCallback} from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import type {ArticleAttachment} from '../../types';
import CustomSelect from '../CustomSelect/CustomSelect';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import KnowledgeCollectionAttachSelect from '../KnowledgeCollectionsModal/KnowledgeCollectionAttachSelect';
import {getDocumentFiles, invalidateDocumentFiles, removeCachedDocumentFiles} from '../../services/documentFiles';
import './DocumentModal.css';

interface DocumentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onQueryWithDoc: (articles: ArticleAttachment[], question: string) => void;
    externalDropFiles?: File[];
    onExternalDropHandled?: () => void;
    attachedDocumentIds?: string[];
    onToggleSavedDocument?: (article: ArticleAttachment) => void;
    onDetachSavedDocuments?: (fileIds: string[]) => void;
}

type Tab = 'index' | 'query' | 'files';
type UploadStatus = 'idle' | 'uploading' | 'done' | 'stopped' | 'error';
type IndexFileState = 'pending' | 'processing' | 'done' | 'stopped' | 'skipped' | 'error';

interface IndexFileProgress {
    state: IndexFileState;
    stage: string;
    percent: number;
    totalChunks?: number;
    embeddedChunks?: number;
    indexedChunks?: number;
    startedAt?: number;
    elapsedSeconds?: number;
}

interface IndexProgressEvent {
    type: 'progress' | 'result' | 'error';
    stage?: string;
    percent?: number;
    message?: string;
    chunks?: number;
    total_chunks?: number;
    embedded_chunks?: number;
    indexed_chunks?: number;
    already_exists?: boolean;
}

interface SavedFile {
    file_id: string;
    filename: string;
    file_ext: string;
    file_size: number;
    chunk_count: number;
    indexed_at: string;
    has_original: boolean;
    source_type?: 'document' | 'web';
    url?: string;
    domain?: string;
}

interface Chunk {
    chunk_index: number;
    content: string;
    chunk_type: string;
    heading_path: string[];
    page_number: number | null;
    content_length: number;
}

interface DeletePopoverPosition {
    top: number;
    left: number;
    placement: 'top' | 'bottom';
}

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.html', '.htm', '.md'];
const DELETE_POPOVER_WIDTH = 210;
const DELETE_POPOVER_HEIGHT = 90;
const DELETE_POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 12;

const FILE_ICON: Record<string, string> = {
    pdf: '📄', docx: '📝', doc: '📝',
    xlsx: '📊', xls: '📊', pptx: '📑', ppt: '📑',
    txt: '📃', html: '🌐', htm: '🌐', md: '📋',
};
const INDEX_STAGE_FALLBACKS: Record<string, string> = {
    uploading: 'Uploading file',
    checking_duplicate: 'Checking for duplicates',
    parsing: 'Parsing document',
    chunking: 'Chunking document',
    saving_original: 'Saving original file',
    embedding: 'Creating embeddings',
    indexing_chunks: 'Saving to Elasticsearch',
    saving_metadata: 'Saving file metadata',
    duplicate: 'Duplicate file',
    completed: 'Indexing complete',
};
const INDEX_STATE_FALLBACKS: Record<IndexFileState, string> = {
    pending: 'Queued',
    processing: 'Processing',
    done: 'Done',
    stopped: 'Stopped',
    skipped: 'Duplicate',
    error: 'Failed',
};

/** 청크 카운터가 갱신돼도 현재 작업 단계 문구는 다시 그리지 않는다. */
const IndexStageText = React.memo(({label}: {label: string}) => <span>{label}</span>);

const getExt = (name: string) => name.split('.').pop()?.toLowerCase() || '';
const getIcon = (name: string) => FILE_ICON[getExt(name)] || '📄';
const getFileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const CHUNK_TYPE_FALLBACKS: Record<string, string> = {
    heading: 'Heading',
    paragraph: 'Paragraph',
    table: 'Table',
    code: 'Code',
};
const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
};

const DocumentModal: React.FC<DocumentModalProps> = ({
    isOpen,
    onClose,
    onQueryWithDoc,
    externalDropFiles = [],
    onExternalDropHandled,
    attachedDocumentIds = [],
    onToggleSavedDocument,
    onDetachSavedDocuments,
}) => {
    const {t} = useTranslation('main');
    const [tab, setTab] = useState<Tab>('index');

    // 업로드 공통
    const [files, setFiles] = useState<File[]>([]);
    const [status, setStatus] = useState<UploadStatus>('idle');
    const [message, setMessage] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 즉시 질의
    const [question, setQuestion] = useState('');
    const [maxChars, setMaxChars] = useState<number>(20000);
    const questionRef = useRef<HTMLTextAreaElement>(null);

    // 인덱싱 진행 카운터
    const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0 });
    const [indexFileProgress, setIndexFileProgress] = useState<Record<string, IndexFileProgress>>({});
    const [currentIndexFile, setCurrentIndexFile] = useState('');
    const [currentIndexFileKey, setCurrentIndexFileKey] = useState('');
    const [currentIndexStage, setCurrentIndexStage] = useState('');
    const [overallIndexPercent, setOverallIndexPercent] = useState(0);
    const [indexingStartedAt, setIndexingStartedAt] = useState<number | null>(null);
    const [completedIndexingElapsedMs, setCompletedIndexingElapsedMs] = useState(0);
    const [finalIndexingElapsedSeconds, setFinalIndexingElapsedSeconds] = useState<number | null>(null);
    const [isStopRequested, setIsStopRequested] = useState(false);
    const stopRequestedRef = useRef(false);
    const [progressClock, setProgressClock] = useState(() => performance.now());
    const fileItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // 저장된 문서
    const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);
    const [deletingFile, setDeletingFile] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [deletePopoverPosition, setDeletePopoverPosition] = useState<DeletePopoverPosition | null>(null);
    const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
    const [deletingAll, setDeletingAll] = useState(false);
    const [fileSearch, setFileSearch] = useState('');
    const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
    const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
    const downloadControllerRef = useRef<AbortController | null>(null);

    // 청크 뷰어
    const [chunkViewFile, setChunkViewFile] = useState<SavedFile | null>(null);
    const [chunks, setChunks] = useState<Chunk[]>([]);
    const [chunksLoading, setChunksLoading] = useState(false);
    const [selectedChunk, setSelectedChunk] = useState<Chunk | null>(null);

    const resetModalState = useCallback(() => {
        setTab('index');
        setFiles([]);
        setStatus('idle');
        setMessage('');
        setIsDragging(false);
        setQuestion('');
        setMaxChars(0);
        setIndexProgress({done: 0, total: 0});
        setIndexFileProgress({});
        setCurrentIndexFile('');
        setCurrentIndexFileKey('');
        setCurrentIndexStage('');
        setOverallIndexPercent(0);
        setIndexingStartedAt(null);
        setCompletedIndexingElapsedMs(0);
        setFinalIndexingElapsedSeconds(null);
        setIsStopRequested(false);
        stopRequestedRef.current = false;
        setDeletingFile(null);
        setConfirmDelete(null);
        setDeletePopoverPosition(null);
        setConfirmDeleteAll(false);
        setDeletingAll(false);
        setFileSearch('');
        setSelectedFileIds(new Set());
        downloadControllerRef.current?.abort();
        downloadControllerRef.current = null;
        setDownloadLabel(null);
        setChunkViewFile(null);
        setChunks([]);
        setChunksLoading(false);
        setSelectedChunk(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    const handleClose = useCallback(() => {
        resetModalState();
        onClose();
    }, [onClose, resetModalState]);

    useEffect(() => {
        if (!isOpen) return;
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (confirmDelete) {
                setConfirmDelete(null);
                setDeletePopoverPosition(null);
                return;
            }
            if (confirmDeleteAll && !deletingAll) {
                setConfirmDeleteAll(false);
                return;
            }
            if (status !== 'uploading') handleClose();
        };
        window.addEventListener('keydown', handleEscape, true);
        return () => window.removeEventListener('keydown', handleEscape, true);
    }, [confirmDelete, confirmDeleteAll, deletingAll, handleClose, isOpen, status]);

    useEffect(() => {
        if (isOpen) resetModalState();
    }, [isOpen, resetModalState]);

    useEffect(() => {
        if (!currentIndexFileKey || status !== 'uploading') return;
        const frameId = window.requestAnimationFrame(() => {
            fileItemRefs.current[currentIndexFileKey]?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        });
        return () => window.cancelAnimationFrame(frameId);
    }, [currentIndexFileKey, status]);

    useEffect(() => {
        if (status !== 'uploading') return;
        setProgressClock(performance.now());
        const intervalId = window.setInterval(() => setProgressClock(performance.now()), 1000);
        return () => window.clearInterval(intervalId);
    }, [status]);

    const loadSavedFiles = useCallback(async () => {
        setFilesLoading(true);
        try {
            setSavedFiles(await getDocumentFiles());
            setSelectedFileIds(new Set());
        } catch {
            setSavedFiles([]);
            setSelectedFileIds(new Set());
        } finally {
            setFilesLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen && tab === 'files') loadSavedFiles();
    }, [isOpen, tab, loadSavedFiles]);

    useEffect(() => {
        if (!confirmDelete) return;
        const closeDeletePopover = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest(`[data-delete-popover="${CSS.escape(confirmDelete)}"]`)) {
                setConfirmDelete(null);
                setDeletePopoverPosition(null);
            }
        };
        const closeOnViewportChange = () => {
            setConfirmDelete(null);
            setDeletePopoverPosition(null);
        };
        document.addEventListener('mousedown', closeDeletePopover);
        window.addEventListener('resize', closeOnViewportChange);
        window.addEventListener('scroll', closeOnViewportChange, true);
        return () => {
            document.removeEventListener('mousedown', closeDeletePopover);
            window.removeEventListener('resize', closeOnViewportChange);
            window.removeEventListener('scroll', closeOnViewportChange, true);
        };
    }, [confirmDelete]);

    // 외부 드롭 파일 처리 (조건부 return 전에 선언)
    const addFilesRef = React.useRef<((files: File[]) => void) | null>(null);
    React.useEffect(() => {
        if (externalDropFiles.length > 0 && addFilesRef.current) {
            addFilesRef.current(externalDropFiles);
            onExternalDropHandled?.();
        }
    }, [externalDropFiles]);

    if (!isOpen) return null;

    const validateFile = (f: File): string | null => {
        const ext = '.' + getExt(f.name);
        if (!ACCEPTED_EXTENSIONS.includes(ext)) return t('documentModal.unsupportedFormat', {name: f.name});
        if (f.size > 50 * 1024 * 1024) return t('documentModal.fileTooLarge', {name: f.name});
        return null;
    };

    const addFiles = (incoming: File[]) => {
        if (status === 'uploading') return;
        const errors: string[] = [];
        const valid: File[] = [];
        for (const f of incoming) {
            const err = validateFile(f);
            if (err) errors.push(err);
            else if (!files.some(x => x.name === f.name && x.size === f.size)) valid.push(f);
        }
        if (errors.length) { setMessage(errors.join(' / ')); setStatus('error'); }
        else { setStatus('idle'); setMessage(''); }
        if (valid.length) setFiles(prev => [...prev, ...valid]);
    };
    addFilesRef.current = addFiles;

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (status === 'uploading') return;
        addFiles(Array.from(e.dataTransfer.files));
    };

    const removeFile = (idx: number) => {
        const file = files[idx];
        if (!file) return;
        const fileKey = getFileKey(file);
        const progress = indexFileProgress[fileKey];
        if (progress?.state === 'done') return;

        const remainingFiles = files.filter((_, i) => i !== idx);
        setFiles(remainingFiles);
        setIndexFileProgress(prev => {
            const {[fileKey]: _removed, ...remainingProgress} = prev;
            return remainingProgress;
        });

        if (status === 'stopped') {
            const hasRemainingStoppedFile = remainingFiles.some(remainingFile =>
                indexFileProgress[getFileKey(remainingFile)]?.state === 'stopped'
            );
            setIndexProgress(previous => ({
                done: Math.min(previous.done, remainingFiles.length),
                total: remainingFiles.length,
            }));
            if (!hasRemainingStoppedFile) setStatus('done');
            return;
        }

        setStatus('idle');
        setMessage('');
    };

    const reset = () => {
        setFiles([]);
        setStatus('idle');
        setMessage('');
        setQuestion('');
        setMaxChars(0);
        setIndexProgress({ done: 0, total: 0 });
        setIndexFileProgress({});
        setCurrentIndexFile('');
        setCurrentIndexFileKey('');
        setCurrentIndexStage('');
        setOverallIndexPercent(0);
        setIndexingStartedAt(null);
        setCompletedIndexingElapsedMs(0);
        setFinalIndexingElapsedSeconds(null);
        setIsStopRequested(false);
        stopRequestedRef.current = false;
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const switchTab = (t: Tab) => {
        if (status === 'uploading') return;
        setTab(t);
        reset();
        setConfirmDelete(null);
        setFileSearch('');
        setChunkViewFile(null);
        setChunks([]);
        setSelectedChunk(null);
    };

    const loadChunks = async (file: SavedFile) => {
        setChunkViewFile(file);
        setSelectedChunk(null);
        setChunksLoading(true);
        try {
            const res = await fetch(`/api/document/files/${encodeURIComponent(file.file_id)}/chunks`);
            const data = await res.json();
            setChunks(data.chunks || []);
        } catch {
            setChunks([]);
        } finally {
            setChunksLoading(false);
        }
    };

    const indexFileWithProgress = async (file: File, fileIndex: number, completedBefore: number, totalFiles: number) => {
        const fileKey = getFileKey(file);
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/api/document/index-progress', {method: 'POST', body: formData});
        if (!response.ok || !response.body) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.detail || `${file.name} 인덱싱 실패`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: IndexProgressEvent | null = null;

        const handleEvent = (event: IndexProgressEvent) => {
            if (event.type === 'error') throw new Error(event.message || `${file.name} 인덱싱 실패`);
            if (event.type === 'result') {
                result = event;
                return;
            }
            const percent = event.percent ?? 0;
            const eventStage = event.stage || 'checking_duplicate';
            const totalChunks = event.total_chunks ?? event.chunks;
            // 문서마다 임베딩과 Elasticsearch 저장이 배치 단위로 번갈아 발생한다.
            // 청크 수가 확정된 뒤에는 단계 문구를 고정해 숫자 갱신 시 깜빡이지 않게 한다.
            const stage = totalChunks !== undefined ? 'indexing_chunks' : eventStage;
            setCurrentIndexStage(stage);
            setOverallIndexPercent(Math.round(((completedBefore + fileIndex + percent / 100) / totalFiles) * 100));
            setIndexFileProgress(prev => {
                const previous = prev[fileKey];
                return {
                    ...prev,
                    [fileKey]: {
                        state: 'processing',
                        stage,
                        percent,
                        totalChunks: totalChunks ?? previous?.totalChunks,
                        embeddedChunks: event.embedded_chunks ?? previous?.embeddedChunks,
                        indexedChunks: event.indexed_chunks ?? previous?.indexedChunks,
                        startedAt: previous?.startedAt,
                    },
                };
            });
        };

        while (true) {
            const {done, value} = await reader.read();
            buffer += decoder.decode(value, {stream: !done});
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.trim()) handleEvent(JSON.parse(line));
            }
            if (done) break;
        }
        if (buffer.trim()) handleEvent(JSON.parse(buffer));
        if (!result) throw new Error(`${file.name} 인덱싱 결과를 받지 못했습니다.`);
        return result as IndexProgressEvent;
    };

    const handleSubmit = async () => {
        if (files.length === 0) return;
        if (tab === 'query' && !question.trim()) { questionRef.current?.focus(); return; }
        setStatus('uploading');
        invalidateDocumentFiles();
        setMessage('');
        setIsStopRequested(false);
        stopRequestedRef.current = false;

        try {
            if (tab === 'query') {
                const articles: ArticleAttachment[] = [];
                for (const file of files) {
                    const formData = new FormData();
                    formData.append('file', file);
                    if (maxChars > 0) formData.append('max_chars', String(maxChars));
                    const res = await fetch('/api/document/parse', {method: 'POST', body: formData});
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.detail || `${file.name} 파싱 실패`);
                    articles.push({
                        title: file.name,
                        url: `manual://${file.name}`,
                        content: data.content,
                        source: `문서(${getExt(file.name).toUpperCase()})`,
                        indexed_at: new Date().toISOString(),
                    });
                }
                onQueryWithDoc(articles, question.trim());
                handleClose();
            } else {
                const isResuming = status === 'stopped';
                const runStartedAt = performance.now();
                const elapsedBefore = isResuming ? completedIndexingElapsedMs : 0;
                if (!isResuming) setCompletedIndexingElapsedMs(0);
                setFinalIndexingElapsedSeconds(null);
                setIndexingStartedAt(runStartedAt);
                const filesToIndex = isResuming
                    ? files.filter(file => indexFileProgress[getFileKey(file)]?.state === 'stopped')
                    : files;
                const completedBefore = files.length - filesToIndex.length;
                let totalChunks = 0;
                let skipped = 0;
                let completedFiles = completedBefore;
                setIndexProgress({ done: completedBefore, total: files.length });
                setOverallIndexPercent(Math.round((completedBefore / files.length) * 100));
                setIndexFileProgress(prev => isResuming
                    ? Object.fromEntries(Object.entries(prev).map(([fileKey, progress]) => [
                        fileKey,
                        progress.state === 'stopped' ? {state: 'pending', stage: 'pending', percent: 0} : progress,
                    ]))
                    : Object.fromEntries(files.map(file => [
                        getFileKey(file),
                        {state: 'pending', stage: 'pending', percent: 0},
                    ]))
                );
                for (let i = 0; i < filesToIndex.length; i++) {
                    const file = filesToIndex[i];
                    const activeFileKey = getFileKey(file);
                    const startedAt = performance.now();
                    setCurrentIndexFile(file.name);
                    setCurrentIndexFileKey(activeFileKey);
                    setCurrentIndexStage('uploading');
                    setIndexFileProgress(prev => ({
                        ...prev,
                        [activeFileKey]: {state: 'processing', stage: 'uploading', percent: 0, startedAt},
                    }));
                    const data = await indexFileWithProgress(file, i, completedBefore, files.length);
                    if (data.already_exists) {
                        skipped++;
                    } else {
                        totalChunks += data.chunks ?? 1;
                    }
                    setIndexFileProgress(prev => ({
                        ...prev,
                        [activeFileKey]: {
                            state: data.already_exists ? 'skipped' : 'done',
                            stage: data.already_exists ? 'duplicate' : 'completed',
                            percent: 100,
                            totalChunks: data.total_chunks ?? data.chunks,
                            embeddedChunks: data.embedded_chunks,
                            indexedChunks: data.indexed_chunks ?? data.chunks,
                            startedAt,
                            elapsedSeconds: Math.max(1, Math.round((performance.now() - startedAt) / 1000)),
                        },
                    }));
                    setIndexProgress({ done: completedBefore + i + 1, total: files.length });
                    setOverallIndexPercent(Math.round(((completedBefore + i + 1) / files.length) * 100));
                    completedFiles = completedBefore + i + 1;
                    if (stopRequestedRef.current) break;
                }
                const stopped = stopRequestedRef.current;
                if (stopped) {
                    setCompletedIndexingElapsedMs(previous => previous + performance.now() - runStartedAt);
                    setIndexingStartedAt(null);
                } else {
                    setFinalIndexingElapsedSeconds(Math.max(1, Math.round((elapsedBefore + performance.now() - runStartedAt) / 1000)));
                }
                setStatus(stopped ? 'stopped' : 'done');
                setCurrentIndexFile('');
                setCurrentIndexFileKey('');
                setCurrentIndexStage('completed');
                const doneCount = files.length - skipped;
                if (stopped) {
                    setMessage(t('documentModal.indexingStopped', {
                        done: completedFiles,
                        stopped: files.length - completedFiles,
                    }));
                } else if (skipped === files.length) {
                    setMessage(t('documentModal.alreadyIndexed'));
                } else if (skipped > 0) {
                    setMessage(t('documentModal.indexDoneSkipped', {files: doneCount, chunks: totalChunks, skipped}));
                } else {
                    setMessage(t('documentModal.indexDone', {files: doneCount, chunks: totalChunks}));
                }
            }
        } catch (error: unknown) {
            setStatus('error');
            const message = error instanceof Error && error.message ? error.message : t('documentModal.error');
            setMessage(message);
            setIndexFileProgress(prev => {
                const activeEntry = Object.entries(prev).find(([, progress]) => progress.state === 'processing');
                if (!activeEntry) return prev;
                return {
                    ...prev,
                    [activeEntry[0]]: {...activeEntry[1], state: 'error'},
                };
            });
        }
    };

    const handleStopIndexing = () => {
        if (stopRequestedRef.current) return;
        stopRequestedRef.current = true;
        setIsStopRequested(true);
        setIndexFileProgress(prev => Object.fromEntries(Object.entries(prev).map(([fileKey, progress]) => [
            fileKey,
            progress.state === 'pending'
                ? {...progress, state: 'stopped', stage: 'stopped'}
                : progress,
        ])));
    };

    const downloadFile = async (url: string, options: RequestInit, filename: string, label: string) => {
        if (downloadControllerRef.current) return;

        const controller = new AbortController();
        downloadControllerRef.current = controller;
        setDownloadLabel(label);
        try {
            const response = await fetch(url, {...options, signal: controller.signal});
            if (!response.ok) throw new Error(t('documentModal.error'));

            const downloadUrl = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            const message = error instanceof Error && error.message ? error.message : t('documentModal.error');
            toast.error(message);
        } finally {
            if (downloadControllerRef.current === controller) {
                downloadControllerRef.current = null;
                setDownloadLabel(null);
            }
        }
    };

    const handleDownload = (fileId: string, filename: string) => {
        void downloadFile(
            `/api/document/files/${encodeURIComponent(fileId)}`,
            {method: 'GET'},
            filename,
            filename,
        );
    };

    const toSavedDocumentAttachment = (file: SavedFile): ArticleAttachment => ({
        title: file.filename,
        url: `file://${file.file_id}`,
        content: `[인덱싱된 문서, ${file.file_id}]`,
        source: `문서(${file.file_ext.toUpperCase()})`,
        indexed_at: file.indexed_at,
        file_id: file.file_id,
        source_type: file.source_type || 'document',
    });

    const toggleSelectedFile = (fileId: string) => setSelectedFileIds(previous => {
        const next = new Set(previous);
        next.has(fileId) ? next.delete(fileId) : next.add(fileId);
        return next;
    });

    const handleSelectedDownload = async () => {
        const fileIds = savedFiles
            .filter(file => selectedFileIds.has(file.file_id) && file.source_type !== 'web')
            .map(file => file.file_id);
        if (fileIds.length === 0) return;

        void downloadFile(
            '/api/document/files/download', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({file_ids: fileIds}),
            },
            `saved-documents-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.zip`,
            t('documentModal.savedFileCount', {count: fileIds.length}),
        );
    };

    const handleSelectedDelete = () => {
        if (selectedFileIds.size > 0) setConfirmDeleteAll(true);
    };

    const handleDelete = async (file: SavedFile) => {
        setDeletingFile(file.file_id);
        try {
            const res = await fetch(`/api/document/files/${encodeURIComponent(file.file_id)}`, {method: 'DELETE'});
            if (!res.ok) throw new Error(t('documentModal.deleteError'));
            setSavedFiles(prev => prev.filter(savedFile => savedFile.file_id !== file.file_id));
            removeCachedDocumentFiles([file.file_id]);
            onDetachSavedDocuments?.([file.file_id]);
        } catch (error: unknown) {
            const message = error instanceof Error && error.message ? error.message : t('documentModal.deleteError');
            toast.error(message);
        } finally {
            setDeletingFile(null);
            setConfirmDelete(null);
            setDeletePopoverPosition(null);
        }
    };

    const openWebSource = (url?: string) => {
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
    };

    const openDeletePopover = (fileId: string, trigger: HTMLButtonElement) => {
        const triggerRect = trigger.getBoundingClientRect();
        const hasSpaceAbove = triggerRect.top - DELETE_POPOVER_GAP - DELETE_POPOVER_HEIGHT >= VIEWPORT_MARGIN;
        const placement: DeletePopoverPosition['placement'] = hasSpaceAbove ? 'top' : 'bottom';
        const top = placement === 'bottom'
            ? triggerRect.bottom + DELETE_POPOVER_GAP
            : triggerRect.top - DELETE_POPOVER_HEIGHT - DELETE_POPOVER_GAP;
        const left = Math.min(
            window.innerWidth - DELETE_POPOVER_WIDTH - VIEWPORT_MARGIN,
            Math.max(VIEWPORT_MARGIN, triggerRect.right - DELETE_POPOVER_WIDTH),
        );

        setDeletePopoverPosition({top, left, placement});
        setConfirmDelete(fileId);
    };

    const handleDeleteAll = async () => {
        const selectedFiles = savedFiles.filter(file => selectedFileIds.has(file.file_id));
        if (selectedFiles.length === 0) {
            setConfirmDeleteAll(false);
            return;
        }
        setDeletingAll(true);
        try {
            const responses = await Promise.all(selectedFiles.map(file =>
                fetch(`/api/document/files/${encodeURIComponent(file.file_id)}`, {method: 'DELETE'}),
            ));
            if (responses.some(response => !response.ok)) throw new Error(t('documentModal.deleteAllError'));
            const deletedIds = selectedFiles.map(file => file.file_id);
            removeCachedDocumentFiles(deletedIds);
            onDetachSavedDocuments?.(deletedIds);
            setSavedFiles(previous => previous.filter(file => !selectedFileIds.has(file.file_id)));
            setSelectedFileIds(new Set());
            setConfirmDeleteAll(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t('documentModal.deleteAllError'));
        } finally {
            setDeletingAll(false);
        }
    };

    const hasStoppedFiles = files.some(file => indexFileProgress[getFileKey(file)]?.state === 'stopped');
    const hasPendingFiles = files.some(file => indexFileProgress[getFileKey(file)]?.state === 'pending');
    const canSubmit = files.length > 0 && status !== 'uploading' && status !== 'done' &&
        (status !== 'stopped' || hasStoppedFiles) &&
        (tab === 'index' || question.trim().length > 0);
    const hasFiles = files.length > 0;
    const getIndexStageLabel = (stage: string) => t(`documentModal.indexStages.${stage}`, {
        defaultValue: INDEX_STAGE_FALLBACKS[stage] || stage,
    });
    const getIndexStateLabel = (state: IndexFileState) => t(`documentModal.indexStates.${state}`, {
        defaultValue: INDEX_STATE_FALLBACKS[state],
    });
    const getChunkTypeLabel = (type: string) => t(`documentModal.chunkTypes.${type}`, {
        defaultValue: CHUNK_TYPE_FALLBACKS[type] || type,
    });

    return (
        <ModalOverlay className={`dm-overlay${isDragging ? ' dragging' : ''}`}
             onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (status !== 'uploading') setIsDragging(true); }}
             onDragEnter={e => { e.preventDefault(); e.stopPropagation(); if (status !== 'uploading') setIsDragging(true); }}
             onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
             onDrop={e => {
                 e.preventDefault();
                 e.stopPropagation();
                 setIsDragging(false);
                 if (status === 'uploading') return;
                 const files = Array.from(e.dataTransfer.files);
                 if (files.length > 0 && addFilesRef.current) addFilesRef.current(files);
             }}>
            <div className="dm-modal" onClick={e => e.stopPropagation()}>

                {/* 헤더 */}
                <div className="dm-header">
                    <div className="dm-header-left">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                        <span>{t('inputMenu.documents')}</span>
                    </div>
                    <button className="dm-close" onClick={handleClose} disabled={status === 'uploading'}>×</button>
                </div>

                {/* 탭 */}
                <div className="dm-tabs">
                    <button className={`dm-tab ${tab === 'index' ? 'active' : ''}`} onClick={() => switchTab('index')} disabled={status === 'uploading'}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <ellipse cx="12" cy="5" rx="9" ry="3"/>
                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                        </svg>
                        {t('documentModal.indexTab')}
                    </button>
                    <button className={`dm-tab ${tab === 'query' ? 'active' : ''}`} onClick={() => switchTab('query')} disabled={status === 'uploading'}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        {t('documentModal.queryTab')}
                    </button>
                    <button className={`dm-tab ${tab === 'files' ? 'active' : ''}`} onClick={() => switchTab('files')} disabled={status === 'uploading'}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        {t('documentModal.filesTab')}
                    </button>
                </div>

                {/* 모드 설명 */}
                {tab !== 'files' && (
                    <div className="dm-mode-desc">
                        <span className={`dm-mode-badge ${tab}`}>
                            {tab === 'index' ? t('documentModal.esBadge') : t('documentModal.queryBadge')}
                        </span>
                        {tab === 'index'
                            ? t('documentModal.indexDesc')
                            : t('documentModal.queryDesc')}
                    </div>
                )}

                {/* ── 탭 바디 ── */}

                {/* 인덱싱 / 즉시질의 */}
                {tab !== 'files' && (
                    <div className={`dm-body dm-body-${tab}`}>
                        {!hasFiles ? (
                            <div
                                className={`dm-dropzone ${isDragging ? 'dragging' : ''}`}
                                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={ACCEPTED_EXTENSIONS.join(',')}
                                    multiple
                                    style={{display: 'none'}}
                                    onChange={e => { if (e.target.files) addFiles(Array.from(e.target.files)); }}
                                />
                                <div className="dm-dropzone-icon">{isDragging ? '📂' : '📁'}</div>
                                <div className="dm-dropzone-text">
                                    {isDragging ? t('documentModal.dropHere') : t('documentModal.dropText')}
                                </div>
                                <div className="dm-dropzone-hint">
                                    {ACCEPTED_EXTENSIONS.join(' · ')} · {t('documentModal.maxSize')}
                                </div>
                            </div>
                        ) : (
                            <div className="dm-file-list">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={ACCEPTED_EXTENSIONS.join(',')}
                                    multiple
                                    style={{display: 'none'}}
                                    onChange={e => { if (e.target.files) addFiles(Array.from(e.target.files)); }}
                                />
                                {files.map((f, i) => {
                                    const progress = indexFileProgress[getFileKey(f)];
                                    return (
                                        <div
                                            key={getFileKey(f)}
                                            ref={element => { fileItemRefs.current[getFileKey(f)] = element; }}
                                            className={`dm-file-item${progress ? ` is-${progress.state}` : ''}`}
                                        >
                                            <span className="dm-file-icon-sm">{getIcon(f.name)}</span>
                                            <div className="dm-file-meta">
                                                <div className="dm-file-name">{f.name}</div>
                                                <div className="dm-file-size">
                                                    {formatSize(f.size)}
                                                    {progress?.state === 'processing' && (
                                                        <IndexStageText label={` · ${getIndexStageLabel(progress.stage)}`}/>
                                                    )}
                                                </div>
                                                {progress?.totalChunks !== undefined && (
                                                    <div className="dm-file-index-stats">
                                                        {t('documentModal.indexFileStats', {
                                                            total: progress.totalChunks,
                                                            indexed: progress.indexedChunks ?? 0,
                                                        })}
                                                    </div>
                                                )}
                                                {progress?.state === 'processing' && (
                                                    <div className="dm-file-progress-track">
                                                        <span style={{width: `${progress.percent}%`}}/>
                                                    </div>
                                                )}
                                            </div>
                                            {progress && (
                                                <div className="dm-file-completion">
                                                    {progress.state === 'done' && progress.elapsedSeconds !== undefined && (
                                                        <span className="dm-file-index-duration">
                                                            {t('documentModal.indexDuration', {seconds: progress.elapsedSeconds})}
                                                        </span>
                                                    )}
                                                    {progress.state === 'processing' && progress.startedAt !== undefined && (
                                                        <span className="dm-file-index-duration">
                                                            {t('documentModal.indexingElapsed', {
                                                                seconds: Math.max(0, Math.floor((progressClock - progress.startedAt) / 1000)),
                                                            })}
                                                        </span>
                                                    )}
                                                    <span className={`dm-file-state dm-file-state-${progress.state}`}>
                                                        {progress.state === 'processing'
                                                            ? `${progress.percent}%`
                                                            : getIndexStateLabel(progress.state)}
                                                    </span>
                                                </div>
                                            )}
                                            {status !== 'uploading' && progress?.state !== 'done' && (
                                                <button className="dm-file-remove" onClick={() => removeFile(i)}>
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                                {status !== 'uploading' && status !== 'done' && (
                                    <button className="dm-add-more" onClick={() => fileInputRef.current?.click()}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <line x1="12" y1="5" x2="12" y2="19"/>
                                            <line x1="5" y1="12" x2="19" y2="12"/>
                                        </svg>
                                        {t('documentModal.addMore')}
                                    </button>
                                )}
                            </div>
                        )}

                        {/* 즉시 질의 입력 */}
                        {tab === 'query' && (
                            <div className="dm-question-wrap">
                                <div className="dm-question-options">
                                    <label className="dm-question-label">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                        </svg>
                                        {t('documentModal.question')}
                                    </label>
                                    <div className="dm-chars-wrap">
                                        <span className="dm-chars-label">{t('documentModal.textRange')}</span>
                                        <CustomSelect
                                            options={[
                                                { value: '0', label: t('documentModal.rangeAll') },
                                                { value: '5000', label: '5,000자' },
                                                { value: '10000', label: '10,000자' },
                                                { value: '20000', label: '20,000자' },
                                                { value: '50000', label: '50,000자' },
                                            ]}
                                            value={String(maxChars)}
                                            onChange={v => setMaxChars(Number(v))}
                                            className="dm-chars-select"
                                            triggerStyle={{ borderRadius: '6px', fontSize: '12px', padding: '4px 8px', background: 'var(--surface)' }}
                                            dropdownBackground="var(--surface)"
                                            portal
                                        />
                                    </div>
                                </div>
                                <textarea
                                    ref={questionRef}
                                    className="dm-question-input"
                                    placeholder={t('documentModal.questionPlaceholder')}
                                    value={question}
                                    onChange={e => setQuestion(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey && canSubmit) {
                                            e.preventDefault();
                                            handleSubmit();
                                        }
                                    }}
                                    rows={3}
                                />
                            </div>
                        )}

                        {status === 'uploading' && tab === 'index' && (
                            <div className="dm-index-progress" role="status" aria-live="polite">
                                <div className="dm-index-progress-header">
                                    <div className="dm-index-progress-current">
                                        <div className="dm-spinner"/>
                                        <div>
                                            <strong>{currentIndexFile}</strong>
                                            <IndexStageText label={getIndexStageLabel(currentIndexStage)}/>
                                        </div>
                                    </div>
                                    <div className="dm-index-progress-total">
                                        {indexingStartedAt !== null && (
                                            <span>{t('documentModal.indexingTotalElapsed', {
                                                seconds: Math.max(0, Math.floor((completedIndexingElapsedMs + progressClock - indexingStartedAt) / 1000)),
                                            })}</span>
                                        )}
                                        <strong>{overallIndexPercent}%</strong>
                                    </div>
                                </div>
                                <div className="dm-index-progress-track">
                                    <span style={{width: `${overallIndexPercent}%`}}/>
                                </div>
                                <div className="dm-index-progress-footer">
                                    {indexFileProgress[currentIndexFileKey]?.totalChunks !== undefined && (
                                        <div className="dm-index-progress-chunks">
                                        {t('documentModal.indexFileStats', {
                                            total: indexFileProgress[currentIndexFileKey].totalChunks,
                                            indexed: indexFileProgress[currentIndexFileKey].indexedChunks ?? 0,
                                        })}
                                        </div>
                                    )}
                                    <div className="dm-index-progress-summary">
                                        {t('documentModal.indexingProgress', {
                                            done: indexProgress.done,
                                            total: indexProgress.total,
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                        {status === 'uploading' && tab === 'query' && (
                            <div className="dm-status uploading">
                                <div className="dm-spinner"/>
                                {t('documentModal.parsingFiles', {count: files.length})}
                            </div>
                        )}
                        {status === 'done' && (
                            <div className="dm-status done">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5">
                                    <polyline points="20 6 9 17 4 12"/>
                                </svg>
                                {message}
                                {finalIndexingElapsedSeconds !== null && (
                                    <span className="dm-status-elapsed">
                                        {t('documentModal.indexingTotalElapsed', {seconds: finalIndexingElapsedSeconds})}
                                    </span>
                                )}
                            </div>
                        )}
                        {status === 'stopped' && (
                            <div className="dm-status stopped">
                                {message}
                                <span className="dm-status-elapsed">
                                    {t('documentModal.indexingTotalElapsed', {
                                        seconds: Math.max(1, Math.round(completedIndexingElapsedMs / 1000)),
                                    })}
                                </span>
                            </div>
                        )}
                        {status === 'error' && (
                            <div className="dm-status error">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" y1="8" x2="12" y2="12"/>
                                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                                {message}
                            </div>
                        )}
                        {(status === 'done' || status === 'stopped') && tab === 'index' && (
                            <button className="dm-btn-secondary" onClick={reset} style={{marginTop: '4px'}}>
                                {t('documentModal.uploadMore')}
                            </button>
                        )}
                    </div>
                )}

                {/* 저장된 문서 탭 */}
                {tab === 'files' && (
                    <div className="dm-body">
                        {/* 청크 뷰어 패널 */}
                        {chunkViewFile ? (
                            <div className="dm-chunk-view">
                                {/* 뒤로가기 헤더 */}
                                <div className="dm-chunk-header">
                                    <button
                                        type="button"
                                        className="dm-back-button"
                                        onClick={() => { setChunkViewFile(null); setSelectedChunk(null); setChunks([]); }}
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="15 18 9 12 15 6"/>
                                        </svg>
                                        {t('documentModal.backToList')}
                                    </button>
                                    <span className="dm-chunk-filename">{chunkViewFile.filename}</span>
                                    <span className="dm-count-badge">{t('documentModal.chunkCount', {count: chunkViewFile.chunk_count})}</span>
                                </div>

                                <div className="dm-chunk-layout">
                                    {/* 청크 리스트 */}
                                    <div className="dm-chunk-list">
                                        {chunksLoading ? (
                                            <div className="dm-status uploading"><div className="dm-spinner"/>{t('documentModal.chunkLoading')}</div>
                                        ) : chunks.map((c) => (
                                            <button
                                                type="button"
                                                key={c.chunk_index}
                                                onClick={() => setSelectedChunk(c)}
                                                className={`dm-chunk-item${selectedChunk?.chunk_index === c.chunk_index ? ' selected' : ''}`}
                                            >
                                                <span className="dm-chunk-number">#{c.chunk_index + 1}</span>
                                                <span className="dm-chunk-summary">
                                                    <span>{getChunkTypeLabel(c.chunk_type)}</span>
                                                    {c.page_number && <span>p.{c.page_number}</span>}
                                                    <span>{t('documentModal.charCount', {count: c.content_length})}</span>
                                                </span>
                                                <span className="dm-chunk-preview">{c.content.replace(/\s+/g, ' ').trim()}</span>
                                            </button>
                                        ))}
                                    </div>

                                    {/* 청크 내용 */}
                                    <div className="dm-chunk-content">
                                        {selectedChunk ? (
                                            <>
                                                <div className="dm-chunk-meta">
                                                    <span className="dm-chunk-type-badge">
                                                        #{selectedChunk.chunk_index + 1} · {getChunkTypeLabel(selectedChunk.chunk_type)}
                                                    </span>
                                                    {selectedChunk.page_number && (
                                                        <span className="dm-meta-badge">
                                                            p.{selectedChunk.page_number}
                                                        </span>
                                                    )}
                                                    <span className="dm-meta-badge">
                                                        {t('documentModal.charCount', {count: selectedChunk.content_length})}
                                                    </span>
                                                </div>
                                                <pre className="dm-chunk-text">
                                                    {selectedChunk.content}
                                                </pre>
                                            </>
                                        ) : (
                                            <div className="dm-chunk-empty">
                                                {t('documentModal.selectChunk')}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* 검색바 */}
                                <div className="dm-file-search-wrap">
                                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                                    </svg>
                                    <input
                                        className="dm-file-search"
                                        placeholder={t('common:search')}
                                        aria-label={t('documentModal.fileSearchPlaceholder')}
                                        value={fileSearch}
                                        onChange={e => setFileSearch(e.target.value)}
                                        onCompositionEnd={e => setFileSearch((e.target as HTMLInputElement).value)}
                                    />
                                    {fileSearch && (
                                        <button
                                            type="button"
                                            className="dm-file-search-clear"
                                            onClick={() => setFileSearch('')}
                                            aria-label={t('googleWorkspace.clearSearch')}
                                        >
                                            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="18" y1="6" x2="6" y2="18"/>
                                                <line x1="6" y1="6" x2="18" y2="18"/>
                                            </svg>
                                        </button>
                                    )}
                                </div>
                                <div className="dm-files-summary">
                                    {savedFiles.length > 0 && (
                                        <div className="dm-files-bulk-actions">
                                            <label className="dm-select-all" aria-label={t('documentModal.downloadAll')}>
                                                <input type="checkbox" checked={selectedFileIds.size === savedFiles.length} onChange={() => setSelectedFileIds(selectedFileIds.size === savedFiles.length ? new Set() : new Set(savedFiles.map(file => file.file_id)))}/>
                                            </label>
                                            <button type="button" className="dm-bulk-action-btn icon-only" aria-label={t('documentModal.download')} onClick={handleSelectedDownload} disabled={!!downloadLabel || !savedFiles.some(file => selectedFileIds.has(file.file_id) && file.source_type !== 'web')}>
                                                <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                    <polyline points="7 10 12 15 17 10"/>
                                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                                </svg>
                                            </button>
                                            <button type="button" className="dm-bulk-action-btn icon-only danger" aria-label={t('documentModal.delete')} onClick={handleSelectedDelete} disabled={selectedFileIds.size === 0}>
                                                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <polyline points="3 6 5 6 21 6"/>
                                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                                    <path d="M10 11v6M14 11v6"/>
                                                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                                </svg>
                                            </button>
                                            {selectedFileIds.size > 0 && <span className="dm-selected-count">{t('googleWorkspace.selectedCount', {count: selectedFileIds.size})}</span>}
                                        </div>
                                    )}
                                    <span>{t('documentModal.savedFileCount', {count: savedFiles.length})}</span>
                                </div>
                                {filesLoading ? (
                                    <div className="dm-status uploading">
                                        <div className="dm-spinner"/>
                                        {t('documentModal.loadingFiles')}
                                    </div>
                                ) : (() => {
                                    const needle = fileSearch.trim().normalize('NFC').toLowerCase();
                                    const filtered = needle
                                        ? savedFiles.filter(f => f.filename.normalize('NFC').toLowerCase().includes(needle))
                                        : savedFiles;
                                    if (savedFiles.length === 0) {
                                        return (
                                            <div className="dm-empty">
                                                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5">
                                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                                </svg>
                                                <span>{t('documentModal.noSavedFiles')}</span>
                                            </div>
                                        );
                                    }
                                    if (filtered.length === 0) {
                                        return (
                                            <div className="dm-empty">
                                                <span>{t('documentModal.noSearchResults', {query: fileSearch})}</span>
                                            </div>
                                        );
                                    }
                                    return (
                                        <div className="dm-saved-list">
                                            {filtered.map((f) => (
                                                <div
                                                    key={f.file_id}
                                                    className="dm-saved-item"
                                                    onClick={() => loadChunks(f)}
                                                >
                                                    <label className="dm-item-select" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedFileIds.has(f.file_id)} onChange={() => toggleSelectedFile(f.file_id)}/></label>
                                                    <span className="dm-file-type-badge">{(f.source_type === 'web' ? 'WEB' : getExt(f.filename).toUpperCase()) || getIcon(f.filename)}</span>
                                                    <div className="dm-file-meta">
                                                        <div className="dm-file-name">{f.filename}</div>
                                                        <div className="dm-file-size">{formatSize(f.file_size)} · {t('documentModal.chunkCount', {count: f.chunk_count})} · {formatDate(f.indexed_at)}</div>
                                                    </div>
                                                    <div className="dm-saved-actions" onClick={e => e.stopPropagation()}>
                                                        <KnowledgeCollectionAttachSelect source={{source_type: 'document', source_id: f.file_id}} onCreateCollection={onClose}/>
                                                        <button
                                                            type="button"
                                                            className={`dm-action-btn icon-only attach${attachedDocumentIds.includes(f.file_id) ? ' active' : ''}`}
                                                            aria-label={t(attachedDocumentIds.includes(f.file_id) ? 'documentModal.detachFromChat' : 'documentModal.attachToChat')}
                                                            aria-pressed={attachedDocumentIds.includes(f.file_id)}
                                                            onClick={() => onToggleSavedDocument?.(toSavedDocumentAttachment(f))}
                                                        >
                                                            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                                                            </svg>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="dm-action-btn icon-only"
                                                            aria-label={t(f.source_type === 'web' ? 'documentModal.openWebPage' : 'documentModal.download')}
                                                            onClick={() => f.source_type === 'web' ? openWebSource(f.url) : handleDownload(f.file_id, f.filename)}
                                                            disabled={!!downloadLabel || (f.source_type === 'web' ? !f.url : !f.has_original)}
                                                        >
                                                            {f.source_type === 'web' ? (
                                                                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <path d="M14 3h7v7"/>
                                                                    <path d="m21 3-9 9"/>
                                                                    <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/>
                                                                </svg>
                                                            ) : (
                                                                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                                    <polyline points="7 10 12 15 17 10"/>
                                                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                                                </svg>
                                                            )}
                                                        </button>
                                                        <div className="dm-delete-wrap" data-delete-popover={f.file_id}>
                                                            <button
                                                                type="button"
                                                                className="dm-action-btn icon-only danger"
                                                                aria-label={t('documentModal.delete')}
                                                                onClick={event => openDeletePopover(f.file_id, event.currentTarget)}
                                                            >
                                                                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <polyline points="3 6 5 6 21 6"/>
                                                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                                                    <path d="M10 11v6M14 11v6"/>
                                                                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                                                </svg>
                                                            </button>
                                                            {confirmDelete === f.file_id && deletePopoverPosition && createPortal(
                                                                <div
                                                                    className={`dm-delete-popover ${deletePopoverPosition.placement}`}
                                                                    data-delete-popover={f.file_id}
                                                                    role="dialog"
                                                                    aria-label={t('documentModal.confirmDelete')}
                                                                    style={{
                                                                        top: deletePopoverPosition.top,
                                                                        left: deletePopoverPosition.left,
                                                                    }}
                                                                >
                                                                    <p>{t('documentModal.confirmDelete')}</p>
                                                                    <div className="dm-delete-popover-actions">
                                                                        <button
                                                                            className="dm-action-btn"
                                                                            onClick={() => {
                                                                                setConfirmDelete(null);
                                                                                setDeletePopoverPosition(null);
                                                                            }}
                                                                        >
                                                                            {t('documentModal.cancel')}
                                                                        </button>
                                                                        <button
                                                                            className="dm-action-btn danger filled"
                                                                            onClick={() => handleDelete(f)}
                                                                            disabled={deletingFile === f.file_id}
                                                                        >
                                                                            {deletingFile === f.file_id ? <div className="dm-spinner sm"/> : t('documentModal.delete')}
                                                                        </button>
                                                                    </div>
                                                                </div>,
                                                                document.body,
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </>
                        )}
                    </div>
                )}

                {/* 푸터 */}
                {tab !== 'files' && (
                    <div className="dm-footer">
                        <>
                            {status === 'uploading' && tab === 'index' ? (
                                <button className="dm-btn-cancel" onClick={handleStopIndexing} disabled={isStopRequested || !hasPendingFiles}>
                                    {isStopRequested ? t('documentModal.stopRequested') : t('documentModal.stopIndexing')}
                                </button>
                            ) : (
                                <button className="dm-btn-cancel" onClick={handleClose} disabled={status === 'uploading'}>{t('documentModal.cancel')}</button>
                            )}
                            <button className="dm-btn-submit" onClick={handleSubmit} disabled={!canSubmit}>
                                {status === 'uploading' ? (
                                    <><div className="dm-spinner sm"/>{t('documentModal.processing')}</>
                                ) : tab === 'index' ? (
                                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <ellipse cx="12" cy="5" rx="9" ry="3"/>
                                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                                    </svg>{status === 'stopped' ? t('documentModal.resumeIndexing') : t('documentModal.startIndex')}</>
                                ) : (
                                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="22" y1="2" x2="11" y2="13"/>
                                        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                                    </svg>{t('documentModal.send')}</>
                                )}
                            </button>
                        </>
                    </div>
                )}
                {confirmDeleteAll && (
                    <ConfirmModal
                        title={t('documentModal.confirmDeleteSelected')}
                        description={t('documentModal.confirmDeleteSelectedDescription', {count: selectedFileIds.size})}
                        options={[
                            {label: t('documentModal.cancel'), value: 'cancel'},
                            {label: t('documentModal.delete'), value: 'delete', variant: 'danger'},
                        ]}
                        actionLayout="horizontal"
                        loading={deletingAll}
                        loadingValue="delete"
                        loadingLabel={t('documentModal.deletingAll')}
                        onClose={() => setConfirmDeleteAll(false)}
                        onSelect={value => {
                            if (value === 'delete') void handleDeleteAll();
                            else setConfirmDeleteAll(false);
                        }}
                    />
                )}
                {downloadLabel && (
                    <div className="dm-download-overlay" role="status" aria-live="polite">
                        <span className="dm-download-spinner" aria-hidden="true"/>
                        <strong>{t('googleWorkspace.preparingDownload')}</strong>
                        <span>{t('googleWorkspace.downloadingFile')}</span>
                        <small>{downloadLabel}</small>
                    </div>
                )}
            </div>
        </ModalOverlay>
    );
};

export default DocumentModal;
