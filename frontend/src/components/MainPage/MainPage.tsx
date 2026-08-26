import React, {useEffect, useState, useCallback, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import Sidebar from '../Sidebar';
import ChatArea from '../ChatArea';
import ChatInput from '../ChatInput';
import {CodePanelProvider} from '../../contexts/CodePanelContext';
import {PanelManagerProvider} from '../../contexts/PanelManagerContext';
import {PluginPanelCoordinator, PluginProviders} from '../../plugins/PluginRuntimeHost';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {api} from '../../services/api';
import type {GoogleCalendarSelection} from '../../types/googleWorkspace';
import type {DriveFile} from '../GoogleWorkspacePanel/DrivePanel';
import type {Message} from '../../types';
import type {Gov24Document} from '../../services/api';

import {useModels} from './useModels';
import {useConversation} from './useConversation';
import {useChat} from './useChat';
import {useGlobalKeyboard} from './useGlobalKeyboard';
import TitleBar from '../TitleBar/TitleBar';
import './MainPage.css';
import {usePluginExtensions} from '../../plugins/usePluginExtensions';
import {onGoogleWorkspaceStatusChanged} from '../../utils/mcpEvents';
import {OPEN_KNOWLEDGE_COLLECTIONS_MODAL_EVENT} from '../../constants/ui';

interface MainPageProps {
    onModelChange?: (model: string) => void;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'vyact-sidebar-collapsed';

const PdfModal = React.lazy(() => import('../PdfModal/PdfModal'));
const DocumentModal = React.lazy(() => import('../DocumentModal/DocumentModal'));
const VoiceChatModal = React.lazy(() => import('../VoiceChatModal/VoiceChatModal'));
const MemoModal = React.lazy(() => import('../MemoModal/MemoModal'));
const QuickMemoModal = React.lazy(() => import('../QuickMemoModal/QuickMemoModal'));
const SummaryModal = React.lazy(() => import('../SummaryModal/SummaryModal'));
const SystemPromptModal = React.lazy(() => import('../SystemPromptModal/SystemPromptModal'));
const CommandPalette = React.lazy(() => import('./CommandPalette'));
const ShortcutModal = React.lazy(() => import('./ShortcutModal'));
const SupportModal = React.lazy(() => import('../common/SupportModal/SupportModal'));
const RagContextModal = React.lazy(() => import('./RagContextModal'));
const Gov24DataModal = React.lazy(() => import('../Gov24DataModal'));
const DownloadModal = React.lazy(() => import('./DownloadModal'));

const EXTERNAL_SOURCE_NAMES: Record<string, string> = {
    Government24: 'gov24',
    BizInfo: 'bizSupport',
    'K-Startup': 'kStartup',
    MyHome: 'housing',
    LH: 'lhLeaseNotice',
    'kr.gov24': 'gov24',
    'kr.biz_support': 'bizSupport',
    'kr.k_startup': 'kStartup',
    'kr.housing': 'housing',
    'kr.lh_lease_complex': 'lhLeaseComplex',
    'kr.lh_lease_notice': 'lhLeaseNotice',
};

const EXTERNAL_SOURCE_IDS: Record<string, string> = {
    Government24: 'kr.gov24',
    BizInfo: 'kr.biz_support',
    'K-Startup': 'kr.k_startup',
    MyHome: 'kr.housing',
    LH: 'kr.lh_lease_notice',
};

const EXTERNAL_SECTION_LABELS = [
    '공고명', '사업명', '소관기관', '주관기관', '수행기관', '사업개요', '공고내용',
    '사업소개', '분야', '지원분야', '지원대상', '대상', '신청기간', '접수기간',
    '신청기한', '신청방법', '선정기준', '필요서류', '문의처', '지원내용',
    '지원지역', '사업연도',
] as const;

const parseExternalDataRecord = (data: string): Record<string, unknown> => {
    try {
        const parsed = JSON.parse(data);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
};

const parseExternalDataSections = (data: string): Record<string, string> => {
    const record = parseExternalDataRecord(data);
    if (Object.keys(record).length) {
        return {
            공고명: String(record.title || ''),
            소관기관: String(record.agency || ''),
            사업개요: String(record.summary || record.purpose || ''),
            분야: String(record.category || ''),
            지원지역: String(record.support_region || ''),
            지원대상: String(record.target || record.user_type || ''),
            신청기간: String(record.application_deadline || ''),
            신청방법: String(record.application_method || ''),
            선정기준: String(record.selection_criteria || ''),
            필요서류: String(record.required_documents || ''),
            문의처: String(record.contact || ''),
            지원내용: String(record.content || record.content_text || ''),
            사업연도: String(record.source_modified_at || ''),
        };
    }
    const labels = new Set<string>(EXTERNAL_SECTION_LABELS);
    const lines = data.replace(/\r\n?/g, '\n').split('\n');
    const sections: Record<string, string> = {};
    let activeLabel = '';
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (labels.has(line)) {
            activeLabel = line;
            sections[activeLabel] = '';
            continue;
        }
        if (!activeLabel || !line) continue;
        sections[activeLabel] = sections[activeLabel]
            ? `${sections[activeLabel]}\n${line}`
            : line;
    }
    return sections;
};

const firstSection = (sections: Record<string, string>, ...labels: string[]) =>
    labels.map(label => sections[label]).find(Boolean) || '';

const extractApplicationEndDate = (deadline: string): string | null => {
    const dates = [...deadline.matchAll(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/g)];
    const lastDate = dates[dates.length - 1];
    if (!lastDate) return null;
    const [, year, month, day] = lastDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const getExternalModalDocuments = (items: NonNullable<Message['injectedContext']>) => items.map((item, index) => {
    const metadata = item.external_document || {};
    const dataRecord = parseExternalDataRecord(item.data);
    const sections = parseExternalDataSections(item.data);
    const sourceId = String(metadata.external_resource_id || EXTERNAL_SOURCE_IDS[item.source] || `external-${item.source}`);
    const sourceNameKey = EXTERNAL_SOURCE_NAMES[sourceId] || EXTERNAL_SOURCE_NAMES[item.source] || 'gov24';
    const rawValue = (key: string) => metadata[key] ?? dataRecord[key];
    const value = (key: string) => String(rawValue(key) || '');
    const applicationDeadline = value('application_deadline') || firstSection(sections, '신청기간', '접수기간', '신청기한');
    const recordType = value('record_type') || (sourceId === 'kr.k_startup'
        ? (firstSection(sections, '사업연도') ? 'business' : 'announcement')
        : '');
    return {
        sourceId,
        sourceNameKey,
        document: {
            id: value('id') || `${sourceId}-${index}`,
            title: item.title || item.source,
            agency: value('agency') || firstSection(sections, '소관기관', '주관기관', '수행기관'),
            target: value('target') || firstSection(sections, '지원대상', '대상'),
            category: value('category') || firstSection(sections, '분야', '지원분야'),
            user_type: value('user_type'),
            support_type: value('support_type') || firstSection(sections, '지원지역'),
            application_deadline: applicationDeadline,
            application_end_date: value('application_end_date') || extractApplicationEndDate(applicationDeadline),
            source_url: value('url') || value('source_url'),
            application_url: value('application_url'),
            source_modified_at: value('source_modified_at') || firstSection(sections, '사업연도'),
            record_type: recordType as Gov24Document['record_type'],
            created_at: value('created_at'),
            view_count: typeof rawValue('view_count') === 'number' ? rawValue('view_count') as number : null,
            summary: value('summary') || firstSection(sections, '사업개요', '사업소개'),
            purpose: value('purpose'),
            content: value('content_text') || value('content') || item.data,
            selection_criteria: value('selection_criteria') || firstSection(sections, '선정기준'),
            application_method: value('application_method') || firstSection(sections, '신청방법'),
            required_documents: value('required_documents') || firstSection(sections, '필요서류'),
            contact: value('contact') || firstSection(sections, '문의처'),
            attachments: Array.isArray(rawValue('attachments')) ? rawValue('attachments') as Gov24Document['attachments'] : [],
        } satisfies Gov24Document,
    };
});

function getStoredSidebarCollapsed(): boolean {
    try {
        return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
}

const handleScreenshot = async () => {
    try {
        const {ragAPI} = window;
        if (ragAPI?.screenshot) {
            const base64 = await ragAPI.screenshot();
            if (base64) {
                const link = document.createElement('a');
                link.download = `vyact_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
                link.href = `data:image/png;base64,${base64}`;
                link.click();
            }
        } else {
            const stream = await (navigator.mediaDevices as any).getDisplayMedia({
                video: {displaySurface: 'browser'},
                preferCurrentTab: true,
            });
            const video = document.createElement('video');
            video.srcObject = stream;
            await new Promise<void>(r => {
                video.onloadedmetadata = () => r();
            });
            await video.play();
            await new Promise(r => requestAnimationFrame(r));
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d')!.drawImage(video, 0, 0);
            stream.getTracks().forEach((t: any) => t.stop());
            const link = document.createElement('a');
            link.download = `vyact_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }
    } catch (e) {
        console.error('Screenshot failed', e);
    }
};

const MainPage: React.FC<MainPageProps> = ({onModelChange}) => {
    const [activeProjectName, setActiveProjectName] = useState('');
    const {t} = useTranslation('main');
    // ── UI 상태 ──────────────────────────────────────────────────────
    const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
    const [sidebarHover, setSidebarHover] = useState(false);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSidebarHoverEnter = () => {
        if (!sidebarCollapsed) return;
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => setSidebarHover(true), 120);
    };
    const handleSidebarHoverLeave = useCallback(() => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => setSidebarHover(false), 120);
    }, []);
    const [globalDragging, setGlobalDragging] = useState(false);
    const [externalDropFiles, setExternalDropFiles] = useState<File[]>([]);
    const [documentModalDropFiles, setDocumentModalDropFiles] = useState<File[]>([]);
    const focusTrigger = 0;
    const [resetTrigger, setResetTrigger] = useState(0);
    const [systemPrompts, setSystemPrompts] = useState<{ id: string; title: string; content: string }[]>([]);
    const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
    const [showSystemPromptModal, setShowSystemPromptModal] = useState(false);
    const [pdfEditParams, setPdfEditParams] = useState<any>(null);

    // 모달 열림 상태
    const [activePluginModalId, setActivePluginModalId] = useState<string | null>(null);
    const pluginExtensions = usePluginExtensions();
    useEffect(() => {
        const openModal = (event: Event) => {
            setActivePluginModalId((event as CustomEvent<{modalId: string}>).detail.modalId);
        };
        window.addEventListener('vyact:open-plugin-modal', openModal);
        return () => window.removeEventListener('vyact:open-plugin-modal', openModal);
    }, []);
    const followupComposedRef = useRef('');
    const [showPdfModal, setShowPdfModal] = useState(false);
    const [injectedContextModal, setInjectedContextModal] = useState<{items: Message['injectedContext']; kind: 'injected' | 'external'} | null>(null);
    const [showMemoModal, setShowMemoModal] = useState(false);
    const [showQuickMemoModal, setShowQuickMemoModal] = useState(false);
    const [memoInitialId, setMemoInitialId] = useState<string | undefined>(undefined);
    const [summaryConvId, setSummaryConvId] = useState<string | null>(null);

    const loadSystemPrompts = useCallback(async () => {
        const data = await api.getSystemPrompts();
        setSystemPrompts(data.prompts || []);
        setSelectedPromptId(data.selected_id || null);
    }, []);

    useEffect(() => {
        void loadSystemPrompts().catch(console.error);
    }, [loadSystemPrompts]);

    const createSystemPrompt = async (title: string, content: string) => {
        await api.createSystemPrompt(title, content);
        await loadSystemPrompts();
    };

    const updateSystemPrompt = async (id: string, title: string, content: string) => {
        await api.updateSystemPrompt(id, title, content);
        await loadSystemPrompts();
    };

    const deleteSystemPrompt = async (id: string) => {
        await api.deleteSystemPrompt(id);
        await loadSystemPrompts();
    };

    const reorderSystemPrompts = async (promptIds: string[]) => {
        await api.reorderSystemPrompts(promptIds);
        await loadSystemPrompts();
    };

    const handlePdfEdit = useCallback((params: any) => {
        setPdfEditParams(params);
        setShowPdfModal(true);
    }, []);

    const handleShowInjectedContext = useCallback((items: NonNullable<Message['injectedContext']>, kind: 'injected' | 'external' = 'injected') => {
        setInjectedContextModal({items, kind});
    }, []);

    const handleOpenMemo = useCallback((memoId: string) => {
        setMemoInitialId(memoId);
        setShowMemoModal(true);
    }, []);
    const [showDocumentModal, setShowDocumentModal] = useState(false);
    const [showVoiceChatModal, setShowVoiceChatModal] = useState(false);
    const showVoiceChatModalRef = React.useRef(false);
    const setVoiceChatModal = (v: boolean) => {
        showVoiceChatModalRef.current = v;
        setShowVoiceChatModal(v);
    };
    const [googleWorkspaceOpen, setGoogleWorkspaceOpen] = useState(false);
    const [selectedGoogleMailId, setSelectedGoogleMailId] = useState<string | null>(null);
    const [selectedGoogleCalendarEvent, setSelectedGoogleCalendarEvent] = useState<GoogleCalendarSelection | null>(null);
    const openGoogleWorkspacePanel = (messageId?: string, calendarSelection?: GoogleCalendarSelection) => {
        setSelectedGoogleMailId(messageId || null);
        setSelectedGoogleCalendarEvent(calendarSelection || null);
        setGoogleWorkspaceOpen(true);
    };
    const closeGoogleWorkspacePanel = useCallback(() => {
        setGoogleWorkspaceOpen(false);
        setSelectedGoogleMailId(null);
        setSelectedGoogleCalendarEvent(null);
    }, []);
    const toggleGoogleWorkspacePanel = () => {
        if (!googleWorkspaceOpen) {
            setSelectedGoogleMailId(null);
            setSelectedGoogleCalendarEvent(null);
        }
        setGoogleWorkspaceOpen(open => !open);
    };
    useEffect(() => onGoogleWorkspaceStatusChanged(closeGoogleWorkspacePanel), [closeGoogleWorkspacePanel]);
    const [showShortcutModal, setShowShortcutModal] = useState(false);
    const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
    const [showSupportModal, setShowSupportModal] = useState(false);
    const [openSettingsExternal, setOpenSettingsExternal] = useState(false);
    const [openSettingsTab, setOpenSettingsTab] = useState<string | undefined>(undefined);
    useEffect(() => {
        const openSettings = (event: Event) => {
            const tab = (event as CustomEvent<{tab?: string}>).detail?.tab;
            setOpenSettingsTab(tab);
            setOpenSettingsExternal(true);
        };
        window.addEventListener('vyact:open-settings', openSettings);
        return () => window.removeEventListener('vyact:open-settings', openSettings);
    }, []);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [cmdPaletteQuery, setCmdPaletteQuery] = useState('');
    const [pendingModelDownload, setPendingModelDownload] = useState<string | null>(null);
    const modelDownloadConfirmationRef = useRef<((confirmed: boolean) => void) | null>(null);
    const beforeModelChangeRef = useRef<() => void>(() => {});

    const requestModelDownloadConfirmation = useCallback((model: string) => new Promise<boolean>(resolve => {
        modelDownloadConfirmationRef.current = resolve;
        setPendingModelDownload(model);
    }), []);

    const resolveModelDownloadConfirmation = useCallback((confirmed: boolean) => {
        modelDownloadConfirmationRef.current?.(confirmed);
        modelDownloadConfirmationRef.current = null;
        setPendingModelDownload(null);
    }, []);

    // ── hooks ────────────────────────────────────────────────────────
    const models = useModels(
        onModelChange,
        requestModelDownloadConfirmation,
        () => beforeModelChangeRef.current(),
    );
    const conv = useConversation();

    const chat = useChat({
        currentConvId: conv.currentConvId,
        activeProjectId: conv.activeProjectId,
        currentConvIdRef: conv.currentConvIdRef,
        messagesRef: conv.messagesRef,
        selectedModel: models.selectedModel,
        isImageMode: models.isImageMode,
        pendingArticles: conv.pendingArticles,
        showVoiceChatModalRef,
        setConvId: conv.setConvId,
        addLocalConversation: conv.addLocalConversation,
        completeLocalConversation: conv.completeLocalConversation,
        setMessagesWithRef: conv.setMessagesWithRef,
        setMessagesForConversation: conv.setMessagesForConversation,
        getMessagesForConversation: conv.getMessagesForConversation,
        setPendingArticles: conv.setPendingArticles,
        mapMsg: conv.mapMsg,
        newConversation: conv.newConversation,
        clearConversation: conv.clearConversation,
        setResetTrigger,
        setIsDownloading: models.setIsDownloading,
        setDownloadingModel: models.setDownloadingModel,
        setDownloadProgress: models.setDownloadProgress,
        setDownloadMessage: models.setDownloadMessage,
        openPluginModal: setActivePluginModalId,
        setShowRememberModal: () => {
            setOpenSettingsTab('profile');
            setOpenSettingsExternal(true);
        },
    });

    useEffect(() => {
        const stopActiveChatRequest = () => {
            if (chat.hasActiveRequests) chat.handleStop();
        };
        window.addEventListener('vyact:stop-active-chat-request', stopActiveChatRequest);
        return () => window.removeEventListener('vyact:stop-active-chat-request', stopActiveChatRequest);
    }, [chat.hasActiveRequests, chat.handleStop]);

    // 일부 provider는 tool 판정 단계에서 isLoading state 전환보다 toolStatus가 먼저 렌더된다.
    // 새 대화 전환은 세 상태 중 하나라도 남아 있으면 차단한다.
    const isChatBusy = chat.hasActiveRequests
        || Boolean(chat.streamingMessageId)
        || conv.messages.some(message => Boolean(message.toolStatus));

    const stopActiveResponseBeforeModelContextChange = () => {
        if (isChatBusy) chat.handleStop();
    };
    beforeModelChangeRef.current = stopActiveResponseBeforeModelContextChange;

    const handleAttachDriveFileToChat = useCallback(async (file: DriveFile) => {
        try {
            const {blob, filename} = await api.downloadGoogleDriveFile(file.id);
            const downloadedFile = new File([blob], filename || file.name);
            setExternalDropFiles([downloadedFile]);
        } catch (e) {
            console.error('Drive file attach failed:', e);
        }
    }, []);

    const handleAttachMailFilesToChat = useCallback((files: File[]) => {
        setExternalDropFiles(files);
    }, []);

    const handleIndexDriveDocument = useCallback(async (file: DriveFile) => {
        try {
            const {blob, filename} = await api.downloadGoogleDriveFile(file.id);
            const downloadedFile = new File([blob], filename || file.name);
            setDocumentModalDropFiles([downloadedFile]);
            setShowDocumentModal(true);
        } catch (e) {
            console.error('Drive file index failed:', e);
        }
    }, []);

    const startNewConversation = () => {
        conv.newConversation(setResetTrigger);
        closeAllModals();
    };

    // ── 초기화 ───────────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            await Promise.all([
                models.refreshModels(),
                conv.loadHistory(),
            ]);
            conv.newConversation(setResetTrigger);
        })();
    }, []);

    // ── 전역 단축키 ──────────────────────────────────────────────────
    const closeAllModals = () => {
        setActivePluginModalId(null);
        setShowPdfModal(false);
        setShowDocumentModal(false);
        setVoiceChatModal(false);
        setShowShortcutModal(false);
        setShowCommandPalette(false);
        setOpenSettingsExternal(false);
        setShowMemoModal(false);
        setShowQuickMemoModal(false);
        setNotificationCenterOpen(false);
    };

    const toggleSidebar = useCallback(() => {
        // 예약되어 있던 hover 열기/닫기 취소
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }

        // Cmd+B나 버튼으로 토글할 때 hover 확장 상태 제거
        setSidebarHover(false);

        setSidebarCollapsed(prev => {
            const next = !prev;

            document.documentElement.style.setProperty(
                '--sidebar-width',
                next ? '0px' : '260px'
            );

            try {
                localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
            } catch {
                // 저장소를 사용할 수 없는 환경에서는 현재 세션 상태만 유지한다.
            }

            return next;
        });
    }, []);

    useGlobalKeyboard({
        onToggleSidebar: toggleSidebar,
        onToggleCommandPalette: () => {
            const next = !showCommandPalette;
            closeAllModals();
            if (next) {
                setCmdPaletteQuery('');
                setShowCommandPalette(true);
            }
        },
        onToggleShortcuts: () => {
            const next = !showShortcutModal;
            closeAllModals();
            if (next) setShowShortcutModal(true);
        },
        onOpenDocument: () => {
            closeAllModals();
            setShowDocumentModal(true);
        },
        onOpenSettings: () => {
            closeAllModals();
            setOpenSettingsExternal(true);
        },
        onNewConversation: () => {
            if (isChatBusy) return;
            conv.setActiveProjectId(null);
            startNewConversation();
        },
        onOpenMemo: () => {
            closeAllModals();
            setShowMemoModal(true);
        },
        onOpenQuickMemo: () => {
            closeAllModals();
            setShowQuickMemoModal(true);
        },
        onOpenKnowledgeCollections: () => {
            closeAllModals();
            window.dispatchEvent(new Event(OPEN_KNOWLEDGE_COLLECTIONS_MODAL_EVENT));
        },
        onOpenChatSummary: () => {
            if (conv.currentConvId) setSummaryConvId(conv.currentConvId);
        },
        onToggleNotifications: () => setNotificationCenterOpen(open => !open),
        onCloseAll: () => closeAllModals(),
    }, showMemoModal);

    // ── 헬퍼 ─────────────────────────────────────────────────────────
    const handleRetry = chat.handleRetry;

    // ── RENDER ────────────────────────────────────────────────────────
    return (
        <PanelManagerProvider>
            <PluginProviders>
            <CodePanelProvider>
                <PluginPanelCoordinator/>
                <div className="main-page-wrapper">
                    <TitleBar
                        sidebarCollapsed={sidebarCollapsed}
                        onToggleSidebar={toggleSidebar}
                        onScreenshot={handleScreenshot}
                        onSidebarHoverEnter={handleSidebarHoverEnter}
                        onSidebarHoverLeave={handleSidebarHoverLeave}
                        notificationCenterOpen={notificationCenterOpen}
                        onNotificationCenterOpenChange={setNotificationCenterOpen}
                    />
                    <div
                        className="main-page"
                        onDragOver={e => e.preventDefault()}
                        onDragEnter={e => {
                            e.preventDefault();
                            if (!models.isImageMode) setGlobalDragging(true);
                        }}
                        onDragLeave={e => {
                            const related = e.relatedTarget as HTMLElement | null;
                            if (!e.currentTarget.contains(related) || related?.closest?.('.gwp-drive')) {
                                setGlobalDragging(false);
                            }
                        }}
                        onDrop={e => {
                            e.preventDefault();
                            setGlobalDragging(false);
                            const files = Array.from(e.dataTransfer.files);
                            if (files.length > 0) {
                                if (showDocumentModal) setDocumentModalDropFiles(files);
                                else if (!models.isImageMode) setExternalDropFiles(files);
                            }
                        }}
                    >
                        <Sidebar
                            installed={models.installed}
                            mtpSupported={models.mtpSupported}
                            mtpActive={models.mtpActive}
                            visionSupported={models.visionSupported}
                            audioSupported={models.audioSupported}
                            selectedModel={models.selectedModel}
                            isModelLoading={models.isModelLoading}
                            onModelLoadingChange={models.setModelLoading}
                            onModelChange={models.handleModelChange}
                            onProviderChange={models.refreshModels}
                            onBeforeModelContextChange={stopActiveResponseBeforeModelContextChange}
                            conversations={conv.conversations}
                            favoriteConversations={conv.favoriteConversations}
                            historyTotal={conv.historyTotal}
                            initialHistoryLoaded={conv.initialHistoryLoaded}
                            onLoadMoreHistory={conv.loadMoreHistory}
                            onRefreshHistory={conv.loadHistory}
                            activeConvId={conv.currentConvId}
                            activeConversationIds={chat.activeConversationIds}
                            onConversationSelect={convId => conv.loadConversation(
                                convId,
                                setResetTrigger,
                                chat.activeConversationIds.includes(convId),
                            )}
                            onConversationDelete={convId => conv.deleteConversation(convId, conv.currentConvId, setResetTrigger)}
                            onDeleteAllConversations={() => conv.deleteAllConversations(setResetTrigger)}
                            onDeleteProjectConversations={projectId => conv.deleteProjectConversations(projectId, setResetTrigger)}
                            onConversationRename={conv.loadHistory}
                            onConversationFavoriteChange={conv.setConversationFavorite}
                            onNewConversation={() => {
                                startNewConversation();
                            }}
                            activeProjectId={conv.activeProjectId}
                            onProjectChange={projectId => {
                                conv.setActiveProjectId(projectId);
                            }}
                            onActiveProjectNameChange={setActiveProjectName}
                            collapsed={sidebarCollapsed}
                            hoverOpen={sidebarHover}
                            onHoverEnter={handleSidebarHoverEnter}
                            onHoverLeave={handleSidebarHoverLeave}
                            openSettings={openSettingsExternal}
                            openSettingsTab={openSettingsTab}
                            onSettingsClosed={() => {
                                setOpenSettingsExternal(false);
                                setOpenSettingsTab(undefined);
                            }}
                            onShowSummary={convId => setSummaryConvId(convId)}
                        />

                        <div className="chat-main">
                            <ChatArea
                                messages={conv.messages}
                                isLoading={chat.isLoading}
                                streamingMessageId={chat.streamingMessageId}
                                responseStartedAt={chat.responseStartedAt}
                                isEmpty={conv.messages.length === 0}
                                projectName={activeProjectName}
                                onRetry={handleRetry}
                                imageGenProgress={chat.imageGenProgress}
                                imageGenMessage={chat.imageGenMessage}
                                loadingMessage=""
                                convId={conv.currentConvId}
                                onPdfEdit={handlePdfEdit}
                                onShowInjectedContext={handleShowInjectedContext}
                                onOpenMemo={handleOpenMemo}
                                googleWorkspaceOpen={googleWorkspaceOpen}
                                selectedGoogleMailId={selectedGoogleMailId}
                                selectedGoogleCalendarEvent={selectedGoogleCalendarEvent}
                                onGoogleWorkspaceClose={closeGoogleWorkspacePanel}
                                onAttachDriveFileToChat={handleAttachDriveFileToChat}
                                onAttachMailFilesToChat={handleAttachMailFilesToChat}
                                onIndexDriveDocument={handleIndexDriveDocument}
                                onAttachVideo={article => conv.setPendingArticles(prev =>
                                    prev.some(a => a.url === article.url) ? prev : [...prev, article]
                                )}
                                onDetachVideo={url => conv.setPendingArticles(prev => prev.filter(a => a.url !== url))}
                                onDetachAllVideos={() => conv.setPendingArticles([])}
                                onQueryWithVideo={(articles, question) => chat.handleSend(question, undefined, undefined, undefined, undefined, articles)}
                                onFollowupSubmit={(message) => chat.handleSend(message)}
                                onFollowupDismiss={(messageId) => conv.setMessagesWithRef(prev =>
                                    prev.map(m => (m.id === messageId || m.timestamp === messageId)
                                        ? {...m, followups: undefined} : m)
                                )}
                                followupComposedRef={followupComposedRef}
                            >
                                <ChatInput
                                    onSend={async (message, images, files, selectedMcpIds, knowledgeCollectionIds, externalResourceIds, externalDocumentSelections) => {
                                        // FollowupBar에서 선택/입력된 내용이 있으면 메인 입력 앞에 합침
                                        const prefix = followupComposedRef.current?.trim();
                                        const combined = prefix ? `${prefix}\n${message}` : message;
                                        const sent = await chat.handleSend(combined, images, files, undefined, undefined, undefined, selectedMcpIds, knowledgeCollectionIds, externalResourceIds, externalDocumentSelections);
                                        if (sent !== false) followupComposedRef.current = '';
                                        return sent;
                                    }}
                                    onStop={chat.hasActiveRequests ? chat.handleStop : undefined}
                                    disabled={chat.hasActiveRequests || models.isModelLoading}
                                    isImageMode={models.isImageMode}
                                    selectedModel={models.selectedModel}
                                    loadingModel={models.loadingModel}
                                    isLocalModel={models.installed.includes(models.selectedModel)}
                                    modelType={models.modelType}
                                    isModelLoading={models.isModelLoading}
                                    focusTrigger={focusTrigger}
                                    resetTrigger={resetTrigger}
                                    externalDragging={globalDragging}
                                    externalDropFiles={externalDropFiles}
                                    onExternalDropHandled={() => setExternalDropFiles([])}
                                    articles={conv.pendingArticles}
                                    onArticleRemove={url => conv.setPendingArticles(prev => prev.filter(a => a.url !== url))}
                                    onArticleRemoveAll={() => conv.setPendingArticles([])}
                                    onOpenVoiceChat={() => setVoiceChatModal(true)}
                                    onOpenPdfModal={() => {
                                        setPdfEditParams(null);
                                        setShowPdfModal(true);
                                    }}
                                    onOpenDocumentModal={() => setShowDocumentModal(true)}
                                    onOpenShortcuts={() => setShowShortcutModal(true)}
                                    onOpenSupport={() => setShowSupportModal(true)}
                                    onOpenMemo={() => setShowMemoModal(true)}
                                    onOpenQuickMemo={() => setShowQuickMemoModal(true)}
                                    onOpenGoogleWorkspace={openGoogleWorkspacePanel}
                                    onToggleGoogleWorkspace={toggleGoogleWorkspacePanel}
                                    googleWorkspaceOpen={googleWorkspaceOpen}
                                    systemPrompts={systemPrompts}
                                    onSystemPromptSelect={async promptId => {
                                        try {
                                            await api.selectSystemPrompt(promptId);
                                            setSelectedPromptId(promptId);
                                        } catch (e) {
                                            console.error(e);
                                        }
                                    }}
                                    selectedPromptId={selectedPromptId}
                                    onOpenSystemPromptSettings={() => setShowSystemPromptModal(true)}
                                    activePromptTitle={selectedPromptId ? (systemPrompts.find(p => p.id === selectedPromptId)?.title ?? null) : null}
                                />
                            </ChatArea>
                        </div>

                        {/* ── Modals ─────────────────────────────────────────────── */}
                        {showSystemPromptModal && <React.Suspense fallback={null}>
                            <SystemPromptModal
                                isOpen
                                prompts={systemPrompts}
                                onClose={() => setShowSystemPromptModal(false)}
                                onCreate={createSystemPrompt}
                                onUpdate={updateSystemPrompt}
                                onDelete={deleteSystemPrompt}
                                onReorder={reorderSystemPrompts}
                            />
                        </React.Suspense>}
                        {pluginExtensions.modals.map(modal => (
                            <React.Fragment key={modal.id}>
                                {modal.render({
                                    open: activePluginModalId === modal.id,
                                    close: () => setActivePluginModalId(null),
                                    context: {
                                        conversationId: conv.currentConvIdRef.current,
                                        messages: conv.messagesRef.current,
                                        appendUserMessage: content => conv.setMessagesWithRef(previous => [...previous, {
                                            role: 'user', content, timestamp: new Date().toISOString(),
                                        }]),
                                        appendAssistantMessage: (content, isError) => {
                                            const messageId = crypto.randomUUID();
                                            conv.setMessagesWithRef(previous => [...previous, {
                                                id: messageId,
                                                role: 'assistant',
                                                content,
                                                isError,
                                                timestamp: new Date().toISOString(),
                                            }]);
                                            return messageId;
                                        },
                                        updateAssistantMessage: (messageId, content, isError) => {
                                            conv.setMessagesWithRef(previous => previous.map(message =>
                                                message.id === messageId
                                                    ? {...message, content, isError}
                                                    : message
                                            ));
                                        },
                                        reloadHistory: conv.loadHistory,
                                        onAttachVideo: article => conv.setPendingArticles(previous =>
                                            previous.some(item => item.url === article.url)
                                                ? previous
                                                : [...previous, article]
                                        ),
                                        onDetachVideo: url => conv.setPendingArticles(previous =>
                                            previous.filter(item => item.url !== url)
                                        ),
                                        onQueryWithVideo: (articles, question) => {
                                            setActivePluginModalId(null);
                                            chat.handleSend(
                                                question,
                                                undefined,
                                                undefined,
                                                undefined,
                                                undefined,
                                                articles,
                                            );
                                        },
                                    },
                                })}
                            </React.Fragment>
                        ))}

                        {models.isDownloading && (
                            <React.Suspense fallback={null}>
                                <DownloadModal
                                    modelName={models.downloadingModel}
                                    progress={models.downloadProgress}
                                    message={models.downloadMessage}
                                    isLoadingIntoMemory={models.isModelLoadingIntoMemory}
                                />
                            </React.Suspense>
                        )}

                        {pendingModelDownload && (
                            <ConfirmModal
                                title={t('modelDownload.confirmTitle', {model: pendingModelDownload})}
                                description={t('modelDownload.confirmDescription')}
                                options={[
                                    {label: t('common:cancel'), value: 'cancel'},
                                    {label: t('modelDownload.downloadAction'), value: 'download'},
                                ]}
                                onSelect={value => resolveModelDownloadConfirmation(value === 'download')}
                                onClose={() => resolveModelDownloadConfirmation(false)}
                                actionLayout="horizontal"
                            />
                        )}

                        {showVoiceChatModal && <React.Suspense fallback={null}>
                            <VoiceChatModal
                                isOpen
                                onClose={() => setVoiceChatModal(false)}
                                onSend={(msg, systemPrompt, voiceMode) => chat.handleSend(msg, undefined, undefined, systemPrompt, voiceMode)}
                            />
                        </React.Suspense>}

                        {showPdfModal && <React.Suspense fallback={null}>
                            <PdfModal
                                onClose={() => {
                                    setShowPdfModal(false);
                                    setPdfEditParams(null);
                                }}
                                convId={conv.currentConvId}
                                messages={conv.messages}
                                initialParams={pdfEditParams}
                                onComplete={(answer, filename, newConvId, prompt, pdfParams, userTs) => {
                                    if (newConvId && !conv.currentConvIdRef.current) conv.setConvId(newConvId);
                                    conv.setMessagesWithRef(prev => [...prev,
                                        {
                                            role: 'user',
                                            content: `/presentation ${prompt || ''}`.trim(),
                                            timestamp: userTs
                                        },
                                        {
                                            role: 'assistant',
                                            content: answer,
                                            timestamp: new Date().toISOString(),
                                            pdfFile: filename,
                                            pdfParams
                                        } as any,
                                    ]);
                                    setPdfEditParams(null);
                                    conv.loadHistory();
                                }}
                            />
                        </React.Suspense>}

                        {showDocumentModal && <React.Suspense fallback={null}>
                            <DocumentModal
                            isOpen
                            onClose={() => setShowDocumentModal(false)}
                            externalDropFiles={documentModalDropFiles}
                            onExternalDropHandled={() => setDocumentModalDropFiles([])}
                            attachedDocumentIds={conv.pendingArticles.flatMap(article => article.file_id ? [article.file_id] : [])}
                            onToggleSavedDocument={article => conv.setPendingArticles(prev => {
                                const isAttached = prev.some(item => item.file_id === article.file_id);
                                if (isAttached) return prev.filter(item => item.file_id !== article.file_id);
                                return [...prev, article];
                            })}
                            onDetachSavedDocuments={fileIds => conv.setPendingArticles(prev =>
                                prev.filter(article => !article.file_id || !fileIds.includes(article.file_id))
                            )}
                            onQueryWithDoc={(articles, question) => {
                                setShowDocumentModal(false);
                                if (question) {
                                    chat.handleSend(question, undefined, undefined, undefined, undefined, articles);
                                } else {
                                    conv.setPendingArticles(prev => {
                                        const newOnes = articles.filter(a => !prev.some(p => p.url === a.url));
                                        return [...prev, ...newOnes];
                                    });
                                }
                            }}
                            />
                        </React.Suspense>}

                        {chat.zipConfirmRequest && (
                            <ConfirmModal
                                title="zip 파일이 너무 많습니다"
                                description={
                                    `"${chat.zipConfirmRequest.originalName}"에서 처리 가능한 파일 ${chat.zipConfirmRequest.totalEligible}개를 찾았습니다.\n` +
                                    `기본값(${chat.zipConfirmRequest.defaultLimit}개)만 사용하시겠습니까, 전체를 사용하시겠습니까?\n` +
                                    `(파일이 많을수록 응답 속도가 느려질 수 있습니다)`
                                }
                                options={[
                                    {label: `기본 ${chat.zipConfirmRequest.defaultLimit}개만 사용`, value: 'default'},
                                    {label: `전체 ${chat.zipConfirmRequest.totalEligible}개 사용`, value: 'all'},
                                ]}
                                onSelect={value => chat.resolveZipConfirm(
                                    value === 'all' ? chat.zipConfirmRequest!.totalEligible : chat.zipConfirmRequest!.defaultLimit
                                )}
                                onClose={() => chat.resolveZipConfirm(chat.zipConfirmRequest!.defaultLimit)}
                            />
                        )}

                        {/* ── Command Palette ─────────────────────────────────────── */}
                        {showMemoModal && (
                            <React.Suspense fallback={null}>
                                <MemoModal onClose={() => {
                                    setShowMemoModal(false);
                                    setMemoInitialId(undefined);
                                }} initialMemoId={memoInitialId}/>
                            </React.Suspense>
                        )}
                        {showQuickMemoModal && (
                            <React.Suspense fallback={null}>
                                <QuickMemoModal onClose={() => setShowQuickMemoModal(false)}/>
                            </React.Suspense>
                        )}

                        {summaryConvId && (
                            <React.Suspense fallback={null}>
                                <SummaryModal convId={summaryConvId} onClose={() => setSummaryConvId(null)}/>
                            </React.Suspense>
                        )}


                        {injectedContextModal && (
                            <React.Suspense fallback={null}>
                                {injectedContextModal.kind === 'external' ? (
                                    <Gov24DataModal
                                        isOpen
                                        providedDocuments={getExternalModalDocuments(injectedContextModal.items || [])}
                                        onClose={() => setInjectedContextModal(null)}
                                    />
                                ) : (
                                    <RagContextModal
                                        items={injectedContextModal.items || []}
                                        onClose={() => setInjectedContextModal(null)}
                                    />
                                )}
                            </React.Suspense>
                        )}

                        {showCommandPalette && (
                            <React.Suspense fallback={null}>
                                <CommandPalette
                                query={cmdPaletteQuery}
                                onQueryChange={setCmdPaletteQuery}
                                onClose={() => setShowCommandPalette(false)}
                                conversations={conv.conversations}
                                onNewConversation={() => {
                                    if (isChatBusy) return;
                                    conv.newConversation(setResetTrigger);
                                    setShowCommandPalette(false);
                                }}
                                onLoadConversation={conversation => {
                                    if (isChatBusy) return;
                                    // 최근 항목에서도 대화가 속한 프로젝트를 먼저 활성화해
                                    // 사이드바의 프로젝트 선택 상태를 대화와 일치시킨다.
                                    conv.setActiveProjectId(conversation.project_id ?? null);
                                    conv.loadConversation(
                                        conversation.conv_id,
                                        setResetTrigger,
                                        chat.activeConversationIds.includes(conversation.conv_id),
                                    );
                                }}
                                onOpenDocument={() => setShowDocumentModal(true)}
                                onOpenMemo={() => setShowMemoModal(true)}
                                onOpenRemember={() => {
                                    setOpenSettingsTab('profile');
                                    setOpenSettingsExternal(true);
                                }}
                                onOpenVoiceChat={() => setVoiceChatModal(true)}
                                />
                            </React.Suspense>
                        )}

                        {/* ── Shortcut Modal ──────────────────────────────────────── */}
                        {showShortcutModal && (
                            <React.Suspense fallback={null}>
                                <ShortcutModal onClose={() => setShowShortcutModal(false)}/>
                            </React.Suspense>
                        )}
                        {showSupportModal && (
                            <React.Suspense fallback={null}>
                                <SupportModal onClose={() => setShowSupportModal(false)}/>
                            </React.Suspense>
                        )}
                    </div>
                </div>
            </CodePanelProvider>
            </PluginProviders>
        </PanelManagerProvider>
    );
};

export default MainPage;
