import {forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {getMarkRange, mergeAttributes, Node as TiptapNode} from '@tiptap/core';
import {useEditor, EditorContent, Editor} from '@tiptap/react';
import {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {NodeSelection, Plugin, TextSelection} from '@tiptap/pm/state';
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

/**
 * Repairs signatures saved while the editor used a shared memo-image marker.
 * That version could leave an empty image wrapper before the actual image;
 * ProseMirror then rendered the wrapper as the thin orange bar seen on edit.
 */
const normalizeLegacySignatureHtml = (html: string): string => {
    if (!html || typeof DOMParser === 'undefined') return html;

    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll<HTMLElement>('div[data-signature-layout]').forEach(layout => {
        const imageWrappers = Array.from(layout.querySelectorAll<HTMLElement>('span[data-signature-image], span[data-memo-image]'));
        imageWrappers.forEach(wrapper => {
            if (!wrapper.querySelector<HTMLImageElement>('img[src]')) wrapper.remove();
        });

        const hasImage = Boolean(layout.querySelector('img[src]'));
        const nextSibling = layout.nextElementSibling;
        if (!hasImage && nextSibling?.matches('span[data-signature-image], span[data-memo-image]')
            && nextSibling.querySelector<HTMLImageElement>('img[src]')) {
            layout.prepend(nextSibling);
        }
    });
    return document.body.innerHTML;
};

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
    addAttributes() {
        return {
            ...this.parent?.(),
            alignment: {
                default: 'left',
                parseHTML: element => element.getAttribute('data-signature-align') || 'left',
                renderHTML: attributes => ({'data-signature-align': attributes.alignment === 'left' ? null : attributes.alignment}),
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'div[data-signature-layout] > img',
                priority: 1_000,
                getAttrs: element => ({
                    src: element.getAttribute('src'),
                    alt: element.getAttribute('alt') || '',
                    width: element.getAttribute('width'),
                    imageStyle: element.getAttribute('style'),
                    alignment: element.getAttribute('data-signature-align') || 'left',
                }),
            },
            {
                // Older signatures used the same marker as memo attachments.
                // Keep reading those only inside a signature layout, then write
                // the unambiguous marker below from this point forward.
                tag: 'div[data-signature-layout] > span[data-memo-image]',
                priority: 1_000,
                getAttrs: element => {
                    const image = element.querySelector('img');
                    return image ? {
                        src: image.getAttribute('src'),
                        alt: image.getAttribute('alt') || '',
                        width: element.getAttribute('data-width'),
                        imageStyle: image.getAttribute('style'),
                        alignment: element.getAttribute('data-signature-align') || 'left',
                    } : false;
                },
            },
            {
                tag: 'span[data-signature-image]',
                priority: 1_000,
                getAttrs: element => {
                    const image = element.querySelector('img');
                    return image ? {
                        src: image.getAttribute('src'),
                        alt: image.getAttribute('alt') || '',
                        width: element.getAttribute('data-width'),
                        height: element.getAttribute('data-height'),
                        initialWidth: element.getAttribute('data-initial-width'),
                        initialHeight: element.getAttribute('data-initial-height'),
                        isExpanded: element.getAttribute('data-expanded') === 'true',
                        imageStyle: image.getAttribute('style'),
                        alignment: element.getAttribute('data-signature-align') || 'left',
                    } : false;
                },
            },
        ];
    },
    renderHTML({HTMLAttributes}) {
        const {src, alt, width, height, initialWidth, initialHeight, isExpanded, imageStyle, alignment = 'left'} = HTMLAttributes;
        const imageLayoutStyle = alignment === 'right'
            ? 'display: block; float: right; margin: 0 0 0 18px;'
            : alignment === 'center'
                ? 'display: block; float: none; margin: 0 auto 10px;'
                : 'display: block; float: left; margin: 0 18px 0 0;';
        return ['span', mergeAttributes({
            'data-signature-image': '',
            'data-width': width || null,
            'data-height': height || null,
            'data-initial-width': initialWidth || null,
            'data-initial-height': initialHeight || null,
            'data-expanded': isExpanded ? 'true' : null,
            'data-signature-align': alignment === 'left' ? null : alignment,
            class: 'memo-image-wrapper',
            // This HTML is sent outside the app, so layout must not depend on
            // the editor stylesheet being available in the recipient's client.
            style: `${imageLayoutStyle}max-width: 100%; overflow: hidden; border: 1px solid #e0e0e0; border-radius: 8px;${width ? `width: ${width}px;` : ''}`,
        }), ['img', {
            src,
            alt,
            width: width || null,
            height: height || null,
            loading: 'lazy',
            // Stored source styles may contain an old width/height. Apply the
            // node's resized dimensions last so preview and editor agree.
            style: `display: block;${imageStyle || ''}width: ${height ? 'auto' : '100%'}; max-width: 100%; height: ${height ? `${height}px` : 'auto'};`,
        }]];
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
    const [isOriginalExpanded, setIsOriginalExpanded] = useState(false);
    const [expandedBodyHeight, setExpandedBodyHeight] = useState<number | null>(null);
    const [originalExpandTop, setOriginalExpandTop] = useState<number | null>(null);
    const colorRef = useRef<HTMLDivElement>(null);
    const linkSelectionRef = useRef({from: 0, to: 0, text: ''});
    const imageInputRef = useRef<HTMLInputElement>(null);
    const isComposingRef = useRef(false);
    const editorBodyRef = useRef<HTMLDivElement>(null);

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
            // Compose mode also needs these nodes to retain the saved signature
            // image. `inlineImages` only controls insertion from the toolbar.
            SignatureImage,
            SignatureLayout,
            MailSignature.configure({locked: lockMailSignature}),
        ],
        content: inlineImages ? normalizeLegacySignatureHtml(content) : content,
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
            editor?.commands.setContent(inlineImages ? normalizeLegacySignatureHtml(html) : html);
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

    useEffect(() => {
        setIsOriginalExpanded(false);
        setExpandedBodyHeight(null);
    }, [originalHtmlSrcDoc]);

    useEffect(() => {
        if (!editor || !originalHtmlSrcDoc || isOriginalExpanded) {
            setOriginalExpandTop(null);
            return;
        }
        const updatePosition = () => {
            const body = editorBodyRef.current;
            const signature = editor.view.dom.querySelector<HTMLElement>('[data-mail-signature]');
            if (!body) return;
            const bodyBounds = body.getBoundingClientRect();
            const anchor = signature || editor.view.dom;
            const visibleNodes = Array.from(anchor.querySelectorAll<HTMLElement>(
                'img, p, h1, h2, h3, li, blockquote, pre',
            )).filter(node => node.tagName === 'IMG' || Boolean(node.textContent?.trim()));
            const visibleBottom = visibleNodes.reduce((bottom, node) => {
                const bounds = node.getBoundingClientRect();
                if (bounds.width === 0 || bounds.height === 0) return bottom;
                const marginBottom = Number.parseFloat(window.getComputedStyle(node).marginBottom) || 0;
                return Math.max(bottom, bounds.bottom + marginBottom);
            }, 0) || anchor.getBoundingClientRect().bottom;
            const preferredTop = visibleBottom - bodyBounds.top + 15;
            setOriginalExpandTop(Math.max(8, preferredTop));
        };
        const frame = requestAnimationFrame(updatePosition);
        const observer = new ResizeObserver(updatePosition);
        observer.observe(editor.view.dom);
        if (editorBodyRef.current) observer.observe(editorBodyRef.current);
        const images = Array.from(editor.view.dom.querySelectorAll('img'));
        images.forEach(image => image.addEventListener('load', updatePosition));
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            images.forEach(image => image.removeEventListener('load', updatePosition));
        };
    }, [editor, isOriginalExpanded, originalHtmlSrcDoc, content]);

    const handleImageUpload = useCallback(() => {
        imageInputRef.current?.click();
    }, []);

    const onImageSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !editor) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (inlineImages) {
                const {selection} = editor.state;
                if (selection instanceof NodeSelection && selection.node.type.name === 'signatureImage') {
                    editor.commands.command(({tr}) => {
                        tr.setNodeMarkup(selection.from, undefined, {
                            ...selection.node.attrs,
                            src: reader.result as string,
                        });
                        return true;
                    });
                    return;
                }
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
        let lastTextPosition: number | null = null;
        editor.state.doc.descendants((node, position) => {
            if (node.isTextblock && node.textContent.trim()) lastTextPosition = position + node.content.size;
            if (node.type.name !== 'mailSignature') return true;
            signaturePosition = position;
            return false;
        });
        if (signaturePosition !== null) {
            editor.chain().focus().setTextSelection(Math.max(1, signaturePosition - 1)).run();
            return;
        }
        if (lastTextPosition !== null) {
            editor.chain().focus().setTextSelection(lastTextPosition).run();
            return;
        }
        editor.commands.focus('end');
    }, [editor]);

    if (!editor) return null;

    const Separator = () => <div className="email-editor-separator"/>;

    return <div className={`email-editor-wrap${lockMailSignature ? ' is-signature-locked' : ''}${originalHtmlSrcDoc ? ' has-original-email' : ''}${isOriginalExpanded ? ' is-original-expanded' : ''}`}>
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
        <div className="email-editor-body" ref={editorBodyRef} onClick={event => {
            if (event.target === event.currentTarget) focusBodyEnd();
        }}>
            <div className="email-editor-content" style={isOriginalExpanded && expandedBodyHeight !== null ? {minHeight: expandedBodyHeight} : undefined} onClick={event => {
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
            {originalHtmlSrcDoc && (isOriginalExpanded ? <div className="email-editor-original">
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
            </div> : <button type="button" className="email-editor-original-expand" style={originalExpandTop === null ? undefined : {top: originalExpandTop}} aria-label={t('googleWorkspace.originalEmail')} title={t('googleWorkspace.originalEmail')} onClick={() => {
                setExpandedBodyHeight(editorBodyRef.current?.clientHeight ?? null);
                setIsOriginalExpanded(true);
            }}>•••</button>)}
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
