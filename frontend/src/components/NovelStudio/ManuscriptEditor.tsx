import CopyIconButton from '../common/CopyIconButton/CopyIconButton';
import {queueManuscriptImageCleanup} from './manuscriptImageCleanup';
import ManuscriptReadingContent from './ManuscriptReadingContent';
import ImageViewer from '../ImageViewer/ImageViewer';
import {retainManuscriptImages} from './manuscriptImageCache';
import {Pencil, ImagePlus, LoaderCircle} from 'lucide-react';
import {renderMarkdown} from '../../utils/markdownUtils';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useEditor, EditorContent} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {NodeSelection, TextSelection} from '@tiptap/pm/state';
import {RichTextImage} from '../common/RichTextImage/RichTextImage';
import {applyManuscriptImageWidths, documentToManuscript, manuscriptToDocument} from './manuscriptDocument';
import type {Chapter} from './storyStorage';
import type {WorkspaceEditSession} from './workspaceEditSession';
import {manuscriptImageSelectionPlugin} from './manuscriptImageSelection';

interface ManuscriptEditorProps {chapter: Chapter; onChange: (patch: Partial<Chapter>) => void; onSessionChange?: (session: WorkspaceEditSession | null) => void; onDraftTextChange?: (chapterId: string, text: string | null) => void}

export default function ManuscriptEditor({chapter, onChange, onDraftTextChange, onSessionChange}: ManuscriptEditorProps) {
    const {t} = useTranslation('main');
    const [editing, setEditing] = useState(!chapter.text.trim());
    const [imageViewer, setImageViewer] = useState<{images: {src: string; alt: string}[]; index: number} | null>(null);
    const readingRef = useRef<HTMLElement>(null);
    const html = useMemo(() => applyManuscriptImageWidths(renderMarkdown(chapter.text)), [chapter.text]);
    useLayoutEffect(() => {if (!editing && readingRef.current) retainManuscriptImages(readingRef.current);}, [html, editing]);
    if (editing) return <ManuscriptEditingSession chapter={chapter} onChange={onChange} onDraftTextChange={onDraftTextChange} onSessionChange={onSessionChange} onFinish={() => setEditing(false)}/>;
    return <div className="novel-manuscript-page"><header className="novel-manuscript-heading"><h2>{chapter.title}</h2><button type="button" className="modal-action-cancel" data-tooltip-disabled="" onClick={() => setEditing(true)}><Pencil size={15}/><span>{t('novelStudio.editManuscript')}</span></button></header><article ref={readingRef} className="novel-manuscript-reading" onClick={event => {
        const image = (event.target as HTMLElement).closest('img');
        if (!image) return;
        const images = Array.from(event.currentTarget.querySelectorAll('img')).filter(item => item.getAttribute('src'));
        const index = images.indexOf(image);
        if (index < 0) return;
        event.preventDefault();
        setImageViewer({images: images.map(item => ({src: item.src, alt: item.alt})), index});
    }}><CopyIconButton text={chapter.text} className="novel-body-copy"/><ManuscriptReadingContent html={html}/></article>{imageViewer && <ImageViewer images={imageViewer.images} currentIndex={imageViewer.index} onClose={() => setImageViewer(null)} onIndexChange={index => setImageViewer(previous => previous ? {...previous, index} : null)}/>}</div>;
}

function ManuscriptEditingSession({chapter, onChange, onFinish, onDraftTextChange, onSessionChange}: ManuscriptEditorProps & {onFinish: () => void}) {
    const {t} = useTranslation('main');
    const editing = true;
    const setEditing = (_value: boolean) => onFinish();
    const [draft, setDraft] = useState({title: chapter.title, text: chapter.text});
    useEffect(() => {onDraftTextChange?.(chapter.id, draft.text);}, [chapter.id, draft.text, onDraftTextChange]);
    useEffect(() => () => onDraftTextChange?.(chapter.id, null), [chapter.id, onDraftTextChange]);
    const uploadedImages = useRef<{url: string; deleteToken: string}[]>([]);
    useEffect(() => () => {
        const images = uploadedImages.current;
        uploadedImages.current = [];
        queueManuscriptImageCleanup(images);
    }, []);
    const cancelEditing = async () => {
        const images = uploadedImages.current;
        uploadedImages.current = [];
        setDraft({title: chapter.title, text: chapter.text});
        setEditing(false);
        queueManuscriptImageCleanup(images);
        return true;
    };
    const saveEditing = async () => {
        const unusedImages = uploadedImages.current.filter(image => !draft.text.includes(image.url));
        onChange(draft);
        uploadedImages.current = [];
        setEditing(false);
        queueManuscriptImageCleanup(unusedImages);
        return true;
    };
    const html = useMemo(() => editing ? '' : applyManuscriptImageWidths(renderMarkdown(chapter.text)), [chapter.text, editing]);
    const readingRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {if (!editing && readingRef.current) retainManuscriptImages(readingRef.current);}, [html, editing]);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const imageInsertionPosition = useRef<number | null>(null);
    const [uploading, setUploading] = useState(false);
    const [imageLoading, setImageLoading] = useState(false);
    const [imageError, setImageError] = useState('');
    const editor = useEditor({
        extensions: [StarterKit.configure({heading: false, bold: false, italic: false, strike: false, code: false, codeBlock: false, blockquote: false, bulletList: false, orderedList: false, horizontalRule: false, link: false, underline: false}), RichTextImage.extend({
            addProseMirrorPlugins() {
                return [...(this.parent?.() ?? []), manuscriptImageSelectionPlugin()];
            },
            addNodeView() {
                const parent = this.parent?.();
                if (!parent) throw new Error('Missing image node view');
                return props => {
                    const view = parent(props);
                    const image = view.dom.querySelector('img');
                    if (image) {image.loading = 'eager'; image.decoding = 'async';}
                    return view;
                };
            },
        })],
        content: manuscriptToDocument(editing ? chapter.text : ''),
        enableInputRules: false,
        enablePasteRules: false,
        editorProps: {
            attributes: {'aria-label': t('novelStudio.text'), class: 'novel-manuscript-visual'},
            handleClickOn: (view, _position, node, nodePosition, event) => {
                if (node.type.name !== 'memoImage' || (event.target as HTMLElement).closest('button')) return false;
                view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePosition)));
                view.focus();
                return true;
            },
            handleKeyDown: (view, event) => {
                if (event.key !== 'Backspace' || event.isComposing) return false;
                const {selection, doc} = view.state;
                if (!selection.empty || selection instanceof NodeSelection) return false;
                const {$from} = selection;
                if ($from.depth !== 1 || $from.parentOffset !== 0 || $from.parent.type.name !== 'paragraph') return false;
                const paragraphPosition = $from.before();
                if (doc.resolve(paragraphPosition).nodeBefore?.type.name !== 'memoImage') return false;
                event.preventDefault();
                if ($from.parent.content.size === 0) {
                    // Remove only the empty line, keeping the image intact.
                    const transaction = view.state.tr.delete(paragraphPosition, $from.after());
                    transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(paragraphPosition, transaction.doc.content.size)), 1));
                    view.dispatch(transaction);
                }
                // At the start of nonempty text, never join backwards through an image.
                return true;
            },
            handlePaste: (view, event) => {
                const file = Array.from(event.clipboardData?.files ?? []).find(item => item.type.startsWith('image/'));
                if (!file) return false;
                event.preventDefault(); void insertImage(file, view.state.selection.from); return true;
            },
        },
        onUpdate: ({editor: current}) => setDraft(previous => ({...previous, text: documentToManuscript(current.getJSON())})),
    });
    useEffect(() => {editor?.setEditable(!uploading);}, [editor, uploading]);
    useLayoutEffect(() => {
        onSessionChange?.({dirty: draft.text !== chapter.text || draft.title !== chapter.title, pending: uploading,
            characterText: draft.text, save: saveEditing, discard: cancelEditing});
    });
    useLayoutEffect(() => () => onSessionChange?.(null), [onSessionChange]);
    const mounted = useRef(true);
    useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
    const insertImage = async (file: File, insertionPosition?: number) => {
        if (!editor || uploading) return;
        const position = insertionPosition ?? editor.state.selection.from;
        setImageLoading(true);
        setUploading(true); setImageError('');
        try {
            const body = new FormData(); body.append('file', file);
            const response = await fetch('/api/novel-studio/images', {method: 'POST', body});
            if (!response.ok) throw new Error('Image upload failed');
            const result = await response.json();
            if (!mounted.current) {queueManuscriptImageCleanup([result]); return;}
            uploadedImages.current.push(result);
            editor.setEditable(true);
            editor.chain().focus().insertContentAt(position, [{type: 'memoImage', attrs: {src: result.url, alt: ''}}, {type: 'paragraph'}]).run();
        } catch {
            if (mounted.current) setImageError(t('novelStudio.imageUploadError'));
        } finally {
            if (mounted.current) {setUploading(false); setImageLoading(false);}
        }
    };
    return <div className="novel-manuscript-page">
        <header className="novel-manuscript-heading">{editing ? <input className="novel-chapter-title" aria-label={t('novelStudio.chapterTitle')} maxLength={200} disabled={uploading} value={draft.title} onChange={event => setDraft(previous => ({...previous, title: event.target.value}))}/> : <h2>{chapter.title}</h2>}<div className="novel-manuscript-edit-actions">{editing && <button type="button" className="modal-action-cancel novel-editor-action" disabled={uploading} onMouseDown={event => event.preventDefault()} onClick={() => {if (!editor) return; imageInsertionPosition.current = editor.state.selection.from; imageInputRef.current?.click();}}>{imageLoading ? <LoaderCircle size={16} className="novel-spinner" aria-hidden="true"/> : <ImagePlus size={16}/>}<span>{t(imageLoading ? 'memoModal.uploading' : 'memoModal.toolbar.addImage')}</span></button>}{editing && <button type="button" className="modal-action-cancel novel-editor-action" disabled={uploading} onClick={() => void cancelEditing()}>{t('novelStudio.cancelEdit')}</button>}<button type="button" className={`novel-editor-action ${editing ? 'modal-action-submit' : 'modal-action-cancel'}`} aria-pressed={editing} data-tooltip-disabled="" disabled={uploading} onClick={() => {if (editing) void saveEditing(); else {setDraft({title: chapter.title, text: chapter.text}); setImageError(''); editor?.commands.setContent(manuscriptToDocument(chapter.text)); setEditing(true);}}}>{!editing && <Pencil size={15}/>}<span>{t(`novelStudio.${editing ? 'finishManuscriptEdit' : 'editManuscript'}`)}</span></button></div></header>
        <input ref={imageInputRef} type="file" className="novel-image-input" accept="image/png,image/jpeg,image/gif,image/webp" disabled={uploading} onChange={event => {const file = event.target.files?.[0]; const position = imageInsertionPosition.current; imageInsertionPosition.current = null; event.target.value = ''; if (file) void insertImage(file, position ?? undefined);}}/>
        {imageError && <p className="novel-error" role="alert">{imageError}</p>}
        {editing ? <div className="novel-manuscript-editor-container" aria-busy={imageLoading}><EditorContent editor={editor} className="novel-manuscript-rich-editor"/>{imageLoading && <div className="novel-image-loading" role="status" aria-live="polite"><LoaderCircle size={24} className="novel-spinner" aria-hidden="true"/><span>{t('memoModal.uploading')}</span></div>}</div> : <article ref={readingRef} className="novel-manuscript-reading" dangerouslySetInnerHTML={{__html: html}}/>}
    </div>;
}
