import React, {useEffect, useRef, useState} from 'react';
import {Check, FileText, Heart, ImagePlus, Plus, Search, Upload, X, XCircle} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {SUPPORTED_LANGUAGES} from '../../i18n';
import {api} from '../../services/api';
import ImageViewer from '../ImageViewer/ImageViewer';
import CustomSelect from '../CustomSelect/CustomSelect';
import { getReasoningEnabled } from '../../utils/reasoning';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import {Tooltip} from '../common/Tooltip/Tooltip';
import type {Message} from '../../types';
import {getDocumentFiles} from '../../services/documentFiles';
import {translateBackendError} from '../../utils/apiError';
import './PdfModal.css';

// ── 타입 ────────────────────────────────────────────────────────────────────
interface Memo {
    id: string;
    title: string;
    content: string;
    updated_at?: string;
}

interface DocFile {
    file_id: string;
    filename: string;
    file_ext: string;
    chunk_count: number;
    indexed_at?: string;
    content?: string;
}

export interface PdfParticle {
    url: string;
    title: string;
    source: string;
    indexed_at: string;
    file_id?: string | null;
    content?: string;
}

export interface PdfParams {
    prompt: string;
    page_count: number;
    page_count_auto?: boolean;
    language: string;
    style: string;
    output_format?: 'pdf' | 'pptx';
    aspect_ratio?: 'auto' | 'widescreen' | 'a4';
    articles?: PdfParticle[];
    image_filenames?: string[];
}

interface PdfModalProps {
    onClose: () => void;
    onComplete: (answer: string, filename: string, convId: string, prompt: string, pdfParams: PdfParams, userTs: string) => void;
    convId: string;
    messages: Message[];
    initialParams?: PdfParams;
}

// ── 상수 ────────────────────────────────────────────────────────────────────
const STYLES = [
    {id: 'white', icon: Heart},
    {id: 'dark', icon: Heart},
];
type SourceTab = 'memo' | 'doc';
type PresentationOutputFormat = 'pdf' | 'pptx';
type PresentationAspectRatio = 'widescreen' | 'a4';
type PresentationOutputOption = 'pdf_a4' | 'pdf_widescreen' | 'pptx';
const PRESENTATION_DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'html', 'htm', 'md']);

const SelectionIcon: React.FC<{selected: boolean}> = ({selected}) =>
    selected ? <Check size={11} strokeWidth={2.5} aria-hidden/> : <Plus size={11} strokeWidth={2.2} aria-hidden/>;

// ── 커스텀 드롭다운 ──────────────────────────────────────────────────────────

// ── 파일 확장자 아이콘 색상 ──────────────────────────────────────────────────
const EXT_COLOR: Record<string, string> = {
    pdf: '#e53e3e', docx: '#2b6cb0', doc: '#2b6cb0',
    xlsx: '#276749', xls: '#276749', txt: '#718096', md: '#6b46c1',
};
const extColor = (ext: string) => EXT_COLOR[ext.toLowerCase().replace('.', '')] || '#718096';

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
const PdfModal: React.FC<PdfModalProps> = ({onClose, onComplete, convId, messages, initialParams}) => {
    const {t, i18n} = useTranslation('main');
    // 기본 설정
    const [prompt, setPrompt] = useState(initialParams?.prompt || '');
    const [pageCount, setPageCount] = useState(initialParams?.page_count || 8);
    const [pageCountAuto, setPageCountAuto] = useState(initialParams?.page_count_auto ?? true);
    const [language, setLanguage] = useState(
        initialParams?.language || i18n.language.split('-')[0],
    );
    const [selectedStyle, setSelectedStyle] = useState(initialParams?.style || 'white');
    const [outputFormat, setOutputFormat] = useState<PresentationOutputFormat>(initialParams?.output_format || 'pdf');
    const [aspectRatio, setAspectRatio] = useState<PresentationAspectRatio>(
        initialParams?.aspect_ratio === 'widescreen' || initialParams?.output_format === 'pptx' ? 'widescreen' : 'a4',
    );

    // 이미지
    const [images, setImages] = useState<File[]>([]);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const documentInputRef = useRef<HTMLInputElement>(null);
    const dragCountRef = useRef(0);
    const maxImages = pageCountAuto ? 20 : pageCount;

    // 소스 탭
    const [activeTab, setActiveTab] = useState<SourceTab>('memo');

    // 메모
    const [memos, setMemos] = useState<Memo[]>([]);
    const [memoKeyword, setMemoKeyword] = useState('');
    const [isLoadingMemo, setIsLoadingMemo] = useState(false);
    const [selectedMemos, setSelectedMemos] = useState<Map<string, Memo>>(new Map());
    const memoLoaded = useRef(false);

    // 문서
    const [docs, setDocs] = useState<DocFile[]>([]);
    const [docKeyword, setDocKeyword] = useState('');
    const [isLoadingDoc, setIsLoadingDoc] = useState(false);
    const [selectedDocs, setSelectedDocs] = useState<Map<string, DocFile>>(new Map());
    const docLoaded = useRef(false);
    const [isIndexingSource, setIsIndexingSource] = useState(false);
    const [sourceUploadProgress, setSourceUploadProgress] = useState<{completed: number; total: number} | null>(null);
    const [uploadedDocumentIds, setUploadedDocumentIds] = useState<Set<string>>(new Set());

    // 생성 진행
    const [isGenerating, setIsGenerating] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const [progress, setProgress] = useState(0);
    const [progressStep, setProgressStep] = useState(0);
    const [progressTotal, setProgressTotal] = useState(7);
    const [progressMsg, setProgressMsg] = useState('');
    const [progressElapsedSeconds, setProgressElapsedSeconds] = useState(0);

    // 생성 중 ESC 키 차단
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isGenerating) e.stopPropagation();
        };
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
    }, [isGenerating]);
    useEffect(() => {
        if (!isGenerating) {
            setProgressElapsedSeconds(0);
            return;
        }
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            setProgressElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [isGenerating]);
    useEffect(() => {
        if (!initialParams) return;

        const savedArticles: PdfParticle[] = initialParams.articles || [];

        // ── 메모 복원: memo:// URL에서 id 추출 후 API 1회 호출 ──
        const memoArticles = savedArticles.filter(a => a.url.startsWith('memo://'));
        if (memoArticles.length > 0) {
            const memoIds = memoArticles.map(a => a.url.replace('memo://', ''));
            api.listMemos(100).then(r => {
                const allMemos: Memo[] = r.memos || [];
                setMemos(allMemos);
                memoLoaded.current = true;
                const map = new Map<string, Memo>();
                allMemos.filter(m => memoIds.includes(m.id)).forEach(m => map.set(m.id, m));
                if (map.size > 0) setSelectedMemos(map);
            }).catch(() => {});
        }

        // ── 문서 복원: file_id 직접 사용 ──
        const docArticles = savedArticles.filter(a => a.url.startsWith('file://') && a.file_id);
        if (docArticles.length > 0) {
            getDocumentFiles().then(result => {
                const allDocs: DocFile[] = result;
                setDocs(allDocs);
                docLoaded.current = true;
                const fileIds = new Set(docArticles.map(a => a.file_id!));
                const map = new Map<string, DocFile>();
                allDocs.filter(d => fileIds.has(d.file_id)).forEach(d => map.set(d.file_id, d));
                // The direct-attachment restoration below can finish before
                // this request. Merge instead of replacing so the later
                // library response cannot erase already-restored attachments.
                if (map.size > 0) {
                    setSelectedDocs(current => new Map([...current, ...map]));
                }
            }).catch(() => {});
        }

        // 프레젠테이션 전용 첨부는 인덱스에 저장하지 않으므로, 저장된 원문 텍스트로 복원한다.
        // Always restore the attachment row. Older saved presentations may not
        // contain embedded text, but hiding the source entirely makes the edit
        // screen look as if the user never attached it.
        const attachmentArticles = savedArticles.filter(a => a.url.startsWith('attachment://'));
        if (attachmentArticles.length > 0) {
            const restoredAttachments = new Map<string, DocFile>();
            attachmentArticles.forEach((article, index) => {
                const fileId = article.file_id || article.url.replace('attachment://', '') || `restored-attachment-${index}`;
                restoredAttachments.set(fileId, {
                    file_id: fileId,
                    filename: article.title,
                    file_ext: article.source.match(/\(([^)]+)\)/)?.[1]?.toLowerCase() || '',
                    chunk_count: 0,
                    indexed_at: article.indexed_at,
                    content: article.content,
                });
            });
            setSelectedDocs(current => new Map([...current, ...restoredAttachments]));
            setUploadedDocumentIds(current => new Set([...current, ...restoredAttachments.keys()]));
        }

        // ── 이미지 복원 ──
        if (initialParams.image_filenames?.length) {
            (async () => {
                const files = await Promise.all((initialParams.image_filenames || []).map(async fn => {
                    const res = await fetch(`/api/images/${fn}`);
                    if (!res.ok) return null;
                    const blob = await res.blob();
                    return new File([blob], fn, {type: blob.type || 'image/jpeg'});
                }));
                setImages(files.filter((f): f is File => f !== null && f.size > 0));
            })();
        }
    }, []);

    useEffect(() => {
        if (images.length > pageCount) setImages(prev => prev.slice(0, pageCount));
    }, [pageCount]);

    // ── 탭 전환 시 데이터 로드 ──────────────────────────────────────────────
    useEffect(() => {
        if (activeTab === 'memo' && !memoLoaded.current) {
            memoLoaded.current = true;
            setIsLoadingMemo(true);
            api.listMemos(100).then(r => setMemos(r.memos || [])).catch(() => {
            }).finally(() => setIsLoadingMemo(false));
        }
        if (activeTab === 'doc' && !docLoaded.current) {
            docLoaded.current = true;
            setIsLoadingDoc(true);
            getDocumentFiles().then(files => setDocs(files)).catch(() => {
            }).finally(() => setIsLoadingDoc(false));
        }
    }, [activeTab]);

    // ── 드래그앤드롭 ────────────────────────────────────────────────────────
    const onDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (++dragCountRef.current === 1) setIsDragging(true);
    };
    const onDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (--dragCountRef.current === 0) setIsDragging(false);
    };
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCountRef.current = 0;
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        addImages(files.filter(file => file.type.startsWith('image/')));
        void addPresentationDocuments(files);
    };
    const addImages = (files: File[]) => setImages(prev => [...prev, ...files].slice(0, maxImages));

    // ── 클립보드 붙여넣기 (생성 중 아닐 때만) ──────────────────────────────
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            if (isGenerating) return;
            const items = Array.from(e.clipboardData?.items || []);
            const imageFiles = items
                .filter(item => item.type.startsWith('image/'))
                .map(item => item.getAsFile())
                .filter((f): f is File => f !== null);
            if (imageFiles.length > 0) {
                e.preventDefault();
                addImages(imageFiles);
            }
        };
        document.addEventListener('paste', handlePaste);
        return () => document.removeEventListener('paste', handlePaste);
    }, [isGenerating, maxImages, images.length]);

    // ── 메모 선택 ────────────────────────────────────────────────────────────
    const toggleMemo = (m: Memo) => setSelectedMemos(prev => {
        const n = new Map(prev);
        if (n.has(m.id)) {
            n.delete(m.id);
        } else {
            n.set(m.id, m);
        }
        return n;
    });
    const needle = memoKeyword.trim().normalize('NFC').toLowerCase();
    const filteredMemos = needle
        ? memos.filter(m => m.title.normalize('NFC').toLowerCase().includes(needle) || m.content?.normalize('NFC').toLowerCase().includes(needle))
        : memos;

    // ── 문서 선택 ────────────────────────────────────────────────────────────
    const toggleDoc = (d: DocFile) => setSelectedDocs(prev => {
        // 문서 탭에서 선택한 항목은, 같은 파일이 이전에 업로드됐더라도 항상 저장 문서로 취급한다.
        setUploadedDocumentIds(current => {
            const next = new Set(current);
            next.delete(d.file_id);
            return next;
        });
        const n = new Map(prev);
        if (n.has(d.file_id)) {
            n.delete(d.file_id);
        } else {
            n.set(d.file_id, d);
        }
        return n;
    });
    const filteredDocs = docKeyword.trim()
        ? docs.filter(d => d.filename.normalize('NFC').toLowerCase().includes(docKeyword.normalize('NFC').toLowerCase()))
        : docs;

    const addPresentationDocuments = async (files: File[]) => {
        const supportedFiles = files.filter(file => {
            const extension = file.name.split('.').pop()?.toLowerCase() || '';
            return PRESENTATION_DOCUMENT_EXTENSIONS.has(extension);
        });
        if (!supportedFiles.length || isIndexingSource) return;

        setIsIndexingSource(true);
        try {
            for (const [index, file] of supportedFiles.entries()) {
                setSourceUploadProgress({completed: index, total: supportedFiles.length});
                const formData = new FormData();
                formData.append('file', file);
                // 프레젠테이션 전용 첨부는 검색 인덱스에 넣지 않고, 원문만 이번 요청에 사용한다.
                const response = await fetch('/api/document/parse', {method: 'POST', body: formData});
                if (!response.ok) throw new Error(await response.text());
                const parsed = await response.json() as {filename?: string; content: string};

                const document: DocFile = {
                    file_id: `presentation-${crypto.randomUUID()}`,
                    filename: parsed.filename || file.name,
                    file_ext: file.name.split('.').pop() || '',
                    chunk_count: 0,
                    indexed_at: new Date().toISOString(),
                    content: parsed.content,
                };
                setSelectedDocs(current => new Map(current).set(document.file_id, document));
                setUploadedDocumentIds(current => new Set(current).add(document.file_id));
                setSourceUploadProgress({completed: index + 1, total: supportedFiles.length});
            }
        } catch (error) {
            console.error('프레젠테이션 소스 문서 업로드 실패', error);
        } finally {
            setIsIndexingSource(false);
            setSourceUploadProgress(null);
        }
    };

    // ── 선택 목록 합산 ───────────────────────────────────────────────────────
    const selectedMemoList = Array.from(selectedMemos.values());
    const selectedDocList = Array.from(selectedDocs.values());
    const selectedAttachmentCount = selectedDocList.filter(document => uploadedDocumentIds.has(document.file_id)).length;
    const selectedLibraryDocumentCount = selectedDocList.length - selectedAttachmentCount;

    // 메모/문서를 articles 형태로 변환해서 백엔드에 전달
    const buildArticles = () => [
        ...selectedMemoList.map(m => ({
            title: m.title,
            url: `memo://${m.id}`,
            content: m.content,
            source: '메모',
            indexed_at: m.updated_at || ''
        })),
        ...selectedDocList.map(d => ({
            title: d.filename,
            url: uploadedDocumentIds.has(d.file_id) ? `attachment://${d.file_id}` : `file://${d.file_id}`,
            content: uploadedDocumentIds.has(d.file_id) ? d.content || '' : `[인덱싱된 문서, ${d.file_id}]`,
            source: uploadedDocumentIds.has(d.file_id) ? `첨부(${d.file_ext.toUpperCase()})` : `문서(${d.file_ext.toUpperCase()})`,
            indexed_at: d.indexed_at || '',
            file_id: d.file_id
        })),
    ];

    const totalSelected = selectedMemoList.length + selectedDocList.length;
    const selectedOutputOption: PresentationOutputOption = outputFormat === 'pptx'
        ? 'pptx'
        : aspectRatio === 'widescreen' ? 'pdf_widescreen' : 'pdf_a4';

    const selectOutputOption = (option: PresentationOutputOption) => {
        if (option === 'pptx') {
            setOutputFormat('pptx');
            setAspectRatio('widescreen');
            return;
        }
        setOutputFormat('pdf');
        setAspectRatio(option === 'pdf_a4' ? 'a4' : 'widescreen');
    };

    // ── 생성 ─────────────────────────────────────────────────────────────────
    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        const userTs = new Date().toISOString();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setIsGenerating(true);
        setProgress(5);
        setProgressStep(1);
        setProgressMsg(t('pdfModal.preparing'));
        try {
            const imagesB64 = await Promise.all(images.map(f => new Promise<string>((res, rej) => {
                const r = new FileReader();
                r.onload = () => res((r.result as string).split(',')[1]);
                r.onerror = rej;
                r.readAsDataURL(f);
            })));
            const imageMeta = images.map((f, i) => ({index: i, filename: f.name, type: f.type, data: imagesB64[i]}));

            const res = await fetch('/api/pdf/generate', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                signal: ctrl.signal,
                body: JSON.stringify({
                    prompt,
                    page_count: pageCount,
                    page_count_auto: pageCountAuto,
                    language,
                    style: selectedStyle,
                    output_format: outputFormat,
                    aspect_ratio: aspectRatio,
                    articles: buildArticles(),
                    images: imageMeta,
                    conv_id: convId,
                    messages,
                    reasoning: getReasoningEnabled(),
                }),
            });
            if (!res.body) throw new Error(t('networkError.streamFailed'));

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let filename = '';
            let answer = '';
            let pdfParams: PdfParams | null = null;
            let resultConvId = convId;

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                for (const line of decoder.decode(value).split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6).trim());
                        if (data.type === 'progress') {
                            const p = JSON.parse(data.message) as {
                                step: number;
                                total: number;
                                msg?: string;
                                message_key?: string;
                                message_params?: Record<string, string | number>;
                            };
                            setProgress(data.progress);
                            setProgressStep(p.step);
                            setProgressTotal(p.total);
                            const messageParams = {...p.message_params};
                            if (typeof messageParams.outputFormat === 'string') {
                                messageParams.outputFormat = t(`pdfModal.outputFormats.${messageParams.outputFormat}`);
                            }
                            setProgressMsg(p.message_key ? t(`pdfModal.progress.${p.message_key}`, messageParams) : p.msg || '');
                        } else if (data.type === 'done') {
                            const p = JSON.parse(data.message);
                            filename = p.filename;
                            answer = p.answer;
                            pdfParams = p.pdf_params;
                            if (p.conv_id) resultConvId = p.conv_id;
                            setProgress(100);
                        } else if (data.type === 'error') {
                            let errMsg = data.message;
                            try {
                                const errorPayload = JSON.parse(data.message);
                                errMsg = errorPayload.code
                                    ? translateBackendError(errorPayload.code, errorPayload.params)
                                    : errorPayload.error || data.message;
                            } catch {
                                // The server may return a plain-text error message.
                            }
                            throw new Error(errMsg);
                        }
                    } catch (e) {
                        if (e instanceof Error) throw e; // 모든 에러 rethrow
                    }
                }
            }
            if (filename && pdfParams) {
                onComplete(answer, filename, resultConvId, prompt, pdfParams, userTs);
                onClose();
            }
        } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                setProgressMsg('');
                setProgress(0);
            } else {
                const errorMessage = error instanceof Error ? error.message : String(error);
                setProgressMsg(t('uiAuditFinal.errorDetail', {message: errorMessage}));
                setProgress(0);
            }
            setIsGenerating(false);
        } finally {
            abortRef.current = null;
        }
    };

    // ── 렌더 ─────────────────────────────────────────────────────────────────
    return (
        <ModalOverlay className="pdf-overlay">
            <div className={`pdf-modal${isDragging ? ' pdf-modal--dragging' : ''}`}
                 onClick={e => e.stopPropagation()}
                 onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>

                {sourceUploadProgress && (
                    <div className="pdf-source-upload-overlay" role="status" aria-live="polite">
                        <span className="pdf-source-upload-spinner" aria-hidden/>
                        <strong>{t('pdfModal.uploadingAttachments')}</strong>
                        <span>{t('pdfModal.uploadProgress', sourceUploadProgress)}</span>
                    </div>
                )}

                {isDragging && (
                    <div className="pdf-drag-overlay">
                        <div className="pdf-drag-hint">
                            <Upload size={28} strokeWidth={1.5} aria-hidden/>
                            {t('pdfModal.dropFiles')}
                        </div>
                    </div>
                )}

                {/* ── 헤더 ── */}
                <div className="pdf-header">
                    <div className="pdf-header-left">
                        <div className="pdf-icon">
                            <FileText aria-hidden/>
                        </div>
                        <div>
                            <div className="pdf-title">{initialParams ? t('pdfModal.editTitle') : t('pdfModal.title')}</div>
                            <div className="pdf-subtitle">{t('pdfModal.subtitle')}</div>
                        </div>
                    </div>
                    <button className="pdf-close" onClick={onClose} disabled={isGenerating} style={{
                        opacity: isGenerating ? 0.3 : 1,
                        cursor: isGenerating ? 'not-allowed' : 'pointer'
                    }}><X size={20} aria-hidden/>
                    </button>
                </div>

                {/* ── 상단 ── */}
                <div className={`pdf-top${isGenerating ? ' pdf-disabled' : ''}`}>
                    <div className="pdf-top-left">
                        <div className="pdf-section">
                            <div className="pdf-label">{t('pdfModal.promptLabel')}</div>
                            <textarea className="pdf-textarea"
                                      placeholder={t('pdfModal.promptPlaceholder')}
                                      value={prompt} onChange={e => setPrompt(e.target.value)} disabled={isGenerating}/>
                        </div>
                    </div>

                    <div className="pdf-top-right">
                        <div className="pdf-presentation-settings">
                            <div className="pdf-format-style-row">
                            <div className="pdf-setting-group">
                                <div className="pdf-label">{t('pdfModal.outputFormat')}</div>
                                <div className="pdf-output-format-options" role="radiogroup" aria-label={t('pdfModal.outputFormat')}>
                                    {(['pdf_a4', 'pdf_widescreen', 'pptx'] as PresentationOutputOption[]).map(option => (
                                        <button
                                            key={option}
                                            type="button"
                                            role="radio"
                                            aria-checked={selectedOutputOption === option}
                                            className={`pdf-output-format-option${selectedOutputOption === option ? ' active' : ''}`}
                                            onClick={() => selectOutputOption(option)}
                                            disabled={isGenerating}
                                        >
                                            {option === 'pptx' ? (
                                                <span className="pdf-output-format-main">{t('pdfModal.outputFormats.pptx')}</span>
                                            ) : (
                                                <>
                                                    <span className="pdf-output-format-main">{t('pdfModal.outputFormats.pdf')}</span>
                                                    <span className="pdf-output-format-sub">
                                                        {t(`pdfModal.outputSizes.${option === 'pdf_a4' ? 'a4' : 'widescreen'}`)}
                                                    </span>
                                                </>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="pdf-style-row">
                                <div className="pdf-label">{t('pdfModal.style')}</div>
                                <div className="pdf-style-icons">
                                    {STYLES.map(s => {
                                        const StyleIcon = s.icon;
                                        return (
                                        <div key={s.id} className="pdf-style-icon-wrap">
                                            <Tooltip content={t(`pdfModal.styles.${s.id}`)}>
                                            <button className={`pdf-style-icon${selectedStyle === s.id ? ' active' : ''}`}
                                                    onClick={() => !isGenerating && setSelectedStyle(s.id)}><StyleIcon size={20} color={s.id === 'white' ? '#f5f5f5' : 'var(--muted)'} fill={s.id === 'white' ? '#f5f5f5' : 'currentColor'} strokeWidth={1.8} aria-hidden/></button>
                                            </Tooltip>
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>
                            </div>
                            <div className="pdf-setting-group">
                                <div className="pdf-label">{t('pdfModal.pageSettings')}</div>
                                <div className="pdf-options-row">
                                    <CustomSelect
                                        options={[
                                            {value: 'auto', label: t('pdfModal.autoPages')},
                                            ...[5, 8, 10, 12, 15].map(value => ({value: String(value), label: t('pdfModal.pages', {count: value})})),
                                        ]}
                                        value={pageCountAuto ? 'auto' : String(pageCount)}
                                        onChange={v => {
                                            if (v === 'auto') {
                                                setPageCountAuto(true);
                                            } else {
                                                setPageCountAuto(false);
                                                setPageCount(Number(v));
                                            }
                                        }}
                                        disabled={isGenerating}
                                        className="pdf-dropdown"
                                        triggerStyle={{background: 'var(--surface)'}}
                                        dropdownBackground="var(--surface)"
                                    />
                                    <CustomSelect
                                        options={[
                                            ...SUPPORTED_LANGUAGES.map(({value, label}) => ({
                                                value,
                                                label,
                                            })),
                                        ]}
                                        value={language}
                                        onChange={setLanguage}
                                        disabled={isGenerating}
                                        className="pdf-dropdown"
                                        triggerStyle={{background: 'var(--surface)'}}
                                        dropdownBackground="var(--surface)"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="pdf-img-row">
                            <div className="pdf-label">{t('pdfModal.imageAttachment')}<span
                                className="pdf-img-limit">{t('pdfModal.imageLimit', {count: images.length, max: maxImages})}</span>{!isGenerating &&
                                <span className="pdf-paste-hint">{t('pdfModal.pasteHint')}</span>}</div>
                            <div className="pdf-img-strip-wrap">
                                <button className={`pdf-add-btn${images.length >= maxImages ? ' disabled' : ''}`}
                                        onClick={() => images.length < maxImages && fileInputRef.current?.click()}>
                                    <ImagePlus size={16} aria-hidden/>
                                </button>
                                <div className="pdf-img-scroll">
                                    {images.map((img, idx) => (
                                        <div key={idx} className="pdf-thumb-sm">
                                            <img src={URL.createObjectURL(img)} alt="" className="pdf-thumb-img"
                                                 onClick={() => setViewerIndex(idx)}/>
                                            <button className="pdf-thumb-del"
                                                    onClick={() => setImages(p => p.filter((_, i) => i !== idx))}><X size={10} aria-hidden/>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{display: 'none'}}
                                   onChange={e => {
                                       addImages(Array.from(e.target.files || []).filter(f => f.type.startsWith('image/')));
                                       if (fileInputRef.current) fileInputRef.current.value = '';
                                   }}/>
                        </div>
                    </div>
                </div>

                {/* ── 하단: 탭 + 선택 목록 ── */}
                <div className={`pdf-bottom${isGenerating ? ' pdf-disabled' : ''}`}>
                    <div className="pdf-bottom-left">

                        {/* 탭 헤더 */}
                        <div className="pdf-source-tabs">
                            {([
                                {id: 'memo', label: t('pdfModal.memo'), count: selectedMemoList.length},
                                {id: 'doc', label: t('pdfModal.document'), count: selectedDocList.length},
                            ] as { id: SourceTab; label: string; count: number }[]).map(tab => (
                                <button key={tab.id}
                                        className={`pdf-source-tab${activeTab === tab.id ? ' active' : ''}`}
                                        onClick={() => setActiveTab(tab.id)}>
                                    {tab.label}
                                    {tab.count > 0 && <span className="pdf-tab-badge">{tab.count}</span>}
                                </button>
                            ))}
                        </div>

                        {/* ── 메모 탭 ── */}
                        {activeTab === 'memo' && (
                            <>
                                <div className="pdf-article-search">
                                    <Search className="pdf-search-icon" aria-hidden="true" />
                                    <input className="pdf-search-input" type="text" placeholder={t('common:search')} aria-label={t('pdfModal.memoSearch')}
                                           value={memoKeyword} onChange={e => setMemoKeyword(e.target.value)}
                                           disabled={isGenerating}/>
                                </div>
                                <div className="pdf-article-list">
                                    {isLoadingMemo ? (
                                        <div className="pdf-article-empty">{t('pdfModal.loading')}</div>
                                    ) : filteredMemos.length > 0 ? filteredMemos.map(m => {
                                        const isSelected = selectedMemos.has(m.id);
                                        return (
                                            <div key={m.id}
                                                 className={`pdf-article-item${isSelected ? ' selected' : ''}`}
                                                 onClick={() => toggleMemo(m)}>
                                                <div className={`pdf-article-add${isSelected ? ' checked' : ''}`}>
                                                    <SelectionIcon selected={isSelected}/>
                                                </div>
                                                <div className="pdf-article-info">
                                                    <div className="pdf-article-title">{m.title || t('pdfModal.untitled')}</div>
                                                    {m.updated_at && (
                                                        <div className="pdf-article-meta">
                                                            {new Date(m.updated_at).toLocaleDateString(i18n.language)}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    }) : (
                                        <div className="pdf-article-empty">{memoKeyword ? t('pdfModal.noSearchResults') : t('pdfModal.noMemos')}</div>
                                    )}
                                </div>
                            </>
                        )}

                        {/* ── 문서 탭 ── */}
                        {activeTab === 'doc' && (
                            <>
                                <div className="pdf-article-search">
                                    <Search className="pdf-search-icon" aria-hidden="true" />
                                    <input className="pdf-search-input" type="text" placeholder={t('common:search')} aria-label={t('pdfModal.fileSearch')}
                                           value={docKeyword} onChange={e => setDocKeyword(e.target.value)}
                                           disabled={isGenerating}/>
                                </div>
                                <div className="pdf-article-list">
                                    {isLoadingDoc ? (
                                        <div className="pdf-article-empty">{t('pdfModal.loading')}</div>
                                    ) : filteredDocs.length > 0 ? filteredDocs.map(d => {
                                        const isSelected = selectedDocs.has(d.file_id);
                                        const ext = d.file_ext.replace('.', '').toUpperCase();
                                        return (
                                            <div key={d.file_id}
                                                 className={`pdf-article-item${isSelected ? ' selected' : ''}`}
                                                 onClick={() => toggleDoc(d)}>
                                                <div className={`pdf-article-add${isSelected ? ' checked' : ''}`}>
                                                    <SelectionIcon selected={isSelected}/>
                                                </div>
                                                <div className="pdf-doc-ext-badge"
                                                     style={{background: extColor(d.file_ext)}}>{ext}</div>
                                                    <div className="pdf-article-info">
                                                    <div className="pdf-article-title">{d.filename}</div>
                                                    <div
                                                        className="pdf-article-meta">{d.indexed_at && new Date(d.indexed_at).toLocaleDateString(i18n.language)}</div>
                                                </div>
                                            </div>
                                        );
                                    }) : (
                                        <div
                                            className="pdf-article-empty">{docKeyword ? t('pdfModal.noSearchResults') : t('pdfModal.noDocuments')}</div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* ── 선택된 소스 목록 ── */}
                    <div className="pdf-bottom-right">
                        <div className="pdf-selected-sources-header">
                            {t('pdfModal.selectedSources')}
                            <button className="pdf-selected-sources-add" type="button"
                                    onClick={() => documentInputRef.current?.click()}
                                    disabled={isIndexingSource}><Plus size={14} aria-hidden/></button>
                            {selectedMemoList.length > 0 && (
                                <span className="pdf-source-summary-badge pdf-source-summary-badge--memo">
                                    {t('pdfModal.memo')} {selectedMemoList.length}
                                    <button onClick={() => setSelectedMemos(new Map())}>×</button>
                                </span>
                            )}
                            {selectedLibraryDocumentCount > 0 && (
                                <span className="pdf-source-summary-badge pdf-source-summary-badge--document">
                                    {t('pdfModal.documentShort')} {selectedLibraryDocumentCount}
                                    <button onClick={() => {
                                        setSelectedDocs(current => new Map(Array.from(current).filter(([fileId]) => uploadedDocumentIds.has(fileId))));
                                    }}>×</button>
                                </span>
                            )}
                            {selectedAttachmentCount > 0 && (
                                <span className="pdf-source-summary-badge pdf-source-summary-badge--attachment">
                                    {t('pdfModal.attachment')} {selectedAttachmentCount}
                                    <button onClick={() => {
                                        setSelectedDocs(current => new Map(Array.from(current).filter(([fileId]) => !uploadedDocumentIds.has(fileId))));
                                        setUploadedDocumentIds(new Set());
                                    }}>×</button>
                                </span>
                            )}
                        </div>
                        <div className="pdf-selected-list">
                            {totalSelected > 0 ? (
                                <>
                                    {selectedMemoList.map((m, i) => (
                                        <div key={m.id} className="pdf-selected-item pdf-selected-item--memo">
                                            <span
                                                className="pdf-selected-num">{i + 1}</span>
                                            <div className="pdf-source-type-tag pdf-source-type-tag--memo">{t('pdfModal.memo')}
                                            </div>
                                            <div className="pdf-article-info">
                                                <div className="pdf-article-title">{m.title || t('pdfModal.untitled')}</div>
                                            </div>
                                            <button className="pdf-selected-del" onClick={() => toggleMemo(m)}><XCircle
                                                size={18}/></button>
                                        </div>
                                    ))}
                                    {selectedDocList.map((d, i) => (
                                        <div key={d.file_id} className={`pdf-selected-item${uploadedDocumentIds.has(d.file_id) ? ' pdf-selected-item--attachment' : ' pdf-selected-item--document'}`}>
                                            <span
                                                className="pdf-selected-num">{selectedMemoList.length + i + 1}</span>
                                            <div className={`pdf-source-type-tag${uploadedDocumentIds.has(d.file_id) ? ' pdf-source-type-tag--attachment' : ' pdf-source-type-tag--document'}`}>
                                                {uploadedDocumentIds.has(d.file_id) ? t('pdfModal.attachment') : d.file_ext.replace('.', '').toUpperCase()}
                                            </div>
                                            <div className="pdf-article-info">
                                                <div className="pdf-article-title">{d.filename}</div>
                                            </div>
                                            <button className="pdf-selected-del" onClick={() => toggleDoc(d)}><XCircle
                                                size={18}/></button>
                                        </div>
                                    ))}
                                </>
                            ) : (
                                <button className="pdf-source-upload-zone"
                                        type="button"
                                        onClick={() => documentInputRef.current?.click()}
                                        disabled={isIndexingSource}>
                                    {isIndexingSource ? t('pdfModal.loading') : t('pdfModal.presentationSourceDropHint')}
                                </button>
                            )}
                        </div>
                        <input ref={documentInputRef} type="file" multiple accept=".pdf,.docx,.xlsx,.pptx,.txt,.html,.htm,.md"
                               style={{display: 'none'}}
                               onChange={event => {
                                   void addPresentationDocuments(Array.from(event.target.files || []));
                                   if (documentInputRef.current) documentInputRef.current.value = '';
                               }}/>
                    </div>
                </div>

                {/* ── 푸터 ── */}
                <div className="pdf-footer">
                    <div className="pdf-footer-info">
                        {isGenerating ? (
                            <div className="pdf-progress-area">
                                <div className="pdf-progress-header">
                                    <span className="pdf-progress-step">{t('pdfModal.step', {current: progressStep, total: progressTotal})}</span>
                                    <span className="pdf-progress-pct">{progress}%</span>
                                </div>
                                <div className="pdf-progress-msg">
                                    {progressMsg} · {t('pdfModal.generatingElapsed', {seconds: progressElapsedSeconds})}
                                </div>
                                <div className="pdf-progress-bar-wrap">
                                    <div className="pdf-progress-bar" style={{width: `${progress}%`}}/>
                                </div>
                            </div>
                        ) : (
                            <span>
                                {t('pdfModal.sourceCount', {count: totalSelected})}
                                {selectedMemoList.length > 0 && ` (${t('pdfModal.memo')} ${selectedMemoList.length})`}
                                {selectedDocList.length > 0 && ` (${t('pdfModal.document')} ${selectedDocList.length})`}
                                {' · '}{t('pdfModal.imageCount', {count: images.length})}
                                {' · '}{pageCountAuto ? t('pdfModal.autoPages') : t('pdfModal.pages', {count: pageCount})}
                            </span>
                        )}
                    </div>
                    <div className="pdf-footer-btns">
                        <button className="pdf-btn-cancel" onClick={onClose} disabled={isGenerating}>{t('pdfModal.cancel')}</button>
                        <button className="pdf-btn-generate" onClick={isGenerating ? () => {
                            abortRef.current?.abort();
                            abortRef.current = null;
                        } : handleGenerate}
                                disabled={!isGenerating && (!prompt.trim() || (totalSelected === 0 && images.length === 0))}>
                            {isGenerating
                                ? <>
                                    <div className="pdf-spinner"/>
                                    {t('pdfModal.stop')}</>
                                : <>
                                    <FileText size={14} aria-hidden/>
                                    {initialParams ? t('pdfModal.regenerate') : t('pdfModal.title')}</>
                            }
                        </button>
                    </div>
                </div>
            </div>

            {viewerIndex !== null && images.length > 0 && (
                <ImageViewer images={images.map(img => ({src: URL.createObjectURL(img), alt: img.name}))}
                             currentIndex={viewerIndex} onClose={() => setViewerIndex(null)}
                             onIndexChange={setViewerIndex}/>
            )}
        </ModalOverlay>
    );
};

export default PdfModal;
