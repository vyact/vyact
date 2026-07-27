import {forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {getMarkRange, mergeAttributes, Node as TiptapNode} from '@tiptap/core';
import {useEditor, EditorContent, Editor} from '@tiptap/react';
import {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {Plugin, TextSelection} from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import {Table, TableCell, TableHeader, TableRow} from '@tiptap/extension-table';
import {Color, TextStyle} from '@tiptap/extension-text-style';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import {createLowlight, common} from 'lowlight';
import {AlignCenter, AlignLeft, AlignRight, ImagePlus, Link as LinkIcon, Undo2, Redo2, X} from 'lucide-react';
import {MemoTextAlign} from '../MemoModal/MemoTextAlign';
import {RichTextImage, RichTextImageLayout} from '../common/RichTextImage/RichTextImage';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import './EmailEditor.css';

const lowlight = createLowlight(common);
const COLOR_PRESETS = ['#f5f5f5', '#cc785c', '#d88e73', '#2cba66', '#5b89b8', '#a78bfa', '#f2c94c', '#ef6461'];
const MAIL_SIGNATURE_STYLE = 'margin-top: 24px; padding-top: 16px; border-top: 1px solid #d9d9d9; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #222222;';

// Keep the photo outside the editable content while allowing the content to flow around it.
const SignatureLayout = TiptapNode.create({
    name: 'signatureLayout',
    group: 'block',
    content: 'signatureImage block+',
    isolating: true,
    parseHTML() {
        return [{tag: 'div[data-signature-layout]'}];
    },
    renderHTML({HTMLAttributes}) {
        return ['div', mergeAttributes(HTMLAttributes, {'data-signature-layout': '', class: 'signature-layout'}), 0];
    },
});

// Reuse the memo's atom node so resizing never competes with the adjacent editable text.
const SignatureImage = RichTextImage.extend({
    name: 'signatureImage',
    parseHTML() {
        return [
            {
                tag: 'div[data-signature-layout] > img',
                getAttrs: element => ({
                    src: element.getAttribute('src'),
                    alt: element.getAttribute('alt') || '',
                    width: element.getAttribute('width'),
                    imageStyle: element.getAttribute('style'),
                }),
            },
            {
                tag: 'span[data-memo-image]',
                getAttrs: element => {
                    const image = element.querySelector('img');
                    return image ? {
                        src: image.getAttribute('src'),
                        alt: image.getAttribute('alt') || '',
                        width: element.getAttribute('data-width'),
                        imageStyle: image.getAttribute('style'),
                    } : false;
                },
            },
        ];
    },
});

const MailSignature = TiptapNode.create({
    name: 'mailSignature',
    group: 'block',
    content: 'block+',
    defining: true,
    isolating: true,
    addOptions() {
        return {locked: false};
    },
    parseHTML() {
        return [{tag: 'div[data-mail-signature]'}];
    },
    renderHTML({HTMLAttributes}) {
        return ['div', mergeAttributes(HTMLAttributes, {
            'data-mail-signature': 'true',
            style: MAIL_SIGNATURE_STYLE,
        }), 0];
    },
    addKeyboardShortcuts() {
        if (!this.options.locked) return {} as Record<string, () => boolean>;
        return {
            'Mod-a': () => {
                let signaturePosition: number | null = null;
                this.editor.state.doc.descendants((node, position) => {
                    if (node.type.name !== this.name) return true;
                    signaturePosition = position;
                    return false;
                });
                if (signaturePosition === null) return false;

                const selectionEnd = Math.max(1, signaturePosition - 1);
                this.editor.view.dispatch(this.editor.state.tr.setSelection(
                    TextSelection.create(this.editor.state.doc, 1, selectionEnd),
                ));
                return true;
            },
        };
    },
    addProseMirrorPlugins() {
        if (!this.options.locked) return [];
        const getSignatures = (document: ProseMirrorNode) => {
            const signatures: object[] = [];
            document.descendants(node => {
                if (node.type.name === this.name) signatures.push(node.toJSON());
            });
            return signatures;
        };
        return [
            new Plugin({
                filterTransaction: transaction => {
                    if (!transaction.docChanged) return true;
                    return JSON.stringify(getSignatures(transaction.before))
                        === JSON.stringify(getSignatures(transaction.doc));
                },
            }),
        ];
    },
});

const EmailTableCell = TableCell.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            style: {
                default: null,
                parseHTML: element => element.getAttribute('style'),
                renderHTML: attributes => attributes.style ? {style: attributes.style} : {},
            },
        };
    },
});

const normalizeHttpUrl = (value: string): string | null => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return null;
    const normalizedValue = /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;
    try {
        const parsedUrl = new URL(normalizedValue);
        const hasValidHost = parsedUrl.hostname === 'localhost'
            || parsedUrl.hostname.includes('.')
            || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsedUrl.hostname);
        return ['http:', 'https:'].includes(parsedUrl.protocol) && hasValidHost ? normalizedValue : null;
    } catch {
        return null;
    }
};

export interface EmailEditorHandle {
    getHTML: () => string;
    setContent: (html: string) => void;
    focus: () => void;
    editor: Editor | null;
}

interface EmailEditorProps {
    content: string;
    onChange: (html: string) => void;
    placeholder?: string;
    autoFocus?: boolean;
    lockMailSignature?: boolean;
    inlineImages?: boolean;
    /** Ready-to-use srcDoc string for the original email iframe */
    originalHtmlSrcDoc?: string;
}

const EmailEditor = forwardRef<EmailEditorHandle, EmailEditorProps>(({content, onChange, placeholder, autoFocus, lockMailSignature = false, inlineImages = false, originalHtmlSrcDoc}, ref) => {
    const {t} = useTranslation('main');
    const [isColorOpen, setIsColorOpen] = useState(false);
    const [isLinkOpen, setIsLinkOpen] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');
    const [linkText, setLinkText] = useState('');
    const colorRef = useRef<HTMLDivElement>(null);
    const linkSelectionRef = useRef({from: 0, to: 0, text: ''});
    const imageInputRef = useRef<HTMLInputElement>(null);
    const isComposingRef = useRef(false);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({codeBlock: false}),
            Placeholder.configure({placeholder: placeholder || ''}),
            Link.configure({openOnClick: false, autolink: true}),
            Table.configure({resizable: false, HTMLAttributes: {style: 'border-collapse: collapse; border: 0;'}}),
            TableRow,
            TableHeader,
            EmailTableCell,
            TextStyle,
            Color,
            CodeBlockLowlight.configure({lowlight}),
            MemoTextAlign,
            RichTextImage,
            RichTextImageLayout,
            ...(inlineImages ? [SignatureImage, SignatureLayout] : []),
            MailSignature.configure({locked: lockMailSignature}),
        ],
        content,
        autofocus: autoFocus ? 'end' : false,
        onUpdate: ({editor: e}) => {
            // React state updates during IME composition can cancel Korean/Japanese input.
            if (isComposingRef.current || e.view.composing) return;
            onChange(e.getHTML());
        },
    });

    useImperativeHandle(ref, () => ({
        getHTML: () => editor?.getHTML() || '',
        setContent: (html: string) => {
            editor?.commands.setContent(html);
        },
        focus: () => editor?.commands.focus(),
        editor,
    }), [editor]);

    // Close popovers on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (colorRef.current && !colorRef.current.contains(e.target as Node)) setIsColorOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleImageUpload = useCallback(() => {
        imageInputRef.current?.click();
    }, []);

    const onImageSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !editor) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (inlineImages) {
                editor.chain().focus().insertContent({
                    type: 'signatureLayout',
                    content: [
                        {type: 'signatureImage', attrs: {src: reader.result as string, width: 180}},
                        {type: 'paragraph'},
                    ],
                }).focus('end').run();
                return;
            }
            editor.chain().focus().insertContent({type: 'memoImage', attrs: {src: reader.result as string}}).run();
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }, [editor, inlineImages]);

    const applyLink = useCallback(() => {
        if (!editor) return;
        const url = linkUrl.trim();
        const text = linkText.trim() || url;
        const selection = linkSelectionRef.current;
        const chain = editor.chain().focus().setTextSelection({from: selection.from, to: selection.to});
        if (url) {
            const href = normalizeHttpUrl(url);
            if (!href) return;
            if (text && (selection.from === selection.to || text !== selection.text)) {
                chain.insertContent({type: 'text', text, marks: [{type: 'link', attrs: {href}}]}).run();
            } else {
                chain.extendMarkRange('link').setLink({href}).run();
            }
            editor.view.dispatch(editor.state.tr.removeStoredMark(editor.schema.marks.link));
        } else {
            chain.extendMarkRange('link').unsetLink().run();
        }
        setIsLinkOpen(false);
        setLinkUrl('');
        setLinkText('');
    }, [editor, linkText, linkUrl]);

    const openLinkPopover = useCallback(() => {
        if (!editor) return;
        const existing = editor.getAttributes('link').href || '';
        const selection = editor.state.selection;
        const linkRange = selection.empty && existing
            ? getMarkRange(selection.$from, editor.schema.marks.link)
            : null;
        const from = linkRange?.from ?? selection.from;
        const to = linkRange?.to ?? selection.to;
        const selectedText = editor.state.doc.textBetween(from, to, ' ');
        linkSelectionRef.current = {from, to, text: selectedText};
        setLinkUrl(existing);
        setLinkText(selectedText);
        setIsLinkOpen(true);
    }, [editor]);

    const setTextAlign = useCallback((textAlign: 'left' | 'center' | 'right') => {
        if (!editor) return;
        if (editor.isActive('memoImage')) {
            editor.commands.updateAttributes('memoImage', {textAlign});
            return;
        }
        const chain = editor.chain().focus();
        ['paragraph', 'heading', 'blockquote', 'listItem'].forEach(type => {
            chain.updateAttributes(type, {textAlign});
        });
        chain.run();
    }, [editor]);

    const focusBodyEnd = useCallback(() => {
        if (!editor) return;
        let signaturePosition: number | null = null;
        editor.state.doc.descendants((node, position) => {
            if (node.type.name !== 'mailSignature') return true;
            signaturePosition = position;
            return false;
        });
        if (signaturePosition !== null) {
            editor.chain().focus().setTextSelection(Math.max(1, signaturePosition - 1)).run();
            return;
        }
        editor.commands.focus('end');
    }, [editor]);

    if (!editor) return null;

    const Separator = () => <div className="email-editor-separator"/>;

    return <div className={`email-editor-wrap${lockMailSignature ? ' is-signature-locked' : ''}`}>
        <div className="email-editor-toolbar">
            <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'active' : ''} title={t('googleWorkspace.editorToolbar.bold')}><strong>B</strong></button>
            <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'active' : ''} title={t('googleWorkspace.editorToolbar.italic')}><em>I</em></button>
            <button type="button" onClick={() => editor.chain().focus().toggleHeading({level: 1}).run()} className={editor.isActive('heading', {level: 1}) ? 'active' : ''} title={t('googleWorkspace.editorToolbar.heading1')}>H1</button>
            <button type="button" onClick={() => editor.chain().focus().toggleHeading({level: 2}).run()} className={editor.isActive('heading', {level: 2}) ? 'active' : ''} title={t('googleWorkspace.editorToolbar.heading2')}>H2</button>
            <button type="button" onClick={() => editor.chain().focus().toggleHeading({level: 3}).run()} className={editor.isActive('heading', {level: 3}) ? 'active' : ''} title={t('googleWorkspace.editorToolbar.heading3')}>H3</button>
            <Separator/>
            <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? 'active' : ''} title={t('googleWorkspace.editorToolbar.bulletList')}>•</button>
            <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? 'active' : ''} title={t('googleWorkspace.editorToolbar.numberedList')}>1.</button>
            <button type="button" onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive('codeBlock') ? 'active' : ''} title={t('googleWorkspace.editorToolbar.codeBlock')}>{'<>'}</button>
            <Separator/>
            <div className="email-editor-color-picker" ref={colorRef}>
                <button type="button" onClick={() => setIsColorOpen(o => !o)} title={t('googleWorkspace.editorToolbar.textColor')} aria-expanded={isColorOpen}>
                    <span style={{color: editor.getAttributes('textStyle').color || 'var(--text)'}}>A</span>
                </button>
                {isColorOpen && <div className="email-editor-color-popover">
                    <label className="email-editor-custom-color">
                        <span>{t('googleWorkspace.editorToolbar.customColor')}</span>
                        <input type="color" value={editor.getAttributes('textStyle').color || '#ffffff'} onChange={e => editor.chain().focus().setColor(e.target.value).run()}/>
                    </label>
                    <div className="email-editor-color-presets">
                        {COLOR_PRESETS.map((color, index) => <button key={color} type="button" className={`email-editor-color-swatch email-editor-color-swatch-${index + 1}`} aria-label={color} onMouseDown={e => e.preventDefault()} onClick={() => { editor.chain().focus().setColor(color).run(); setIsColorOpen(false); }}/>)}
                    </div>
                </div>}
            </div>
            <Separator/>
            <button type="button" onClick={() => setTextAlign('left')} title={t('googleWorkspace.editorToolbar.alignLeft')}><AlignLeft size={15}/></button>
            <button type="button" onClick={() => setTextAlign('center')} title={t('googleWorkspace.editorToolbar.alignCenter')}><AlignCenter size={15}/></button>
            <button type="button" onClick={() => setTextAlign('right')} title={t('googleWorkspace.editorToolbar.alignRight')}><AlignRight size={15}/></button>
            <Separator/>
            <button type="button" onClick={handleImageUpload} title={t('googleWorkspace.editorToolbar.insertImage')}><ImagePlus size={15}/></button>
            <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onImageSelected}/>
            <div className="email-editor-link-picker">
                <button type="button" onClick={openLinkPopover} className={editor.isActive('link') ? 'active' : ''} title={t('googleWorkspace.editorToolbar.insertLink')}><LinkIcon size={15}/></button>
            </div>
            <Separator/>
            <button type="button" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title={t('googleWorkspace.editorToolbar.undo')}><Undo2 size={15}/></button>
            <button type="button" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title={t('googleWorkspace.editorToolbar.redo')}><Redo2 size={15}/></button>
        </div>
        <div className="email-editor-body">
            <div className="email-editor-content" onClick={event => {
                if (event.target === event.currentTarget || event.target === editor.view.dom) focusBodyEnd();
            }}>
                <EditorContent
                    editor={editor}
                    onCompositionStart={() => { isComposingRef.current = true; }}
                    onCompositionEnd={() => {
                        isComposingRef.current = false;
                        queueMicrotask(() => onChange(editor.getHTML()));
                    }}
                />
            </div>
            {originalHtmlSrcDoc && <div className="email-editor-original">
                <iframe aria-label={t('googleWorkspace.originalEmail')} sandbox="allow-same-origin" scrolling="no" srcDoc={originalHtmlSrcDoc} onLoad={e => {
                    const iframe = e.currentTarget;
                    try {
                        const doc = iframe.contentDocument;
                        if (doc) {
                            // Override restrictive table styles from createEmailDocument
                            const fix = doc.createElement('style');
                            fix.textContent = 'table { table-layout: auto !important; } body * { max-width: none; }';
                            doc.head.appendChild(fix);
                        }
                    } catch {
                        // Cross-origin email content cannot be inspected.
                    }
                    const resize = () => { try { const h = iframe.contentDocument?.documentElement.scrollHeight; if (h) iframe.style.height = h + 'px'; } catch { /* The iframe is not accessible. */ } };
                    resize();
                    try { iframe.contentDocument?.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', resize); }); } catch { /* The iframe is not accessible. */ }
                }}/>
            </div>}
        </div>
        {isLinkOpen && <ModalOverlay className="email-editor-link-overlay" onClose={() => setIsLinkOpen(false)} closeOnBackdrop>
            <section className="email-editor-link-dialog">
                <header>
                    <h3>{t('googleWorkspace.editorToolbar.linkDialogTitle')}</h3>
                    <button type="button" aria-label={t('googleWorkspace.close')} onClick={() => setIsLinkOpen(false)}><X aria-hidden="true" size={22}/></button>
                </header>
                <label>
                    <span>{t('googleWorkspace.editorToolbar.url')}</span>
                    <input autoFocus value={linkUrl} onChange={event => setLinkUrl(event.target.value)} placeholder="https://..." onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } }}/>
                </label>
                <label>
                    <span>{t('googleWorkspace.editorToolbar.displayText')}</span>
                    <input value={linkText} onChange={event => setLinkText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } }}/>
                </label>
                <footer>
                    <button type="button" className="email-editor-link-cancel" onClick={() => setIsLinkOpen(false)}>{t('googleWorkspace.cancel')}</button>
                    <button type="button" className="email-editor-link-apply" onClick={applyLink} disabled={!normalizeHttpUrl(linkUrl)}>{t('googleWorkspace.editorToolbar.apply')}</button>
                </footer>
            </section>
        </ModalOverlay>}
    </div>;
});

EmailEditor.displayName = 'EmailEditor';
export default EmailEditor;
