import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { MarkdownPaste } from './MarkdownPaste';
import { MemoTextAlign } from './MemoTextAlign';
import {MemoAttachment} from './MemoAttachmentNodes';
import {RICH_TEXT_IMAGE_INITIAL_HEIGHT, RichTextImage} from '../common/RichTextImage/RichTextImage';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { AlignCenter, AlignLeft, AlignRight, Ellipsis, FileText, ImagePlus, Link as LinkIcon, LoaderCircle, Paperclip, Pencil, Search, Table2, Trash2, X } from 'lucide-react';

import { api } from '../../services/api';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import ActionMenu from '../common/ActionMenu/ActionMenu';
import KnowledgeCollectionAttachSelect from '../KnowledgeCollectionsModal/KnowledgeCollectionAttachSelect';
import ImageViewer from '../ImageViewer/ImageViewer';
import './MemoModal.css';

const lowlight = createLowlight(common);
const saveShortcutModifier = navigator.platform.toUpperCase().includes('MAC') ? 'Cmd' : 'Ctrl';

interface Memo {
    id: string;
    title: string;
    content: string;
    updated_at: string;
}

interface MemoModalProps {
    onClose: () => void;
    initialMemoId?: string;
}

const MemoEditor: React.FC<{
    initialHtml: string;
    onSave: (html: string) => void | Promise<void>;
    onCancel: () => void;
    onEnsureMemoId: () => Promise<string>;
}> = ({ initialHtml, onSave, onCancel, onEnsureMemoId }) => {
    const { t } = useTranslation('main');
    const slashItems = [
        { label: t('memoModal.slash.heading1'), desc: 'H1', action: (e: any) => e.chain().focus().toggleHeading({ level: 1 }).run() },
        { label: t('memoModal.slash.heading2'), desc: 'H2', action: (e: any) => e.chain().focus().toggleHeading({ level: 2 }).run() },
        { label: t('memoModal.slash.heading3'), desc: 'H3', action: (e: any) => e.chain().focus().toggleHeading({ level: 3 }).run() },
        { label: t('memoModal.slash.bulletList'), desc: '•', action: (e: any) => e.chain().focus().toggleBulletList().run() },
        { label: t('memoModal.slash.numberedList'), desc: '1.', action: (e: any) => e.chain().focus().toggleOrderedList().run() },
        { label: t('memoModal.slash.quote'), desc: '"', action: (e: any) => e.chain().focus().toggleBlockquote().run() },
        { label: t('memoModal.slash.codeBlock'), desc: '<>', action: (e: any) => e.chain().focus().toggleCodeBlock().run() },
        { label: t('memoModal.slash.toggleDetails'), desc: '▶', action: (e: any) => (e.commands as any).setDetails() },
    ];
    const [slashMenu, setSlashMenu] = React.useState<{ visible: boolean; selectedIdx: number }>({ visible: false, selectedIdx: 0 });
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const slashMenuRef = React.useRef<HTMLDivElement>(null);
    const slashMenuStateRef = React.useRef<{ visible: boolean; selectedIdx: number }>({ visible: false, selectedIdx: 0 });
    const slashPosRef = React.useRef<number>(-1);
    // 중복 저장 방지용 상태 (버튼 연타 / Cmd+S 중복 입력 대응)
    const [isSaving, setIsSaving] = React.useState(false);
    const isSavingRef = React.useRef(false);
    const imageInputRef = React.useRef<HTMLInputElement>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [uploadError, setUploadError] = React.useState('');
    const [uploadCount, setUploadCount] = React.useState(0);
    const [tableContextMenu, setTableContextMenu] = React.useState<{x: number; y: number} | null>(null);
    const [selectedTablePosition, setSelectedTablePosition] = React.useState<number | null>(null);
    const [isColorPaletteOpen, setIsColorPaletteOpen] = React.useState(false);
    const colorPaletteRef = React.useRef<HTMLDivElement>(null);
    const [linkDialog, setLinkDialog] = React.useState<{ url: string; text: string; from: number; to: number } | null>(null);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                codeBlock: false,
            }),
            Placeholder.configure({
                placeholder: t('memoModal.editorPlaceholder'),
            }),
            Link.configure({
                openOnClick: true,
                autolink: false,
                HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
            }),
            TextStyle,
            Color,
            CodeBlockLowlight.configure({ lowlight }),
            Details,
            DetailsSummary,
            DetailsContent,
            MarkdownPaste,
            MemoTextAlign,
            Table.configure({ resizable: false }),
            TableRow,
            TableHeader,
            TableCell,
            TaskList,
            TaskItem.configure({ nested: true }),
            RichTextImage,
            MemoAttachment,
        ],
        content: '',
        autofocus: true,
        onTransaction: () => {
            forceUpdate(); // 툴바 active 상태 실시간 동기화
        },
        onUpdate: ({ editor: e }) => {
            const { from } = e.state.selection;
            const isInCode = e.isActive('codeBlock') || e.isActive('code');
            const $from = e.state.selection.$from;
            const lineStart = $from.start();
            const lineText = e.state.doc.textBetween(lineStart, from);

            if (slashMenuStateRef.current.visible) {
                // 슬래시 지웠거나 다른 글자 입력 시 메뉴 닫기
                if (lineText !== '/') {
                    slashPosRef.current = -1;
                    const closed = { visible: false, selectedIdx: 0 };
                    slashMenuStateRef.current = closed;
                    setSlashMenu(closed);
                }
                return;
            }
            if (isInCode) return;
            if (lineText === '/') {
                slashPosRef.current = from - 1;
                const next = { visible: true, selectedIdx: 0 };
                slashMenuStateRef.current = next;
                setSlashMenu(next);
            }
        },
    });

    // editor 준비 후 initialHtml 세팅 (마크다운 파싱 없이 HTML 직접)
    useEffect(() => {
        if (editor && initialHtml) {
            // 서버에서 불러온 초깃값은 undo 이력에 넣지 않는다.
            editor.chain()
                .command(({ tr }) => {
                    tr.setMeta('addToHistory', false);
                    return true;
                })
                .setContent(initialHtml, { emitUpdate: false })
                .run();
        }
    }, [editor, initialHtml]);

    const insertDetailsAndFocus = useCallback(() => {
        if (!editor) return;
        // setDetails는 선택 영역을 새 detailsSummary로 옮긴다. 에디터에도 다시 포커스를 주어
        // 바로 접기/펼치기 제목을 입력할 수 있게 한다.
        (editor.chain() as any).focus().setDetails().run();
    }, [editor]);

    const triggerUndo = useCallback(() => {
        if (editor?.can().undo()) editor.commands.undo();
    }, [editor]);

    const triggerRedo = useCallback(() => {
        if (editor?.can().redo()) editor.commands.redo();
    }, [editor]);

    const setTextAlign = useCallback((textAlign: 'left' | 'center' | 'right') => {
        if (!editor) return;
        if (editor.isActive('memoImage')) {
            editor.commands.updateAttributes('memoImage', {textAlign});
            return;
        }
        const chain = editor.chain().focus();
        ['paragraph', 'heading', 'blockquote', 'listItem', 'tableCell', 'tableHeader'].forEach(type => {
            chain.updateAttributes(type, {textAlign});
        });
        chain.run();
    }, [editor]);

    // 저장 실행 (버튼 연타 / Cmd+S 중복 입력이 겹쳐도 한 번만 저장되도록 가드)
    const triggerSave = useCallback(async () => {
        if (isSavingRef.current || !editor) return;
        isSavingRef.current = true;
        setIsSaving(true);
        try {
            await onSave(editor.getHTML());
        } finally {
            isSavingRef.current = false;
            setIsSaving(false);
        }
    }, [editor, onSave]);

    const uploadAttachment = useCallback(async (file: File, isImage: boolean, memoId?: string) => {
        if (!editor) return;
        setUploadError('');
        setUploadCount(count => count + 1);
        try {
            const targetMemoId = memoId || await onEnsureMemoId();
            const attachment = await api.uploadMemoAttachment(targetMemoId, file);
            // 메일 작성 에디터와 같이 이미지를 원자형 노드로 직접 추가한다.
            // 컨테이너로 감싸면 선택된 이미지의 Backspace/Delete 처리가 브라우저별로 달라질 수 있다.
            const insertPosition = editor.state.selection.to;
            editor.chain().focus().insertContentAt(insertPosition, isImage
                ? {
                    type: 'memoImage',
                    attrs: {
                        src: attachment.url,
                        alt: attachment.filename,
                        height: RICH_TEXT_IMAGE_INITIAL_HEIGHT,
                        initialHeight: RICH_TEXT_IMAGE_INITIAL_HEIGHT,
                    },
                }
                : { type: 'memoAttachment', attrs: { href: attachment.url, filename: attachment.filename, mimeType: attachment.mime_type } }
            ).run();
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : '첨부 파일 업로드에 실패했습니다.');
        } finally {
            setUploadCount(count => Math.max(0, count - 1));
        }
    }, [editor, onEnsureMemoId]);

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>, isImage: boolean) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (files.length === 0) return;
        void (async () => {
            // 새 메모는 첨부 전에 서버 초안을 만들어야 한다. 이 준비 시간도 업로드 진행
            // 표시 범위에 포함해 첫 이미지 선택 직후부터 오버레이가 보이게 한다.
            setUploadCount(count => count + 1);
            try {
                const memoId = await onEnsureMemoId();
                for (const file of files) await uploadAttachment(file, isImage, memoId);
            } finally {
                setUploadCount(count => Math.max(0, count - 1));
            }
        })();
    }, [onEnsureMemoId, uploadAttachment]);

    const openLinkDialog = useCallback(() => {
        if (!editor) return;
        editor.commands.extendMarkRange('link');
        if (editor.state.selection.empty) {
            const {$from} = editor.state.selection;
            const linkedNode = [$from.nodeBefore, $from.nodeAfter].find(node =>
                node?.marks.some(mark => mark.type.name === 'link')
            );
            if (linkedNode) {
                const from = $from.nodeBefore === linkedNode ? $from.pos - linkedNode.nodeSize : $from.pos;
                editor.commands.setTextSelection({from, to: from + linkedNode.nodeSize});
                editor.commands.extendMarkRange('link');
            }
        }
        const { from, to } = editor.state.selection;
        setLinkDialog({
            url: editor.getAttributes('link').href || '',
            text: editor.state.doc.textBetween(from, to, ' '),
            from,
            to,
        });
    }, [editor]);

    const saveLink = useCallback(() => {
        if (!editor || !linkDialog) return;
        const rawUrl = linkDialog.url.trim();
        if (!rawUrl) return;
        const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
        const text = linkDialog.text.trim() || href;
        editor.chain().focus().insertContentAt(
            {from: linkDialog.from, to: linkDialog.to},
            {type: 'text', text, marks: [{type: 'link', attrs: {href}}]},
        ).run();
        setLinkDialog(null);
    }, [editor, linkDialog]);

    const handleEditorPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        if (!editor) return;
        const clipboardHtml = event.clipboardData.getData('text/html');
        if (clipboardHtml) {
            const clipboardDocument = new DOMParser().parseFromString(clipboardHtml, 'text/html');
            const attachmentLinks = Array.from(clipboardDocument.querySelectorAll('a[href*="/memo/"][href*="/attachments/"]'));
            if (attachmentLinks.length > 0) {
                event.preventDefault();
                const attachments = attachmentLinks.map(link => ({
                    type: 'memoAttachment',
                    attrs: {
                        href: link.getAttribute('href'),
                        filename: link.getAttribute('download') || link.textContent?.replace(/^📎\s*/, '') || '',
                        mimeType: link.getAttribute('title') || '',
                    },
                }));
                editor.chain().focus().insertContentAt(editor.state.selection.to, attachments).run();
                return;
            }
        }
        const imageItem = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'));
        const imageFile = imageItem?.getAsFile();
        if (!imageFile) return;

        event.preventDefault();
        void uploadAttachment(imageFile, true);
    }, [editor, uploadAttachment]);

    const selectAttachment = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const attachment = (event.target as HTMLElement).closest('a[href*="/memo/"][href*="/attachments/"], [data-memo-attachment], .memo-attachment-link');
        if (!attachment || !editor) return;

        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        const parent = attachment.parentNode;
        const attachmentIndex = parent ? Array.from(parent.childNodes).indexOf(attachment) : -1;
        const from = parent && attachmentIndex >= 0
            ? editor.view.posAtDOM(parent, attachmentIndex)
            : editor.view.posAtDOM(attachment, 0);
        const to = editor.view.posAtDOM(attachment, attachment.childNodes.length);
        if (editor.state.doc.nodeAt(from)?.type.name === 'memoAttachment') {
            editor.commands.setNodeSelection(from);
        } else {
            // 이미 일반 링크로 저장된 과거 첨부도 라벨 전체를 선택해 Backspace로 제거할 수 있게 한다.
            editor.commands.setTextSelection({ from, to: Math.max(from + 1, to) });
        }
    }, [editor]);

    const selectDetailsByBorder = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!editor) return;
        const details = (event.target as HTMLElement).closest<HTMLElement>('[data-type="details"]');
        if (!details) return;

        const bounds = details.getBoundingClientRect();
        const edgeSize = 8;
        const isBorderClick = event.clientX - bounds.left <= edgeSize
            || bounds.right - event.clientX <= edgeSize
            || event.clientY - bounds.top <= edgeSize
            || bounds.bottom - event.clientY <= edgeSize;
        if (!isBorderClick) return;

        let detailsPosition = -1;
        editor.state.doc.descendants((node, position) => {
            if (node.type.name === 'details' && editor.view.nodeDOM(position) === details) {
                detailsPosition = position;
                return false;
            }
            return true;
        });
        if (detailsPosition < 0) return;
        event.preventDefault();
        event.stopPropagation();
        // ProseMirror의 기본 클릭 처리가 끝난 뒤 블록 선택을 적용해야 텍스트 커서로 덮어쓰지 않는다.
        window.setTimeout(() => editor.commands.setNodeSelection(detailsPosition), 0);
    }, [editor]);

    const selectTableByBorder = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!editor) return;
        const target = event.target as HTMLElement;
        const table = target.closest<HTMLTableElement>('table');
        if (!table || !editor.view.dom.contains(table)) return;
        // 어느 격자선이든 표 선택의 진입점으로 허용하되, 표시 자체는 표 외곽선에만 한다.
        const cell = target.closest<HTMLElement>('td, th');
        const bounds = (cell ?? table).getBoundingClientRect();
        const edgeSize = 7;
        const isBorderClick = event.clientX - bounds.left <= edgeSize
            || bounds.right - event.clientX <= edgeSize
            || event.clientY - bounds.top <= edgeSize
            || bounds.bottom - event.clientY <= edgeSize;
        if (!isBorderClick) {
            setSelectedTablePosition(null);
            return;
        }

        let tablePosition = -1;
        editor.state.doc.descendants((node, position) => {
            if (node.type.name === 'table' && editor.view.nodeDOM(position) === table) {
                tablePosition = position;
                return false;
            }
            return true;
        });
        if (tablePosition < 0) {
            try {
                const domPosition = editor.view.posAtDOM(cell ?? table, 0);
                const $position = editor.state.doc.resolve(domPosition);
                for (let depth = $position.depth; depth > 0; depth -= 1) {
                    if ($position.node(depth).type.name === 'table') {
                        tablePosition = $position.before(depth);
                        break;
                    }
                }
            } catch {
                tablePosition = -1;
            }
        }
        if (tablePosition < 0) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectedTablePosition(tablePosition);
    }, [editor]);

    // 표의 바깥 선을 클릭했을 때만 접기/펼치기와 같은 블록 선택 테두리를 표시한다.
    // 셀 드래그로 선택한 범위(.selectedCell)는 별도 동작으로 유지한다.
    useEffect(() => {
        if (!editor) return;
        editor.view.dom.querySelectorAll('.memo-table-selected').forEach(element => {
            element.classList.remove('memo-table-selected');
        });
        if (selectedTablePosition === null) return;

        const nodeElement = editor.view.nodeDOM(selectedTablePosition) as HTMLElement | null;
        const table = nodeElement?.matches('table')
            ? nodeElement
            : nodeElement?.querySelector<HTMLElement>('table');
        table?.classList.add('memo-table-selected');
        return () => table?.classList.remove('memo-table-selected');
    }, [editor, selectedTablePosition]);

    useEffect(() => {
        if (!isColorPaletteOpen) return;
        const closePalette = (event: MouseEvent) => {
            if (!colorPaletteRef.current?.contains(event.target as Node)) {
                setIsColorPaletteOpen(false);
            }
        };
        window.addEventListener('mousedown', closePalette);
        return () => window.removeEventListener('mousedown', closePalette);
    }, [isColorPaletteOpen]);

    const openTableContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!editor) return;
        const cell = (event.target as HTMLElement).closest('td, th');
        if (!cell || !editor.view.dom.contains(cell)) return;
        event.preventDefault();
        const cellPosition = editor.view.posAtDOM(cell, 0);
        editor.chain().focus().setTextSelection(cellPosition + 1).run();
        setTableContextMenu({x: event.clientX, y: event.clientY});
    }, [editor]);

    const runTableCommand = useCallback((command: string) => {
        const chain = editor?.chain().focus() as any;
        chain?.[command]().run();
        setTableContextMenu(null);
    }, [editor]);

    const handleAttachmentKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!editor) return;
        if (event.key !== 'Backspace' && event.key !== 'Delete') return;

        const selectionNode = window.getSelection()?.anchorNode;
        const selectionElement = selectionNode instanceof HTMLElement
            ? selectionNode
            : selectionNode?.parentElement;
        const attachment = selectionElement?.closest('[data-memo-attachment], .memo-attachment-link');
        if (!attachment || !editor.view.dom.contains(attachment)) return;

        event.preventDefault();

        const from = editor.view.posAtDOM(attachment, 0);
        const to = editor.view.posAtDOM(attachment, attachment.childNodes.length);
        editor.chain().setTextSelection({ from, to: Math.max(from + 1, to) }).deleteSelection().run();
    }, [editor]);

    // 복사/잘라내기 후 붙여넣은 첨부도 편집 중에는 브라우저 링크 동작을 절대 실행하지 않는다.
    useEffect(() => {
        if (!editor) return;
        const preventAttachmentDownload = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const attachment = target.closest('a[href*="/memo/"][href*="/attachments/"], [data-memo-attachment], .memo-attachment-link');
            if (!attachment || !editor.view.dom.contains(attachment)) return;

            event.preventDefault();
            event.stopPropagation();
            const parent = attachment.parentNode;
            const attachmentIndex = parent ? Array.from(parent.childNodes).indexOf(attachment) : -1;
            const from = parent && attachmentIndex >= 0
                ? editor.view.posAtDOM(parent, attachmentIndex)
                : editor.view.posAtDOM(attachment, 0);
            const to = editor.view.posAtDOM(attachment, attachment.childNodes.length);
            if (editor.state.doc.nodeAt(from)?.type.name === 'memoAttachment') {
                editor.commands.setNodeSelection(from);
            } else {
                editor.commands.setTextSelection({ from, to: Math.max(from + 1, to) });
            }
        };
        editor.view.dom.addEventListener('mousedown', preventAttachmentDownload, true);
        editor.view.dom.addEventListener('click', preventAttachmentDownload, true);
        return () => {
            editor.view.dom.removeEventListener('mousedown', preventAttachmentDownload, true);
            editor.view.dom.removeEventListener('click', preventAttachmentDownload, true);
        };
    }, [editor]);

    // / 커맨드 간이 구현
    const applySlashItem = useCallback((idx: number) => {
        if (!editor) return;
        const savedPos = slashPosRef.current;
        slashPosRef.current = -1;
        const closed = { visible: false, selectedIdx: 0 };
        slashMenuStateRef.current = closed;
        setSlashMenu(closed);
        // / 삭제 후 액션
        if (savedPos !== -1) {
            editor.chain().focus().deleteRange({ from: savedPos, to: savedPos + 1 }).run();
        }
        setTimeout(() => {
            if (idx === 7) {
                insertDetailsAndFocus();
                return;
            }
            slashItems[idx].action(editor);
        }, 10);
    }, [editor, insertDetailsAndFocus, slashItems]);

    // window 레벨에서 키 이벤트 처리 (Tiptap 버블링 이슈 우회)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (linkDialog && e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                setLinkDialog(null);
                return;
            }
            if (slashMenuStateRef.current.visible) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashMenu(p => { const next = { ...p, selectedIdx: (p.selectedIdx + 1) % slashItems.length }; slashMenuStateRef.current = next; return next; });
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashMenu(p => { const next = { ...p, selectedIdx: (p.selectedIdx - 1 + slashItems.length) % slashItems.length }; slashMenuStateRef.current = next; return next; });
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applySlashItem(slashMenuStateRef.current.selectedIdx);
                    return;
                }
                if (e.key === 'Escape') {
                    setSlashMenu({ visible: false, selectedIdx: 0 });
                    slashMenuStateRef.current = { visible: false, selectedIdx: 0 };
                    return;
                }
            }
            if (e.key === 'Escape') {
                setSlashMenu({ visible: false, selectedIdx: 0 });
                return;
            }
            if ((e.key === 'Backspace' || e.key === 'Delete') && editor && selectedTablePosition !== null) {
                const table = editor.state.doc.nodeAt(selectedTablePosition);
                if (table?.type.name === 'table') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    editor.chain().focus().deleteRange({
                        from: selectedTablePosition,
                        to: selectedTablePosition + table.nodeSize,
                    }).run();
                    setSelectedTablePosition(null);
                    return;
                }
                setSelectedTablePosition(null);
            }
            // 한글·일본어 IME에서 조합을 확정하는 Enter는 실제 줄바꿈 Enter와 별도 이벤트다.
            // 조합 확정 단계에서 내용을 열면 다음 Enter가 빈 줄을 추가하므로 무시한다.
            if (e.key === 'Enter' && editor && !e.isComposing && e.keyCode !== 229 && !editor.view.composing) {
                const {$head} = editor.state.selection;
                if ($head.parent.type.name === 'detailsSummary') {
                    const detailsPosition = $head.before() - 1;
                    const detailsElement = editor.view.nodeDOM(detailsPosition) as HTMLElement | null;
                    const isOpen = detailsElement?.classList.contains('is-open');
                    if (!isOpen) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        detailsElement?.querySelector<HTMLButtonElement>(':scope > button')?.click();
                        const detailsContentPosition = $head.after() + 1;
                        editor.commands.setTextSelection(detailsContentPosition + 1);
                        return;
                    }
                }
            }
            if (e.key === 'Backspace' && editor) {
                const {$head, empty} = editor.state.selection;
                if (empty && $head.parent.type.name === 'detailsSummary' && $head.parentOffset === 0) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                let detailsContentDepth = -1;
                for (let depth = $head.depth; depth > 0; depth -= 1) {
                    if ($head.node(depth).type.name === 'detailsContent') {
                        detailsContentDepth = depth;
                        break;
                    }
                }
                if (empty && detailsContentDepth > 0 && $head.parentOffset === 0 && $head.index(detailsContentDepth) === 0) {
                    const detailsDepth = detailsContentDepth - 1;
                    const detailsPosition = $head.before(detailsDepth);
                    const summary = editor.state.doc.nodeAt(detailsPosition + 1);
                    if (summary?.type.name === 'detailsSummary') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        editor.commands.setTextSelection(detailsPosition + summary.nodeSize);
                        return;
                    }
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                // 이력이 없더라도 이벤트를 소비해 전역 단축키가 메모 전체를 변경하지 못하게 한다.
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    triggerRedo();
                } else if (editor?.can().undo()) {
                    triggerUndo();
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                e.stopPropagation();
                triggerRedo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                triggerSave();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true); // capture:true - Tiptap보다 먼저
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [editor, onCancel, applySlashItem, triggerSave, triggerUndo, triggerRedo, slashItems.length, linkDialog, selectedTablePosition]);



    return (
        <div className="memo-editor-wrap" style={{ position: 'relative' }}>
            {slashMenu.visible && (
                <div ref={slashMenuRef} style={{
                    position: 'absolute', left: '20px', top: '48px', zIndex: 100,
                    background: 'var(--bg-secondary, #1e1e1e)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '8px', overflow: 'hidden',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    minWidth: '180px',
                }}>
                    {slashItems.map((item, idx) => (
                        <div key={idx}
                             onClick={() => applySlashItem(idx)}
                             style={{
                                 padding: '8px 14px',
                                 cursor: 'pointer',
                                 background: slashMenu.selectedIdx === idx ? 'rgba(255,255,255,0.08)' : 'none',
                                 display: 'flex', alignItems: 'center', gap: '10px',
                                 fontSize: '14px', color: 'var(--text)',
                             }}
                             onMouseEnter={() => setSlashMenu(p => ({ ...p, selectedIdx: idx }))}
                        >
                            <span style={{ color: 'var(--accent)', fontWeight: 600, minWidth: '24px', fontSize: '12px' }}>{item.desc}</span>
                            <span>{item.label}</span>
                        </div>
                    ))}
                </div>
            )}
            <div className="memo-editor-toolbar">
                <button onClick={() => editor?.chain().focus().toggleBold().run()}
                        className={editor?.isActive('bold') ? 'active' : ''} title={t('memoModal.toolbar.bold')}>B</button>
                <button onClick={() => editor?.chain().focus().toggleItalic().run()}
                        className={editor?.isActive('italic') ? 'active' : ''} title={t('memoModal.toolbar.italic')}><i>I</i></button>
                <button onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
                        className={editor?.isActive('heading', { level: 1 }) ? 'active' : ''}>H1</button>
                <button onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                        className={editor?.isActive('heading', { level: 2 }) ? 'active' : ''}>H2</button>
                <button onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
                        className={editor?.isActive('heading', { level: 3 }) ? 'active' : ''}>H3</button>
                <button onClick={() => editor?.chain().focus().toggleBulletList().run()}
                        className={editor?.isActive('bulletList') ? 'active' : ''} title={t('memoModal.toolbar.bulletList')}>≡</button>
                <button onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                        className={editor?.isActive('orderedList') ? 'active' : ''} title={t('memoModal.toolbar.numberedList')}>1.</button>
                <button onClick={() => editor?.chain().focus().toggleBlockquote().run()}
                        className={editor?.isActive('blockquote') ? 'active' : ''} title={t('memoModal.toolbar.quote')}>"</button>
                <button onClick={() => editor?.chain().focus().toggleCode().run()}
                        className={editor?.isActive('code') ? 'active' : ''} title={t('memoModal.toolbar.inlineCode')}>`</button>
                <button onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
                        className={editor?.isActive('codeBlock') ? 'active' : ''} title={t('memoModal.toolbar.codeBlock')}>{'<>'}</button>
                <div className="memo-text-color-picker" ref={colorPaletteRef}>
                    <button type="button" onClick={() => setIsColorPaletteOpen(open => !open)} title={t('memoModal.toolbar.textColor')} aria-expanded={isColorPaletteOpen}>
                        <span style={{ color: editor?.getAttributes('textStyle').color || 'var(--text)' }}>A</span>
                    </button>
                    {isColorPaletteOpen && (
                        <div className="memo-text-color-popover">
                            <label className="memo-custom-color-input">
                                <span>{t('memoModal.toolbar.customColor')}</span>
                                <input type="color" value={editor?.getAttributes('textStyle').color || '#ffffff'} onChange={event => editor?.chain().focus().setColor(event.target.value).run()} />
                            </label>
                            <div className="memo-color-presets" aria-label={t('memoModal.toolbar.vyactColors')}>
                                {['#f5f5f5', '#cc785c', '#d88e73', '#2cba66', '#5b89b8', '#a78bfa', '#f2c94c', '#ef6461'].map(color => (
                                    <button key={color} type="button" className="memo-color-preset" style={{ backgroundColor: color }} aria-label={color} onMouseDown={event => event.preventDefault()} onClick={() => {
                                        editor?.chain().focus().setColor(color).run();
                                        setIsColorPaletteOpen(false);
                                    }} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <button onClick={insertDetailsAndFocus}
                        className={editor?.isActive('details') ? 'active' : ''} title={t('memoModal.toolbar.toggleDetails')}>▶</button>
                <button onClick={() => (editor?.chain() as any)?.focus().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run()}
                        title={t('memoModal.toolbar.addTable')} aria-label={t('memoModal.toolbar.addTable')}><Table2 size={17} aria-hidden="true" /></button>
                <span className="toolbar-sep"/>
                <button onClick={() => setTextAlign('left')} title={t('memoModal.toolbar.alignLeft')}><AlignLeft size={17} /></button>
                <button onClick={() => setTextAlign('center')} title={t('memoModal.toolbar.alignCenter')}><AlignCenter size={17} /></button>
                <button onClick={() => setTextAlign('right')} title={t('memoModal.toolbar.alignRight')}><AlignRight size={17} /></button>
                <span className="toolbar-sep"/>
                <input ref={imageInputRef} className="memo-attachment-input" type="file" accept="image/*" multiple onChange={event => handleFileSelect(event, true)} />
                <button onClick={() => imageInputRef.current?.click()} title={t('memoModal.toolbar.addImage')} aria-label={t('memoModal.toolbar.addImage')}><ImagePlus size={17} aria-hidden="true" /></button>
                <input ref={fileInputRef} className="memo-attachment-input" type="file" multiple onChange={event => handleFileSelect(event, false)} />
                <button onClick={() => fileInputRef.current?.click()} title={t('memoModal.toolbar.addFile')} aria-label={t('memoModal.toolbar.addFile')}><Paperclip size={17} aria-hidden="true" /></button>
                <button onClick={openLinkDialog} title={t('memoModal.toolbar.addLink')} aria-label={t('memoModal.toolbar.addLink')}><LinkIcon size={17} aria-hidden="true" /></button>
                <span className="toolbar-sep"/>
                <button onClick={triggerUndo} title={t('memoModal.toolbar.undo')}>↩</button>
                <button onClick={triggerRedo} title={t('memoModal.toolbar.redo')}>↪</button>
            </div>
            <EditorContent editor={editor} className="memo-editor-content" onPasteCapture={handleEditorPaste} onContextMenuCapture={openTableContextMenu} onMouseDownCapture={event => {
                if (!(event.target as HTMLElement).closest('table')) {
                    setSelectedTablePosition(null);
                }
                selectTableByBorder(event);
                selectDetailsByBorder(event);
                selectAttachment(event);
            }} onClickCapture={event => {
                selectAttachment(event);
            }} onKeyDownCapture={handleAttachmentKeyDown} />
            {uploadCount > 0 && (
                <div className="memo-attachment-upload-overlay" role="status" aria-live="polite">
                    <div className="memo-attachment-upload-dialog">
                        <LoaderCircle className="memo-attachment-upload-spinner" aria-hidden="true" size={28} />
                        <span>{t('memoModal.uploading')}</span>
                    </div>
                </div>
            )}
            {uploadError && <div className="memo-attachment-error" role="alert">{uploadError}</div>}
            {tableContextMenu && (
                <div className="memo-table-context-menu" style={{left: tableContextMenu.x, top: tableContextMenu.y}} onMouseDown={event => event.preventDefault()}>
                    <button onClick={() => runTableCommand('addRowBefore')}>↑ {t('memoModal.tableMenu.addRowAbove')}</button>
                    <button onClick={() => runTableCommand('addRowAfter')}>↓ {t('memoModal.tableMenu.addRowBelow')}</button>
                    <button onClick={() => runTableCommand('addColumnBefore')}>← {t('memoModal.tableMenu.addColumnLeft')}</button>
                    <button onClick={() => runTableCommand('addColumnAfter')}>→ {t('memoModal.tableMenu.addColumnRight')}</button>
                    <button onClick={() => runTableCommand('deleteRow')}>{t('memoModal.tableMenu.deleteRow')}</button>
                    <button onClick={() => runTableCommand('deleteColumn')}>{t('memoModal.tableMenu.deleteColumn')}</button>
                    <button className="danger" onClick={() => runTableCommand('deleteTable')}>{t('memoModal.tableMenu.deleteTable')}</button>
                </div>
            )}
            <div className="memo-editor-footer">
                <span className="memo-hint">{t('memoModal.saveShortcut', { shortcut: `${saveShortcutModifier}+S` })}</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="memo-btn-cancel" onClick={onCancel} disabled={isSaving}>{t('memoModal.cancel')}</button>
                    <button className="memo-btn-save" onClick={triggerSave} disabled={isSaving}>
                        {isSaving ? t('memoModal.saving') : t('memoModal.save')}
                    </button>
                </div>
            </div>
            {linkDialog && (
                <ModalOverlay className="memo-link-modal-overlay" onClose={() => setLinkDialog(null)} closeOnBackdrop>
                    <div className="memo-link-modal" onClick={event => event.stopPropagation()}>
                        <div className="memo-link-modal-header">
                            <h3>{t('memoModal.linkDialog.title')}</h3>
                            <button type="button" onClick={() => setLinkDialog(null)} aria-label={t('memoModal.cancel')}><X size={22} /></button>
                        </div>
                        <label><span>{t('memoModal.linkDialog.url')}</span><input autoFocus type="url" value={linkDialog.url} onChange={event => setLinkDialog(current => current ? {...current, url: event.target.value} : current)} /></label>
                        <label><span>{t('memoModal.linkDialog.text')}</span><input type="text" value={linkDialog.text} onChange={event => setLinkDialog(current => current ? {...current, text: event.target.value} : current)} onKeyDown={event => { if (event.key === 'Enter') saveLink(); }} /></label>
                        <div className="memo-link-modal-actions">
                            <button type="button" className="memo-btn-cancel" onClick={() => setLinkDialog(null)}>{t('memoModal.cancel')}</button>
                            <button type="button" className="memo-btn-save" onClick={saveLink} disabled={!linkDialog.url.trim()}>{t('memoModal.linkDialog.save')}</button>
                        </div>
                    </div>
                </ModalOverlay>
            )}
        </div>
    );
};

const MemoModal: React.FC<MemoModalProps> = ({ onClose, initialMemoId }) => {
    const { t, i18n } = useTranslation('main');
    const [memos, setMemos] = useState<Memo[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [memoActionsId, setMemoActionsId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null); // null = 새 메모
    const [editingHtml, setEditingHtml] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [loading, setLoading] = useState(true);
    const memoLoadSequenceRef = React.useRef(0);
    const editingIdRef = React.useRef<string | null>(null);
    const draftMemoIdRef = React.useRef<string | null>(null);
    const draftMemoCreationRef = React.useRef<Promise<string> | null>(null);

    const memoNeedle = searchQuery.trim().normalize('NFC').toLowerCase();
    const filteredMemos = memoNeedle
        ? memos.filter(m =>
            m.title?.normalize('NFC').toLowerCase().includes(memoNeedle) ||
            m.content?.normalize('NFC').toLowerCase().includes(memoNeedle)
        )
        : memos;

    const loadMemos = useCallback(async (showLoading = true) => {
        const requestSequence = ++memoLoadSequenceRef.current;
        if (showLoading) setLoading(true);
        try {
            const res = await api.listMemos();
            if (requestSequence === memoLoadSequenceRef.current) {
                setMemos(res.memos || []);
            }
        } catch {
            if (requestSequence === memoLoadSequenceRef.current) {
                setMemos([]);
            }
        } finally {
            if (showLoading && requestSequence === memoLoadSequenceRef.current) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        loadMemos();
    }, [loadMemos]);

    // 외부에서 특정 메모 ID로 열린 경우 자동 선택
    useEffect(() => {
        if (initialMemoId) setSelectedId(initialMemoId);
    }, [initialMemoId]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (deleteConfirm) {
                e.preventDefault();
                e.stopImmediatePropagation();
                setDeleteConfirm(null);
                return;
            }
            if (isEditing) {
                // 포커스가 툴바·사이드바로 옮겨져도 전역 Esc 핸들러가 편집 모달을 닫지 못하게 한다.
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            if (!isEditing) {
                onClose();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [deleteConfirm, isEditing, onClose]);

    const handleNew = () => {
        setIsEditing(false); // 기존 편집 취소
        setEditingId(null);
        editingIdRef.current = null;
        draftMemoIdRef.current = null;
        draftMemoCreationRef.current = null;
        setEditingHtml('');
        setSelectedId(null);
        setTimeout(() => setIsEditing(true), 0);
    };

    const handleEdit = async (id: string) => {
        setIsEditing(false); // 기존 편집 취소
        const memo = await api.getMemo(id);
        setEditingId(id);
        editingIdRef.current = id;
        draftMemoIdRef.current = null;
        draftMemoCreationRef.current = null;
        setEditingHtml(memo.content_html || '');
        setSelectedId(id);
        setTimeout(() => setIsEditing(true), 0);
    };

    const handleSave = async (html: string) => {
        if (!html || html === '<p></p>') return;
        const targetMemoId = editingIdRef.current;
        if (targetMemoId) {
            await api.updateMemo(targetMemoId, html);
            setSelectedId(targetMemoId);
        } else {
            const res = await api.createMemo(html);
            if (res?.id) setSelectedId(res.id);
        }
        editingIdRef.current = null;
        draftMemoIdRef.current = null;
        draftMemoCreationRef.current = null;
        setEditingId(null);
        setIsEditing(false);
        await loadMemos(false);
    };

    const ensureMemoId = useCallback(async () => {
        if (editingIdRef.current) return editingIdRef.current;
        if (!draftMemoCreationRef.current) {
            draftMemoCreationRef.current = (async () => {
                const result = await api.createMemo('<p></p>');
                if (!result?.id) throw new Error('메모를 준비하지 못했습니다.');
                editingIdRef.current = result.id;
                draftMemoIdRef.current = result.id;
                setEditingId(result.id);
                setSelectedId(result.id);
                return result.id;
            })();
        }
        try {
            return await draftMemoCreationRef.current;
        } catch (error) {
            draftMemoCreationRef.current = null;
            throw error;
        }
    }, []);

    const handleCancelEdit = useCallback(async () => {
        const draftMemoId = draftMemoIdRef.current;
        if (draftMemoId) {
            await api.deleteMemo(draftMemoId);
            if (selectedId === draftMemoId) setSelectedId(null);
            draftMemoIdRef.current = null;
            editingIdRef.current = null;
            draftMemoCreationRef.current = null;
        } else if (editingIdRef.current) {
            await api.cleanupMemoAttachments(editingIdRef.current, editingHtml);
        }
        setIsEditing(false);
        setEditingId(null);
        await loadMemos(false);
    }, [editingHtml, loadMemos, selectedId]);

    const closeMemoModal = useCallback(async () => {
        if (isEditing) await handleCancelEdit();
        onClose();
    }, [handleCancelEdit, isEditing, onClose]);

    const handleDelete = (id: string, title: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setDeleteConfirm({ id, title });
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        const { id } = deleteConfirm;
        await api.deleteMemo(id);
        if (selectedId === id) setSelectedId(null);
        if (editingId === id || selectedId === id) {
            setIsEditing(false);
            setEditingId(null);
            editingIdRef.current = null;
            setEditingHtml('');
        }
        setDeleteConfirm(null);
        await loadMemos();
    };

    const formatDate = (iso: string) => {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <ModalOverlay className="memo-modal-overlay">
            <div className="memo-modal" style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                {loading && (
                    <div className="memo-loading-overlay" role="status" aria-live="polite">
                        <div className="memo-loading-dialog">
                            <LoaderCircle className="memo-loading-spinner" aria-hidden="true" size={28} />
                            <span>{t('memoModal.loading')}</span>
                        </div>
                    </div>
                )}
                {deleteConfirm && (
                    <ConfirmModal
                        title={deleteConfirm.title || t('memoModal.untitled')}
                        description={t('memoModal.deleteConfirm')}
                        options={[
                            {label: t('memoModal.cancel'), value: 'cancel'},
                            {label: t('memoModal.delete'), value: 'delete', variant: 'danger'},
                        ]}
                        actionLayout="horizontal"
                        onClose={() => setDeleteConfirm(null)}
                        onSelect={value => {
                            if (value === 'delete') void confirmDelete();
                            else setDeleteConfirm(null);
                        }}
                    />
                )}
                {/* 헤더 */}
                <div className="memo-modal-header">
                    <div className="memo-title-wrap">
                        <FileText className="memo-title-icon" aria-hidden="true" />
                        <span className="memo-title">{t('memoModal.title')}</span>
                        {memos.length > 0 && <span className="memo-count">{memos.length}</span>}
                    </div>
                    <button className="memo-close-btn" onClick={() => { void closeMemoModal(); }} aria-label={t('common.close')}>
                        ×
                    </button>
                </div>

                <div className="memo-modal-body">
                    {/* 사이드바 - 목록 */}
                    <div className="memo-sidebar">
                        <button className="memo-new-btn" onClick={handleNew}>{t('memoModal.newMemo')}</button>
                        <div className="memo-search-wrap">
                            <Search className="memo-search-icon" aria-hidden="true" />
                            <input
                                className="memo-search-input"
                                placeholder={t('common:search')}
                                aria-label={t('memoModal.searchPlaceholder')}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button className="memo-search-clear" onClick={() => setSearchQuery('')} aria-label={`${t('common.search')} ${t('common.close')}`}>
                                    <X aria-hidden="true" />
                                </button>
                            )}
                        </div>
                        {!loading && filteredMemos.length === 0 && (
                            <div className="memo-empty">{searchQuery ? t('memoModal.noSearchResults') : t('memoModal.empty')}</div>
                        )}
                        {filteredMemos.map(memo => (
                            <div
                                key={memo.id}
                                className={`memo-item ${((isEditing ? editingId : selectedId) === memo.id) ? 'selected' : ''} ${isEditing && editingId === memo.id ? 'editing' : ''} ${isEditing && editingId !== memo.id ? 'locked' : ''}`}
                                onClick={() => {
                                    if (!isEditing) {
                                        setSelectedId(memo.id);
                                        setMemoActionsId(null);
                                    }
                                }}
                                onDoubleClick={() => {
                                    if (!isEditing) void handleEdit(memo.id);
                                }}
                                aria-disabled={isEditing && editingId !== memo.id}
                            >
                                <div className="memo-item-title">{memo.title || t('memoModal.untitled')}</div>
                                <div className="memo-item-meta">
                                    <span>{formatDate(memo.updated_at)}</span>
                                    <ActionMenu className="memo-actions-menu" isOpen={memoActionsId === memo.id} onOpenChange={open => setMemoActionsId(open ? memo.id : null)} disabled={isEditing} ariaLabel={t('common.more')} triggerClassName="memo-more-btn" menuClassName="memo-actions-popup" trigger={<Ellipsis aria-hidden="true" />}>
                                        <button className="memo-action-menu-item" onClick={() => { setMemoActionsId(null); if (!isEditing) void handleEdit(memo.id); }}><Pencil aria-hidden="true" />{t('memoModal.edit')}</button>
                                        <KnowledgeCollectionAttachSelect source={{source_type: 'memo', source_id: memo.id}} onCreateCollection={onClose} onSelectionComplete={() => setMemoActionsId(null)} menuItem/>
                                        <button className="memo-action-menu-item memo-action-menu-item--danger" onClick={(e) => { setMemoActionsId(null); if (!isEditing) handleDelete(memo.id, memo.title, e); }}><Trash2 aria-hidden="true" />{t('memoModal.delete')}</button>
                                    </ActionMenu>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 메인 영역 */}
                    <div className="memo-main">
                        {isEditing ? (
                            <MemoEditor
                                initialHtml={editingHtml}
                                onSave={handleSave}
                                onCancel={() => { void handleCancelEdit(); }}
                                onEnsureMemoId={ensureMemoId}
                            />
                        ) : selectedId ? (
                            <MemoViewer memoId={selectedId} onEdit={() => handleEdit(selectedId)} />
                        ) : (
                            <div className="memo-placeholder">
                                {t('memoModal.selectOrCreate')}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ModalOverlay>
    );
};

export const MemoViewer: React.FC<{ memoId: string; onEdit?: () => void }> = ({ memoId }) => {
    const { t } = useTranslation('main');
    const [initialHtml, setInitialHtml] = React.useState<string | null>(null);
    const [viewerIndex, setViewerIndex] = React.useState<number | null>(null);
    useEffect(() => {
        api.getMemo(memoId).then(m => setInitialHtml(m.content_html || ''));
    }, [memoId]);

    const viewerRef2 = React.useRef<HTMLDivElement>(null);

    const viewerEditor = useEditor({
        extensions: [
            StarterKit.configure({ codeBlock: false }),
            CodeBlockLowlight.configure({ lowlight }),
            Details.configure({
                persist: true,
                openClassName: 'is-open',
            }),
            DetailsSummary,
            DetailsContent,
            Table.configure({ resizable: false }),
            MemoTextAlign,
            TableRow,
            TableHeader,
            TableCell,
            TaskList,
            TaskItem.configure({ nested: true }),
            Link.configure({ HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
            RichTextImage,
            MemoAttachment,
        ],
        content: '',
        editable: false,
        onUpdate: () => {
            // DOM 업데이트 후 summary 클릭 이벤트 재등록
            setTimeout(() => {
                if (!viewerRef2.current) return;
                viewerRef2.current.querySelectorAll<HTMLElement>('summary').forEach(summary => {
                    if ((summary as any)._clickBound) return;
                    (summary as any)._clickBound = true;
                    summary.style.cursor = 'pointer';
                    summary.addEventListener('click', () => {
                        const details = summary.closest('[data-type="details"]');
                        if (!details) return;
                        const btn = details.querySelector<HTMLButtonElement>(':scope > button');
                        if (btn) btn.click();
                    });
                });
            }, 50);
        },
    });

    useEffect(() => {
        if (viewerEditor && initialHtml !== null) {
            viewerEditor.commands.setContent(initialHtml);
        }
    }, [viewerEditor, initialHtml]);

    const memoImages = React.useMemo(() => {
        if (!initialHtml) return [];
        const document = new DOMParser().parseFromString(initialHtml, 'text/html');
        return Array.from(document.querySelectorAll('img[data-memo-image], [data-memo-image] img'))
            .map(image => ({ src: image.getAttribute('src') || '', alt: image.getAttribute('alt') || '' }))
            .filter(image => image.src);
    }, [initialHtml]);

    const handleImageClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const image = (event.target as HTMLElement).closest('img');
        if (!image) return;
        const index = memoImages.findIndex(item => item.src === image.getAttribute('src'));
        if (index < 0) return;
        event.preventDefault();
        setViewerIndex(index);
    }, [memoImages]);

    // 코드블럭 복사 버튼
    useEffect(() => {
        if (!viewerRef2.current) return;
        const preBlocks = viewerRef2.current.querySelectorAll<HTMLElement>('pre');
        preBlocks.forEach((pre: HTMLElement) => {
            if (pre.querySelector('.memo-code-copy')) return;
            const btn = document.createElement('button');
            btn.className = 'memo-code-copy';
            btn.textContent = t('memoModal.copy');
            btn.onclick = () => {
                const code = pre.querySelector('code');
                navigator.clipboard?.writeText(code?.innerText || '');
                btn.textContent = t('memoModal.copied');
                setTimeout(() => { btn.textContent = t('memoModal.copy'); }, 1500);
            };
            pre.style.position = 'relative';
            pre.appendChild(btn);
        });
    }, [t]);

    return (
        <div className="memo-viewer">
            <div ref={viewerRef2} className="memo-viewer-content" onClickCapture={handleImageClick}>
                <EditorContent editor={viewerEditor} />
            </div>
            {viewerIndex !== null && memoImages.length > 0 && (
                <ImageViewer
                    images={memoImages}
                    currentIndex={viewerIndex}
                    onClose={() => setViewerIndex(null)}
                    onIndexChange={setViewerIndex}
                />
            )}
        </div>
    );
};

export default MemoModal;
