import { Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

export const MEMO_IMAGE_INITIAL_HEIGHT = 235;

export const MemoImage = Node.create({
    name: 'memoImage',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        return {
            src: { default: null },
            alt: { default: '' },
            width: { default: null },
            height: { default: null },
            initialWidth: { default: null },
            initialHeight: { default: null },
            isExpanded: { default: false },
            imageStyle: {
                default: null,
                parseHTML: element => {
                    const image = element.matches('img') ? element : element.querySelector('img');
                    return image?.getAttribute('style') || null;
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'span[data-memo-image]',
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
                    } : false;
                },
            },
            { tag: 'img[data-memo-image]' },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const { src, alt, width, height, initialWidth, initialHeight, isExpanded, textAlign, imageStyle } = HTMLAttributes;
        const alignmentStyle = textAlign === 'center'
            ? 'margin-left: auto; margin-right: auto;'
            : textAlign === 'right'
                ? 'margin-left: auto; margin-right: 0;'
                : 'margin-left: 0; margin-right: auto;';
        return ['span', mergeAttributes({
            'data-memo-image': '',
            'data-width': width || null,
            'data-height': height || null,
            'data-initial-width': initialWidth || null,
            'data-initial-height': initialHeight || null,
            'data-expanded': isExpanded ? 'true' : null,
            class: 'memo-image-wrapper',
            style: `display: block; max-width: 100%; overflow: hidden; border: 1px solid #e0e0e0; border-radius: 8px;${width ? `width: ${width}px;` : ''}${alignmentStyle}`,
        }), ['img', {
            src,
            alt,
            width: width || null,
            height: height || null,
            loading: 'lazy',
            style: `display: block; width: ${height ? 'auto' : '100%'}; max-width: 100%; height: ${height ? `${height}px` : 'auto'};${imageStyle || ''}`,
        }]];
    },
    addKeyboardShortcuts() {
        const removeSelectedImage = () => {
            const {selection, tr} = this.editor.state;
            if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'memoImage') return false;

            tr.delete(selection.from, selection.to);
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(selection.from, tr.doc.content.size))));
            this.editor.view.dispatch(tr);
            return true;
        };

        return {Backspace: removeSelectedImage, Delete: removeSelectedImage};
    },
    addNodeView() {
        return ({ node, getPos, editor }) => {
            let currentNode = node;
            const wrapper = document.createElement('span');
            const isInlineImage = node.type.spec.inline;
            wrapper.className = `${editor.isEditable ? 'memo-image-wrapper memo-image-editable' : 'memo-image-wrapper'}${isInlineImage ? ' memo-image-inline' : ''}`;
            wrapper.dataset.memoImage = '';
            wrapper.contentEditable = 'false';

            const image = document.createElement('img');
            image.loading = 'lazy';
            let frame: HTMLSpanElement | null = null;
            const render = (currentNode: typeof node) => {
                image.src = currentNode.attrs.src || '';
                image.alt = currentNode.attrs.alt || '';
                image.style.cssText = currentNode.attrs.imageStyle || '';
                const width = currentNode.attrs.width ? `${currentNode.attrs.width}px` : '';
                const height = currentNode.attrs.height ? `${currentNode.attrs.height}px` : '';
                const textAlign = currentNode.attrs.textAlign || 'left';
                image.style.width = height ? 'auto' : '100%';
                image.style.height = height || 'auto';
                if (frame) frame.style.width = width;
                else wrapper.style.width = width;
                if (isInlineImage) {
                    wrapper.style.margin = '0 12px 0 0';
                } else {
                    wrapper.style.marginLeft = textAlign === 'center' || textAlign === 'right' ? 'auto' : '0';
                    wrapper.style.marginRight = textAlign === 'center' ? 'auto' : textAlign === 'right' ? '0' : 'auto';
                }
            };
            render(node);

            if (!editor.isEditable) {
                wrapper.append(image);
                return {
                    dom: wrapper,
                    update(updatedNode) {
                        if (updatedNode.type !== currentNode.type) return false;
                        render(updatedNode);
                        return true;
                    },
                };
            }

            const handle = document.createElement('button');
            handle.type = 'button';
            handle.className = 'memo-image-resize-handle';
            handle.setAttribute('aria-label', 'Resize image');
            frame = document.createElement('span');
            frame.className = 'memo-image-editable-frame';
            frame.append(image, handle);
            wrapper.append(frame);
            render(node);

            let initialX = 0;
            let initialWidth = 0;
            const finishResize = () => {
                window.removeEventListener('pointermove', resize);
                window.removeEventListener('pointerup', finishResize);
                const width = Math.round(frame.getBoundingClientRect().width);
                const position = typeof getPos === 'function' ? getPos() : undefined;
                if (typeof position === 'number') {
                    editor.commands.command(({ tr }) => {
                        tr.setNodeMarkup(position, undefined, {
                            ...currentNode.attrs,
                            width,
                            height: null,
                            isExpanded: false,
                        });
                        return true;
                    });
                }
            };
            const resize = (event: PointerEvent) => {
                const width = Math.max(80, Math.round(initialWidth + event.clientX - initialX));
                frame.style.width = `${width}px`;
            };
            const restoreNaturalWidth = (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                const position = typeof getPos === 'function' ? getPos() : undefined;
                if (typeof position !== 'number' || !image.naturalWidth) return;

                const editorWidth = editor.view.dom.clientWidth;
                const isExpanded = currentNode.attrs.isExpanded;
                const width = isExpanded
                    ? currentNode.attrs.initialWidth || currentNode.attrs.width || image.naturalWidth
                    : Math.min(image.naturalWidth, 720, editorWidth);
                editor.commands.command(({ tr }) => {
                    tr.setNodeMarkup(position, undefined, {
                        ...currentNode.attrs,
                        width,
                        height: isExpanded ? currentNode.attrs.initialHeight : null,
                        initialWidth: currentNode.attrs.initialWidth || currentNode.attrs.width || Math.round(image.getBoundingClientRect().width),
                        initialHeight: currentNode.attrs.initialHeight || currentNode.attrs.height || null,
                        isExpanded: !isExpanded,
                    });
                    return true;
                });
            };
            handle.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                initialX = event.clientX;
                initialWidth = frame.getBoundingClientRect().width;
                window.addEventListener('pointermove', resize);
                window.addEventListener('pointerup', finishResize, { once: true });
            });
            image.addEventListener('dblclick', restoreNaturalWidth);

            return {
                dom: wrapper,
                update(updatedNode) {
                    if (updatedNode.type !== currentNode.type) return false;
                    currentNode = updatedNode;
                    render(updatedNode);
                    return true;
                },
                destroy() {
                    window.removeEventListener('pointermove', resize);
                    window.removeEventListener('pointerup', finishResize);
                    image.removeEventListener('dblclick', restoreNaturalWidth);
                },
            };
        };
    },
});

// Same structure as the email signature image layout: an atomic image followed by editable blocks.
export const MemoImageLayout = Node.create({
    name: 'memoImageLayout',
    group: 'block',
    content: 'memoImage? block+',
    isolating: true,
    parseHTML() {
        return [{tag: 'div[data-memo-image-layout]'}];
    },
    renderHTML({HTMLAttributes}) {
        return ['div', mergeAttributes(HTMLAttributes, {
            'data-memo-image-layout': '',
            class: 'memo-image-layout',
        }), 0];
    },
    addKeyboardShortcuts() {
        const removeSelectedImage = () => {
            const {selection, tr} = this.editor.state;
            if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'memoImage') return false;
            const $from = this.editor.state.doc.resolve(selection.from);
            const isInImageLayout = Array.from({length: $from.depth}, (_, index) => $from.node(index + 1))
                .some(node => node.type.name === this.name);
            if (!isInImageLayout) return false;

            tr.delete(selection.from, selection.to);
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(selection.from, tr.doc.content.size))));
            this.editor.view.dispatch(tr);
            return true;
        };
        return {Backspace: removeSelectedImage, Delete: removeSelectedImage};
    },
});

export const MemoAttachment = Node.create({
    name: 'memoAttachment',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        return {
            href: { default: null },
            filename: { default: '' },
            mimeType: { default: '' },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'a[href*="/memo/"][href*="/attachments/"]',
                priority: 900,
                getAttrs: element => ({
                    href: element.getAttribute('href'),
                    filename: element.getAttribute('download') || element.textContent?.replace(/^📎\s*/, '') || '',
                    mimeType: element.getAttribute('title') || '',
                }),
            },
            { tag: 'a[data-memo-attachment]' },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const { filename, mimeType, ...attributes } = HTMLAttributes;
        return ['a', mergeAttributes(attributes, {
            'data-memo-attachment': '',
            class: 'memo-attachment-link',
            download: filename,
            title: mimeType || filename,
        }), `📎 ${filename}`];
    },
    addKeyboardShortcuts() {
        const removeSelectedAttachment = () => {
            const { selection, tr } = this.editor.state;
            if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'memoAttachment') return false;

            tr.delete(selection.from, selection.to);
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(selection.from, tr.doc.content.size))));
            this.editor.view.dispatch(tr);
            return true;
        };

        return { Backspace: removeSelectedAttachment, Delete: removeSelectedAttachment };
    },
    addNodeView() {
        return ({ node, editor }) => {
            if (!editor.isEditable) {
                const link = document.createElement('a');
                link.className = 'memo-attachment-link';
                link.href = node.attrs.href || '#';
                link.download = node.attrs.filename || '';
                link.title = node.attrs.mimeType || node.attrs.filename || '';
                link.textContent = `📎 ${node.attrs.filename}`;
                return {
                    dom: link,
                    update(updatedNode) {
                        if (updatedNode.type.name !== 'memoAttachment') return false;
                        link.href = updatedNode.attrs.href || '#';
                        link.download = updatedNode.attrs.filename || '';
                        link.title = updatedNode.attrs.mimeType || updatedNode.attrs.filename || '';
                        link.textContent = `📎 ${updatedNode.attrs.filename}`;
                        return true;
                    },
                };
            }

            const attachment = document.createElement('span');
            attachment.className = 'memo-attachment-link';
            attachment.dataset.memoAttachment = '';
            attachment.contentEditable = 'false';

            const render = (currentNode: typeof node) => {
                attachment.textContent = `📎 ${currentNode.attrs.filename}`;
                attachment.title = currentNode.attrs.mimeType || currentNode.attrs.filename;
            };
            render(node);

            return {
                dom: attachment,
                update(updatedNode) {
                    if (updatedNode.type.name !== 'memoAttachment') return false;
                    render(updatedNode);
                    return true;
                },
            };
        };
    },
});
