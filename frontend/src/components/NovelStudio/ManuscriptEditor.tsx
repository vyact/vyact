import {Pencil, Check, ImagePlus, LoaderCircle} from 'lucide-react';
import {renderMarkdown} from '../../utils/markdownUtils';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useEditor, EditorContent} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {RichTextImage} from '../common/RichTextImage/RichTextImage';
import {documentToManuscript, manuscriptToDocument} from './manuscriptDocument';
import type {Chapter} from './storyStorage';

export default function ManuscriptEditor({chapter, onChange}: {chapter: Chapter; onChange: (patch: Partial<Chapter>) => void}) {
    const {t} = useTranslation('main');
    const [editing, setEditing] = useState(!chapter.text.trim());
    const [draft, setDraft] = useState({title: chapter.title, text: chapter.text});
    const uploadedImages = useRef<{url: string; deleteToken: string}[]>([]);
    const deleteImage = async (image: {url: string; deleteToken: string}) => {
        const response = await fetch(image.url, {method: 'DELETE', headers: {'X-Image-Delete-Token': image.deleteToken}, keepalive: true});
        if (!response.ok && response.status !== 404) throw new Error('Image cleanup failed');
    };
    useEffect(() => () => {for (const image of uploadedImages.current) void deleteImage(image).catch(() => {});}, []);
    const cancelEditing = async () => {
        setUploading(true); setImageError('');
        try {
            await Promise.all(uploadedImages.current.map(deleteImage));
            uploadedImages.current = [];
            setDraft({title: chapter.title, text: chapter.text}); setEditing(false);
        } catch {setImageError(t('novelStudio.imageCleanupError'));}
        finally {setUploading(false);}
    };
    const saveEditing = async () => {
        setUploading(true); setImageError('');
        try {
            await Promise.all(uploadedImages.current.filter(image => !draft.text.includes(image.url)).map(deleteImage));
            onChange(draft); uploadedImages.current = []; setEditing(false);
        } catch {setImageError(t('novelStudio.imageCleanupError'));}
        finally {setUploading(false);}
    };
    const html = useMemo(() => editing ? '' : renderMarkdown(chapter.text), [chapter.text, editing]);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const imageInsertionPosition = useRef<number | null>(null);
    const [uploading, setUploading] = useState(false);
    const [imageLoading, setImageLoading] = useState(false);
    const [imageError, setImageError] = useState('');
    const editor = useEditor({
        extensions: [StarterKit.configure({heading: false, bold: false, italic: false, strike: false, code: false, codeBlock: false, blockquote: false, bulletList: false, orderedList: false, horizontalRule: false, link: false, underline: false}), RichTextImage],
        content: manuscriptToDocument(chapter.text),
        enableInputRules: false,
        enablePasteRules: false,
        editorProps: {
            attributes: {'aria-label': t('novelStudio.text'), class: 'novel-manuscript-visual'},
            handlePaste: (view, event) => {
                const file = Array.from(event.clipboardData?.files ?? []).find(item => item.type.startsWith('image/'));
                if (!file) return false;
                event.preventDefault(); void insertImage(file, view.state.selection.from); return true;
            },
        },
        onUpdate: ({editor: current}) => setDraft(previous => ({...previous, text: documentToManuscript(current.getJSON())})),
    });
    useEffect(() => {editor?.setEditable(!uploading);}, [editor, uploading]);
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
            if (!mounted.current) {await deleteImage(result); return;}
            uploadedImages.current.push(result);
            const preview = new Image();
            preview.src = result.url;
            await preview.decode();
            if (!mounted.current) return;
            if (draft.text.length + result.url.length > 999900) throw new Error('Manuscript too long');
            editor.chain().focus().insertContentAt(position, [{type: 'memoImage', attrs: {src: result.url, alt: ''}}, {type: 'paragraph'}]).run();
        } catch {setImageError(t('novelStudio.imageUploadError'));}
        finally {setUploading(false); setImageLoading(false);}
    };
    return <div className="novel-manuscript-page">
        <header className="novel-manuscript-heading">{editing ? <input className="novel-chapter-title" aria-label={t('novelStudio.chapterTitle')} maxLength={200} disabled={uploading} value={draft.title} onChange={event => setDraft(previous => ({...previous, title: event.target.value}))}/> : <h2>{chapter.title}</h2>}<div className="novel-manuscript-edit-actions">{editing && <button type="button" className="modal-action-cancel" disabled={uploading} onMouseDown={event => event.preventDefault()} onClick={() => {if (!editor) return; imageInsertionPosition.current = editor.state.selection.from; imageInputRef.current?.click();}}>{imageLoading ? <LoaderCircle size={16} className="novel-spinner" aria-hidden="true"/> : <ImagePlus size={16}/>}<span>{t(imageLoading ? 'memoModal.uploading' : 'memoModal.toolbar.addImage')}</span></button>}{editing && <button type="button" className="modal-action-cancel" disabled={uploading} onClick={() => void cancelEditing()}>{t('novelStudio.cancelEdit')}</button>}<button type="button" className="modal-action-cancel" aria-pressed={editing} data-tooltip-disabled="" disabled={uploading} onClick={() => {if (editing) void saveEditing(); else {setDraft({title: chapter.title, text: chapter.text}); setImageError(''); editor?.commands.setContent(manuscriptToDocument(chapter.text)); setEditing(true);}}}>{editing ? <Check size={15}/> : <Pencil size={15}/>}<span>{t(`novelStudio.${editing ? 'finishManuscriptEdit' : 'editManuscript'}`)}</span></button></div></header>
        <input ref={imageInputRef} type="file" className="novel-image-input" accept="image/png,image/jpeg,image/gif,image/webp" disabled={uploading} onChange={event => {const file = event.target.files?.[0]; const position = imageInsertionPosition.current; imageInsertionPosition.current = null; event.target.value = ''; if (file) void insertImage(file, position ?? undefined);}}/>
        {imageError && <p className="novel-error" role="alert">{imageError}</p>}
        {editing ? <div className="novel-manuscript-editor-container" aria-busy={imageLoading}><EditorContent editor={editor} className="novel-manuscript-rich-editor"/>{imageLoading && <div className="novel-image-loading" role="status" aria-live="polite"><LoaderCircle size={24} className="novel-spinner" aria-hidden="true"/><span>{t('memoModal.uploading')}</span></div>}</div> : <article className="novel-manuscript-reading" dangerouslySetInnerHTML={{__html: html}}/>}
    </div>;
}
