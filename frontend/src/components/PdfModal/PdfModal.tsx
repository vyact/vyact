import React, {useEffect, useRef, useState} from 'react';
import {Check, FileText, Heart, ImagePlus, Plus, Upload, X, XCircle} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import ImageViewer from '../ImageViewer/ImageViewer';
import CustomSelect from '../CustomSelect/CustomSelect';
import { getReasoningEnabled } from '../../utils/reasoning';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import type {Message} from '../../types';
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
}

export interface PdfParticle {
    url: string;
    title: string;
    source: string;
    indexed_at: string;
    file_id?: string | null;
}

export interface PdfParams {
    prompt: string;
    page_count: number;
    page_count_auto?: boolean;
    language: string;
    style: string;
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
    const [language, setLanguage] = useState(initialParams?.language || 'ko');
    const [selectedStyle, setSelectedStyle] = useState(initialParams?.style || 'dark');
    const [styleTooltip, setStyleTooltip] = useState<string | null>(null);

    // 이미지
    const [images, setImages] = useState<File[]>([]);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
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

    // 생성 진행
    const [isGenerating, setIsGenerating] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const [progress, setProgress] = useState(0);
    const [progressStep, setProgressStep] = useState(0);
    const [progressTotal, setProgressTotal] = useState(6);
    const [progressMsg, setProgressMsg] = useState('');

    // 생성 중 ESC 키 차단
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isGenerating) e.stopPropagation();
        };
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
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
                const map = new Map<string, Memo>();
                allMemos.filter(m => memoIds.includes(m.id)).forEach(m => map.set(m.id, m));
                if (map.size > 0) setSelectedMemos(map);
            }).catch(() => {});
        }

        // ── 문서 복원: file_id 직접 사용 ──
        const docArticles = savedArticles.filter(a => a.url.startsWith('file://') && a.file_id);
        if (docArticles.length > 0) {
            fetch('/api/document/files').then(r => r.json()).then(r => {
                const allDocs: DocFile[] = r.files || [];
                const fileIds = new Set(docArticles.map(a => a.file_id!));
                const map = new Map<string, DocFile>();
                allDocs.filter(d => fileIds.has(d.file_id)).forEach(d => map.set(d.file_id, d));
                if (map.size > 0) setSelectedDocs(map);
            }).catch(() => {});
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
            fetch('/api/document/files').then(r => r.json()).then(r => setDocs(r.files || [])).catch(() => {
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
        addImages(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
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

    // ── 선택 목록 합산 ───────────────────────────────────────────────────────
    const selectedMemoList = Array.from(selectedMemos.values());
    const selectedDocList = Array.from(selectedDocs.values());

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
            url: `file://${d.file_id}`,
            content: `[인덱싱된 문서, ${d.file_id}]`,
            source: `문서(${d.file_ext.toUpperCase()})`,
            indexed_at: d.indexed_at || '',
            file_id: d.file_id
        })),
    ];

    const totalSelected = selectedMemoList.length + selectedDocList.length;

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
                    articles: buildArticles(),
                    images: imageMeta,
                    conv_id: convId,
                    messages,
                    reasoning: getReasoningEnabled(),
                }),
            });
            if (!res.body) throw new Error('스트림 없음');

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
                            const p = JSON.parse(data.message);
                            setProgress(data.progress);
                            setProgressStep(p.step);
                            setProgressTotal(p.total);
                            setProgressMsg(p.msg);
                        } else if (data.type === 'done') {
                            const p = JSON.parse(data.message);
                            filename = p.filename;
                            answer = p.answer;
                            pdfParams = p.pdf_params;
                            if (p.conv_id) resultConvId = p.conv_id;
                            setProgress(100);
                        } else if (data.type === 'error') {
                            let errMsg = data.message;
                            try { errMsg = JSON.parse(data.message)?.error || data.message; } catch {
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
                setProgressMsg(`❌ 오류: ${errorMessage}`);
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

                {isDragging && (
                    <div className="pdf-drag-overlay">
                        <div className="pdf-drag-hint">
                            <Upload size={28} strokeWidth={1.5} aria-hidden/>
                            {t('pdfModal.dropImages')}
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
                        <div className="pdf-section">
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
                                        {value: 'ko', label: `🇰🇷 ${t('pdfModal.korean')}`},
                                        {value: 'en', label: '🇺🇸 English'},
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

                    <div className="pdf-top-right">
                        <div className="pdf-img-row">
                            <div className="pdf-label">{t('pdfModal.imageAttachment')}<span
                                className="pdf-img-limit">{t('pdfModal.imageLimit', {count: images.length, max: maxImages})}</span>{!isGenerating &&
                                <span className="pdf-paste-hint">{t('pdfModal.pasteHint')}</span>}</div>
                            <div className="pdf-img-strip-wrap">
                                <button className={`pdf-add-btn${images.length >= maxImages ? ' disabled' : ''}`}
                                        onClick={() => images.length < maxImages && fileInputRef.current?.click()}
                                        title={t('pdfModal.addImage')}>
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
                        <div className="pdf-style-row">
                            <div className="pdf-label">{t('pdfModal.style')}</div>
                            <div className="pdf-style-icons">
                                {STYLES.map(s => {
                                    const StyleIcon = s.icon;
                                    return (
                                    <div key={s.id} className="pdf-style-icon-wrap">
                                        <button className={`pdf-style-icon${selectedStyle === s.id ? ' active' : ''}`}
                                                onClick={() => !isGenerating && setSelectedStyle(s.id)}
                                                onMouseEnter={() => setStyleTooltip(s.id)}
                                                onMouseLeave={() => setStyleTooltip(null)}><StyleIcon size={20} color={s.id === 'white' ? '#f5f5f5' : 'var(--muted)'} fill={s.id === 'white' ? '#f5f5f5' : 'currentColor'} strokeWidth={1.8} aria-hidden/></button>
                                        {styleTooltip === s.id && <div className="pdf-style-tooltip">{t(`pdfModal.styles.${s.id}`)}</div>}
                                    </div>
                                    );
                                })}
                            </div>
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
                                    <input className="pdf-search-input" type="text" placeholder={t('pdfModal.memoSearch')}
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
                                                    <div
                                                        className="pdf-article-meta">{t('pdfModal.memo')}{m.updated_at && ` · ${new Date(m.updated_at).toLocaleDateString(i18n.language)}`}</div>
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
                                    <input className="pdf-search-input" type="text" placeholder={t('pdfModal.fileSearch')}
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
                                                        className="pdf-article-meta">{t('pdfModal.chunks', {count: d.chunk_count})}{d.indexed_at && ` · ${new Date(d.indexed_at).toLocaleDateString(i18n.language)}`}</div>
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
                        <div className="pdf-label" style={{
                            marginBottom: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            flexWrap: 'wrap'
                        }}>
                            {t('pdfModal.selectedSources')}
                            {selectedMemoList.length > 0 && (
                                <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    background: 'rgba(139,92,246,0.15)',
                                    color: '#8b5cf6',
                                    borderRadius: '10px',
                                    padding: '1px 7px',
                                    fontSize: '11px',
                                    fontWeight: 600
                                }}>
                                    {t('pdfModal.memo')} {selectedMemoList.length}
                                    <button onClick={() => setSelectedMemos(new Map())} style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: '#8b5cf6',
                                        padding: '0 0 0 2px',
                                        lineHeight: 1,
                                        fontSize: '12px'
                                    }}>×</button>
                                </span>
                            )}
                            {selectedDocList.length > 0 && (
                                <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    background: 'rgba(34,197,94,0.15)',
                                    color: '#22c55e',
                                    borderRadius: '10px',
                                    padding: '1px 7px',
                                    fontSize: '11px',
                                    fontWeight: 600
                                }}>
                                    {t('pdfModal.document')} {selectedDocList.length}
                                    <button onClick={() => setSelectedDocs(new Map())} style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: '#22c55e',
                                        padding: '0 0 0 2px',
                                        lineHeight: 1,
                                        fontSize: '12px'
                                    }}>×</button>
                                </span>
                            )}
                        </div>
                        <div className="pdf-selected-list">
                            {totalSelected > 0 ? (
                                <>
                                    {selectedMemoList.map((m, i) => (
                                        <div key={m.id} className="pdf-selected-item">
                                            <span
                                                className="pdf-selected-num">{i + 1}</span>
                                            <div className="pdf-source-type-tag"
                                                 style={{background: 'rgba(139,92,246,0.12)', color: '#8b5cf6'}}>{t('pdfModal.memo')}
                                            </div>
                                            <div className="pdf-article-info">
                                                <div className="pdf-article-title">{m.title || t('pdfModal.untitled')}</div>
                                                <div className="pdf-article-meta">{t('pdfModal.memo')}</div>
                                            </div>
                                            <button className="pdf-selected-del" onClick={() => toggleMemo(m)}><XCircle
                                                size={18}/></button>
                                        </div>
                                    ))}
                                    {selectedDocList.map((d, i) => (
                                        <div key={d.file_id} className="pdf-selected-item">
                                            <span
                                                className="pdf-selected-num">{selectedMemoList.length + i + 1}</span>
                                            <div className="pdf-source-type-tag" style={{
                                                background: `${extColor(d.file_ext)}1a`,
                                                color: extColor(d.file_ext)
                                            }}>{d.file_ext.replace('.', '').toUpperCase()}</div>
                                            <div className="pdf-article-info">
                                                <div className="pdf-article-title">{d.filename}</div>
                                                <div className="pdf-article-meta">{d.chunk_count}청크</div>
                                            </div>
                                            <button className="pdf-selected-del" onClick={() => toggleDoc(d)}><XCircle
                                                size={18}/></button>
                                        </div>
                                    ))}
                                </>
                            ) : (
                                <div className="pdf-article-empty">{t('pdfModal.selectSources')}</div>
                            )}
                        </div>
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
                                <div className="pdf-progress-msg">{progressMsg}</div>
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
