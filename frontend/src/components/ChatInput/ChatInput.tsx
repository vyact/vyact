import React, {KeyboardEvent, useEffect, useRef, useState} from 'react';
import ImageViewer from '../ImageViewer/ImageViewer';
import type {ArticleAttachment, KnowledgeCollection} from '../../types';
import {api} from '../../services/api';
import {useCodePanel} from '../../contexts/CodePanelContext';
import {Settings, WandSparkles, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

import {useAttachments} from './useAttachments';
import type {FileAttachment} from './useAttachments';
import {useSlashCommand} from './useSlashCommand';
import AttachmentPreview from './AttachmentPreview';
import ArticleList from './ArticleList';
import InputMenu from './InputMenu';
import McpMenu from './McpMenu';
import McpMentionMenu, {MentionMcpServer} from './McpMentionMenu';
import CustomSelect from '../CustomSelect/CustomSelect';
import type {SelectOption} from '../CustomSelect/CustomSelect';
import CommandModal from './CommandModal';
import {KNOWLEDGE_COLLECTIONS_UPDATED_EVENT, OPEN_KNOWLEDGE_COLLECTIONS_MODAL_EVENT, TEXTAREA_MAX_HEIGHT} from '../../constants/ui';
import {getGoogleWorkspaceStatus} from '../../services/googleWorkspaceStatus';
import {getCachedKnowledgeCollections, updateCachedKnowledgeCollections} from '../../services/knowledgeCollectionsCache';
import type {GoogleCalendarSelection} from '../../types/googleWorkspace';

import './ChatInput.css';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import {findPluginCommand, openPluginModal} from '../../plugins/registry';
import {usePluginExtensions} from '../../plugins/usePluginExtensions';
import KnowledgeCollectionsModal from '../KnowledgeCollectionsModal/KnowledgeCollectionsModal';
import ApprovalControl from './ApprovalControl';

interface ChatInputProps {
    onSend: (message: string, images?: File[], fileAttachments?: FileAttachment[], selectedMcpIds?: string[], knowledgeCollectionId?: string) => void | Promise<boolean>;
    onStop?: () => void;
    disabled?: boolean;        // 전송 버튼만 막음 (입력은 허용)
    isImageMode?: boolean;
    selectedModel?: string;
    modelType?: 'chat' | 'image_gen' | 'image_edit';
    isModelLoading?: boolean;
    focusTrigger?: number;
    resetTrigger?: number;
    externalDragging?: boolean;
    externalDropFiles?: File[];
    onExternalDropHandled?: () => void;
    articles?: ArticleAttachment[];
    onArticleRemove?: (url: string) => void;
    onArticleRemoveAll?: () => void;
    onOpenVoiceChat?: () => void;
    systemPrompts?: { id: string; title: string; content: string }[];
    onSystemPromptSelect?: (promptId: string | null) => void;
    onOpenPdfModal?: () => void;
    onOpenDocumentModal?: () => void;
    onOpenShortcuts?: () => void;
    onOpenSupport?: () => void;
    onOpenMemo?: () => void;
    onOpenQuickMemo?: () => void;
    onOpenGoogleWorkspace?: (messageId?: string, calendarSelection?: GoogleCalendarSelection) => void;
    onToggleGoogleWorkspace?: () => void;
    googleWorkspaceOpen?: boolean;
    activePromptTitle?: string | null;
    selectedPromptId?: string | null;
    onOpenSystemPromptSettings?: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
                                                 onSend,
                                                 onStop,
                                                 disabled = false,
                                                 isImageMode = false,
                                                 selectedModel = '',
                                                 modelType = 'chat',
                                                 isModelLoading = false,
                                                 focusTrigger = 0,
                                                 resetTrigger = 0,
                                                 externalDragging = false,
                                                 externalDropFiles = [],
                                                 onExternalDropHandled,
                                                 articles = [],
                                                 onArticleRemove,
                                                 onArticleRemoveAll,
                                                 onOpenVoiceChat,
                                                 systemPrompts = [],
                                                 onSystemPromptSelect,
                                                 onOpenPdfModal,
                                                 onOpenDocumentModal,
                                                 onOpenShortcuts,
                                                 onOpenSupport,
                                                 onOpenMemo,
                                                 onOpenQuickMemo,
                                                 onOpenGoogleWorkspace,
                                                 onToggleGoogleWorkspace,
                                                 googleWorkspaceOpen = false,
                                                 activePromptTitle,
                                                 selectedPromptId = null,
                                                 onOpenSystemPromptSettings,
                                             }) => {
    const {t} = useTranslation('main');
    const {panel: codePanel} = useCodePanel();
    const panels = usePanelManager();
    const {sidePanels} = usePluginExtensions();
    const [value, setValue] = useState('');
    const [showCommandModal, setShowCommandModal] = useState(false);
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const promptSuggestionsRef = useRef<HTMLDivElement | null>(null);
    const slashSuggestionsRef = useRef<HTMLDivElement | null>(null);
    const shouldScrollSlashSuggestionRef = useRef(false);
    const consumeNextEnterRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [selectedMcps, setSelectedMcps] = useState<MentionMcpServer[]>([]);
    const [mcpMentionQuery, setMcpMentionQuery] = useState<string | null>(null);
    const [mcpMentionIndex, setMcpMentionIndex] = useState(0);
    const [visibleMcpServers, setVisibleMcpServers] = useState<MentionMcpServer[]>([]);
    const [knowledgeCollections, setKnowledgeCollections] = useState<KnowledgeCollection[]>(getCachedKnowledgeCollections);
    const [selectedKnowledgeCollectionId, setSelectedKnowledgeCollectionId] = useState('');
    const [showKnowledgeCollectionsModal, setShowKnowledgeCollectionsModal] = useState(false);

    useEffect(() => {
        const refresh = () => setKnowledgeCollections(getCachedKnowledgeCollections());
        window.addEventListener(KNOWLEDGE_COLLECTIONS_UPDATED_EVENT, refresh);
        return () => window.removeEventListener(KNOWLEDGE_COLLECTIONS_UPDATED_EVENT, refresh);
    }, []);
    useEffect(() => {
        const openCollectionManager = () => setShowKnowledgeCollectionsModal(true);
        window.addEventListener(OPEN_KNOWLEDGE_COLLECTIONS_MODAL_EVENT, openCollectionManager);
        return () => window.removeEventListener(OPEN_KNOWLEDGE_COLLECTIONS_MODAL_EVENT, openCollectionManager);
    }, []);
    useEffect(() => {
        const openNotificationItem = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.type === 'google_mail') {
                onOpenGoogleWorkspace?.(detail.sourceId);
            } else if (detail?.type === 'google_calendar') {
                onOpenGoogleWorkspace?.(undefined, {
                    eventId: detail.eventId,
                    startAt: detail.startAt,
                    requestId: detail.requestId,
                });
            }
        };
        window.addEventListener('vyact:notification-selected', openNotificationItem);
        return () => window.removeEventListener('vyact:notification-selected', openNotificationItem);
    }, [onOpenGoogleWorkspace]);

    // ── hooks ─────────────────────────────────────────────────────
    const attach = useAttachments(modelType, externalDropFiles, onExternalDropHandled, resetTrigger);
    const slash = useSlashCommand([], undefined, setValue);
    const {clearSuggestions} = slash;
    const hasAutocompleteSuggestions = mcpMentionQuery !== null || slash.slashSuggestions.length > 0;

    useEffect(() => {
        if (!hasAutocompleteSuggestions) return;

        const closeAutocompleteOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target as Node;
            if (
                textareaRef.current?.contains(target)
                || promptSuggestionsRef.current?.contains(target)
                || slashSuggestionsRef.current?.contains(target)
            ) {
                return;
            }
            slash.clearSuggestions(); setMcpMentionQuery(null);
        };
        const closeAutocompleteOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            slash.clearSuggestions(); setMcpMentionQuery(null);
        };

        document.addEventListener('pointerdown', closeAutocompleteOnOutsidePointer);
        window.addEventListener('keydown', closeAutocompleteOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeAutocompleteOnOutsidePointer);
            window.removeEventListener('keydown', closeAutocompleteOnEscape);
        };
    }, [hasAutocompleteSuggestions, slash]);

    useEffect(() => {
        if (!shouldScrollSlashSuggestionRef.current) return;
        shouldScrollSlashSuggestionRef.current = false;
        const selectedItem = slashSuggestionsRef.current?.children[slash.selectedSuggestion] as HTMLElement | undefined;
        selectedItem?.scrollIntoView({block: 'nearest'});
    }, [slash.selectedSuggestion]);

    // focusTrigger
    useEffect(() => {
        if (focusTrigger > 0) textareaRef.current?.focus();
    }, [focusTrigger]);

    // resetTrigger
    useEffect(() => {
        if (resetTrigger > 0) {
            void Promise.resolve().then(() => {
                setValue('');
                clearSuggestions();
                if (textareaRef.current) textareaRef.current.style.height = 'auto';
            });
        }
    }, [resetTrigger, clearSuggestions]);

    // 이미지 미리보기 ESC/좌우 키
    useEffect(() => {
        if (previewIndex === null) return;
        const handleKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') setPreviewIndex(null);
            if (e.key === 'ArrowLeft') setPreviewIndex(i => i !== null ? (i - 1 + attach.images.length) % attach.images.length : null);
            if (e.key === 'ArrowRight') setPreviewIndex(i => i !== null ? (i + 1) % attach.images.length : null);
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [previewIndex, attach.images.length]);

    // 커맨드 모달 ESC
    useEffect(() => {
        if (!showCommandModal) return;
        const handleKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowCommandModal(false);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [showCommandModal]);

    useEffect(() => {
        const handleGoogleWorkspaceShortcut = async (event: globalThis.KeyboardEvent) => {
            if (!event.repeat && (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'g') {
                if (googleWorkspaceOpen) {
                    event.preventDefault();
                    onToggleGoogleWorkspace?.();
                    return;
                }
                try {
                    const google = await getGoogleWorkspaceStatus();
                    if (!google.registered || !google.connected) return;
                    event.preventDefault();
                    onToggleGoogleWorkspace?.();
                } catch {
                    // 연결 상태를 확인할 수 없으면 단축키 동작을 막는다.
                }
            }
        };
        window.addEventListener('keydown', handleGoogleWorkspaceShortcut);
        return () => window.removeEventListener('keydown', handleGoogleWorkspaceShortcut);
    }, [googleWorkspaceOpen, onToggleGoogleWorkspace]);

    const autoResize = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const newH = Math.min(textareaRef.current.scrollHeight, TEXTAREA_MAX_HEIGHT);
            textareaRef.current.style.height = newH + 'px';
            textareaRef.current.style.overflowY = textareaRef.current.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
            textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
        }
    };

    const insertCommand = (cmd: string) => {
        setShowCommandModal(false);
        slash.clearSuggestions();
        setValue('');
        const pluginCommand = findPluginCommand(cmd);
        if (pluginCommand) {
            openPluginModal(pluginCommand.modalId);
            return;
        }
        if (cmd === '/memo') {
            onOpenMemo?.();
            return;
        }
        if (cmd === '/quickmemo') {
            onOpenQuickMemo?.();
            return;
        }
        if (cmd === '/presentation' || cmd === '/pdf') {
            onOpenPdfModal?.();
            return;
        }
        if (['/clear', '/remember'].includes(cmd) || cmd.startsWith('/')) {
            onSend(cmd);
            return;
        }
        setValue(cmd + ' ');
        setTimeout(() => {
            textareaRef.current?.focus();
            autoResize();
        }, 50);
    };

    const handleSend = async () => {
        const trimmed = value.trim();
        const pastedAppend = attach.pastedTexts.length > 0
            ? '\n\n' + attach.pastedTexts.map(p => `«PASTE:${p.label}»\n${p.content.replaceAll('«/PASTE»', '«\\/PASTE»')}«/PASTE»`).join('\n\n')
            : '';
        const fullMessage = trimmed + pastedAppend;
        if ((fullMessage.trim() || attach.images.length > 0 || attach.fileAttachments.length > 0 || articles.length > 0) && !disabled) {
            const prevValue = value;
            const prevImages = [...attach.images];
            const prevFiles = [...attach.fileAttachments];
            const prevPastedTexts = [...attach.pastedTexts];
            setValue('');
            attach.clearAll();
            slash.clearSuggestions();
            if (textareaRef.current) textareaRef.current.style.height = 'auto';
            const result = onSend(fullMessage, prevImages, prevFiles, selectedMcps.map(server => server.id), selectedKnowledgeCollectionId || undefined);
            if (result instanceof Promise) {
                const sent = await result;
                if (sent === false) {
                    setValue(prevValue);
                    attach.setImages(prevImages);
                    attach.setFileAttachments(prevFiles);
                    attach.setPastedTexts(prevPastedTexts);
                }
            }
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && consumeNextEnterRef.current) {
            e.preventDefault();
            e.stopPropagation();
            consumeNextEnterRef.current = false;
            return;
        }
        if (
            slash.slashSuggestions.length > 0
            && (e.key === 'ArrowDown' || e.key === 'ArrowUp')
        ) {
            shouldScrollSlashSuggestionRef.current = true;
        }
        if (mcpMentionQuery !== null) {
            if (e.key === 'ArrowDown' && visibleMcpServers.length) { e.preventDefault(); setMcpMentionIndex(index => (index + 1) % visibleMcpServers.length); return; }
            if (e.key === 'ArrowUp' && visibleMcpServers.length) { e.preventDefault(); setMcpMentionIndex(index => (index - 1 + visibleMcpServers.length) % visibleMcpServers.length); return; }
            if (e.key === 'Enter' && !e.shiftKey && visibleMcpServers[mcpMentionIndex]) {
                e.preventDefault();
                e.stopPropagation();
                consumeNextEnterRef.current = true;
                setSelectedMcps(current => current.some(server => server.id === visibleMcpServers[mcpMentionIndex].id) ? current : [...current, visibleMcpServers[mcpMentionIndex]]);
                setValue('');
                setMcpMentionQuery(null);
                return;
            }
            if (e.key === 'Escape') { e.preventDefault(); setMcpMentionQuery(null); setValue(''); return; }
        }
        const consumed = slash.handleKeyDown(e, insertCommand);
        if (consumed) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            if (e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (!disabled) handleSend();
        }
    };

    const placeholder = isModelLoading
        ? t('chatInput.modelLoading')
        : isImageMode
            ? modelType === 'image_edit'
                ? t('chatInput.imageEditPlaceholder')
                : t('chatInput.imageGenPlaceholder')
            : t('chatInput.placeholder');

    return (
        <>
            <div
                className={`chat-input-wrap${codePanel || panels.activePanel ? ' panel-open' : ''}`}
                onDragOver={e => e.preventDefault()}
                style={{position: 'relative'}}
            >
                {mcpMentionQuery !== null && <div ref={promptSuggestionsRef}><McpMentionMenu query={mcpMentionQuery} selectedIds={selectedMcps.map(server => server.id)} activeIndex={mcpMentionIndex} onVisibleServersChange={setVisibleMcpServers} onSelect={server => { setSelectedMcps(current => current.some(item => item.id === server.id) ? current : [...current, server]); setValue(''); setMcpMentionQuery(null); textareaRef.current?.focus(); }}/></div>}

                {/* / 슬래시 자동완성 */}
                {slash.slashSuggestions.length > 0 && (
                    <div className="slash-command-menu">
                        <div className="slash-command-header">{t('inputMenu.commandList')}</div>
                        <div ref={slashSuggestionsRef} className="slash-command-list">
                        {slash.slashSuggestions.map((c, i) => {
                            return (
                            <button type="button"
                                key={c.cmd}
                                onClick={() => insertCommand(c.cmd)}
                                className={`slash-command-item${i === slash.selectedSuggestion ? ' active' : ''}`}
                                onMouseEnter={() => slash.setSelectedSuggestion(i)}
                            >
                                <div>
                                    <div className="slash-command-name">{c.name || c.cmd}</div>
                                    <div className="slash-command-description">{t(`commands.${c.cmd.slice(1)}_desc`, {defaultValue: c.desc})}</div>
                                </div>
                            </button>
                            );
                        })}
                        </div>
                    </div>
                )}

                {/* 드래그 오버레이 */}
                {externalDragging && modelType !== 'image_gen' && (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 10,
                        background: 'rgba(99,102,241,0.12)', border: '2px dashed rgba(99,102,241,0.6)',
                        borderRadius: 'var(--r)', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', pointerEvents: 'none',
                    }}/>
                )}

                <div className={`chat-input-container${isImageMode ? ' image-mode' : ''}`}>
                    {/* 첨부 기사 목록 */}
                    <ArticleList
                        articles={articles}
                        onRemove={url => onArticleRemove?.(url)}
                        onRemoveAll={() => onArticleRemoveAll?.()}
                    />

                    {/* 첨부 미리보기 */}
                    <AttachmentPreview
                        images={attach.images}
                        fileAttachments={attach.fileAttachments}
                        pastedTexts={attach.pastedTexts}
                        modelType={modelType}
                        onRemoveImage={attach.removeImage}
                        onRemoveFile={attach.removeFileAttachment}
                        onRemovePastedText={attach.removePastedText}
                        onImageClick={setPreviewIndex}
                    />

                    {/* textarea 행 */}
                    {selectedMcps.length > 0 && <div className="selected-mcp-chips">
                        {selectedMcps.map(server => {
                            const customName = typeof server.config?.name === 'string' ? server.config.name : server.type;
                            return <div className="selected-mcp-chip" key={server.id}>
                            <span className="selected-mcp-chip-icon">⌘</span>
                            <span>{server.type === 'custom' ? customName : server.type}</span>
                            <button type="button" aria-label={t('mcpMenu.removeSelected')} onClick={() => setSelectedMcps(current => current.filter(item => item.id !== server.id))}><X size={10}/></button>
                        </div>})}
                    </div>}
                    <div className="chat-input-row">
                        <div style={{position: 'relative', flex: 1}}>
                            {isModelLoading && (
                                <div style={{
                                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                                    gap: '8px', padding: '0 14px', borderRadius: '12px',
                                    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
                                    zIndex: 10, pointerEvents: 'all', cursor: 'not-allowed',
                                }}>
                                    <div style={{
                                        width: '14px', height: '14px', flexShrink: 0,
                                        border: '2px solid rgba(255,255,255,0.15)',
                                        borderTopColor: 'var(--accent)', borderRadius: '50%',
                                        animation: 'spin 0.7s linear infinite',
                                    }}/>
                                    <span style={{fontSize: '13px', color: 'var(--muted)'}}>
                                        {selectedModel
                                            ? t('chatInput.modelLoadingWithName', {model: selectedModel})
                                            : t('chatInput.modelLoading')}
                                    </span>
                                </div>
                            )}
                            <textarea
                                ref={textareaRef}
                                className={`chat-input${isImageMode ? ' image-mode-input' : ''}`}
                                placeholder={placeholder}
                                value={value}
                                readOnly={isModelLoading}
                                onChange={e => {
                                    if (isModelLoading) return;
                                    const mention = e.target.value.match(/^@([^\s]*)$/);
                                    setMcpMentionQuery(mention ? mention[1] : null);
                                    if (mention) setMcpMentionIndex(0);
                                    if (!mention) slash.handleValueChange(e.target.value);
                                    setValue(e.target.value);
                                    autoResize();
                                }}
                                onKeyDown={handleKeyDown}
                                onPaste={e => attach.handlePaste(e)}
                                rows={1}
                                style={{width: '100%'}}
                            />
                        </div>
                    </div>

                    {/* 하단 버튼 행 */}
                    <div className="chat-btn-row">
                        <div style={{display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flex: 1}}>
                            <InputMenu
                                modelType={modelType}
                                fileInputRef={attach.fileInputRef}
                                onFileSelect={attach.handleFileSelect}
                                onOpenDocumentModal={() => onOpenDocumentModal?.()}
                                onOpenCommandModal={() => setShowCommandModal(true)}
                                onOpenShortcuts={() => onOpenShortcuts?.()}
                                onOpenSupport={() => onOpenSupport?.()}
                                onOpenMemo={() => onOpenMemo?.()}
                                onOpenQuickMemo={() => onOpenQuickMemo?.()}
                                onOpenGoogleWorkspace={() => onOpenGoogleWorkspace?.()}
                            />

                            <McpMenu/>

                            <ApprovalControl/>

                            <CustomSelect
                                className="chat-system-prompt-select"
                                options={[
                                    {value: '', label: t('sidebar.promptDefault')},
                                    ...systemPrompts.map((prompt): SelectOption => ({value: prompt.id, label: prompt.title})),
                                ]}
                                value={selectedPromptId ?? ''}
                                onChange={promptId => onSystemPromptSelect?.(promptId || null)}
                                placeholder={t('sidebar.promptDefault')}
                                searchable
                                searchPlaceholder={t('sidebar.promptSearch')}
                                clearable
                                onClear={() => onSystemPromptSelect?.(null)}
                                clearLabel={t('systemPromptModal.clearSelection')}
                                searchAction={
                                    <button type="button" className="custom-select-search-action"
                                            aria-label={t('systemPromptModal.title')}
                                            onClick={() => {
                                                onOpenSystemPromptSettings?.();
                                            }}>
                                        <Settings size={15}/>
                                    </button>
                                }
                                renderTrigger={(selectedLabel, open) => (
                                    <>
                                        <span className="custom-select-trigger-label">{activePromptTitle || selectedLabel}</span>
                                        <span className={`custom-select-arrow${open ? ' open' : ''}`}>▼</span>
                                    </>
                                )}
                            />

                            <CustomSelect
                                className="chat-system-prompt-select"
                                options={knowledgeCollections.map(collection => ({value: collection.id, label: collection.name}))}
                                value={selectedKnowledgeCollectionId}
                                onChange={setSelectedKnowledgeCollectionId}
                                placeholder={t('knowledgeCollections.select')}
                                searchable
                                searchPlaceholder={t('knowledgeCollections.search')}
                                clearable
                                onClear={() => setSelectedKnowledgeCollectionId('')}
                                searchAction={<button type="button" className="custom-select-search-action" aria-label={t('knowledgeCollections.title')} onClick={() => setShowKnowledgeCollectionsModal(true)}><Settings size={15}/></button>}
                                renderTrigger={(selectedLabel, open) => <><span className="custom-select-trigger-label">{selectedLabel}</span><span className={`custom-select-arrow${open ? ' open' : ''}`}>▼</span></>}
                            />
                        </div>

                        <div style={{display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, marginLeft: '8px'}}>
                            {!isImageMode && (
                                <button className="voice-chat-btn" onClick={onOpenVoiceChat}
                                        title="음성 모드 사용">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                         strokeWidth="2">
                                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                        <line x1="12" y1="19" x2="12" y2="23"/>
                                        <line x1="8" y1="23" x2="16" y2="23"/>
                                    </svg>
                                </button>
                            )}
                            <button
                                className={`send-btn${isImageMode ? ' image-mode-send' : ''}${disabled && onStop ? ' stop-mode' : ''}`}
                                onClick={disabled && onStop ? onStop : handleSend}
                                disabled={!disabled && !onStop && (!value.trim() && attach.images.length === 0 && attach.fileAttachments.length === 0 && attach.pastedTexts.length === 0)}
                                title={disabled && onStop ? t('chatInput.stop') : disabled ? t('chatInput.waiting') : isImageMode ? t('chatInput.imageGen') : t('chatInput.send')}
                            >
                                {disabled && onStop ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                        <rect x="6" y="6" width="12" height="12" rx="2"/>
                                    </svg>
                                ) : isImageMode ? (
                                    <WandSparkles size={20} strokeWidth={2}/>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="12" y1="18" x2="12" y2="5"/>
                                        <polyline points="6 11 12 5 18 11"/>
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* 미니 플레이어 — chat-btn-row 아래 */}
                    {panels.minimizedPanels.map(panelId => {
                        const definition = sidePanels.find(item => item.id === panelId);
                        return <React.Fragment key={panelId}>
                            {definition?.renderMini?.({panels})}
                        </React.Fragment>;
                    })}
                </div>
            </div>

            {/* 커맨드 모달 */}
            {showCommandModal && (
                <CommandModal onClose={() => setShowCommandModal(false)} onSelect={insertCommand}/>
            )}

            <KnowledgeCollectionsModal
                isOpen={showKnowledgeCollectionsModal}
                collections={knowledgeCollections}
                onClose={() => setShowKnowledgeCollectionsModal(false)}
                onCreate={async data => { const created = await api.createKnowledgeCollection(data); updateCachedKnowledgeCollections(items => [created, ...items]); }}
                onUpdate={async (id, data) => { const updated = await api.updateKnowledgeCollection(id, data); updateCachedKnowledgeCollections(items => items.map(item => item.id === id ? updated : item)); }}
                onDelete={async id => { await api.deleteKnowledgeCollection(id); updateCachedKnowledgeCollections(items => items.filter(item => item.id !== id)); setSelectedKnowledgeCollectionId(current => current === id ? '' : current); }}
                onReorder={async collectionIds => { await api.reorderKnowledgeCollections(collectionIds); updateCachedKnowledgeCollections(items => collectionIds.map(id => items.find(item => item.id === id)).filter((item): item is KnowledgeCollection => Boolean(item))); }}
            />

            {/* 이미지 미리보기 */}
            {previewIndex !== null && attach.images[previewIndex] && (
                <ImageViewer
                    images={attach.images.map(img => ({src: URL.createObjectURL(img), alt: img.name}))}
                    currentIndex={previewIndex}
                    onClose={() => setPreviewIndex(null)}
                    onIndexChange={setPreviewIndex}
                />
            )}
        </>
    );
};

export default ChatInput;
