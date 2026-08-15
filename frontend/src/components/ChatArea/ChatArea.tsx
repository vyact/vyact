import React, {useRef, useEffect, useCallback, useMemo, useState} from 'react';
import Message from '../Message';
import LoadingIndicator from '../LoadingIndicator';
import FollowupBar from '../FollowupBar/FollowupBar';
import type {DriveFile} from '../GoogleWorkspacePanel/DrivePanel';
import type {GoogleCalendarSelection} from '../../types/googleWorkspace';
import {useCodePanel} from '../../contexts/CodePanelContext';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import {usePluginExtensions} from '../../plugins/usePluginExtensions';
import type {Message as MessageType} from '../../types';
import type {ArticleAttachment} from '../../types';
import {getUserProfile, onUserProfileUpdated} from '../../services/userProfile';
import PanelResizer, {getSavedPanelWidth, savePanelWidth} from '../common/PanelResizer/PanelResizer';
import {useTranslation} from 'react-i18next';

const CodePanel = React.lazy(() => import('../CodePanel/CodePanel'));
const GoogleWorkspacePanel = React.lazy(() => import('../GoogleWorkspacePanel/GoogleWorkspacePanel'));
import './ChatArea.css';

const WORKSPACE_PANEL_WIDTH_KEY = 'vyact-google-workspace-embedded-panel-width';
const DEFAULT_WORKSPACE_PANEL_WIDTH = 48;
const MIN_WORKSPACE_PANEL_WIDTH = 40;
const MAX_WORKSPACE_PANEL_WIDTH = 70;
const clampWorkspacePanelWidth = (width: number) => Math.max(MIN_WORKSPACE_PANEL_WIDTH, Math.min(MAX_WORKSPACE_PANEL_WIDTH, width));
const getSavedWorkspacePanelWidth = () => {
    try {
        const savedWidth = Number(localStorage.getItem(WORKSPACE_PANEL_WIDTH_KEY));
        return Number.isFinite(savedWidth) && savedWidth > 0
            ? clampWorkspacePanelWidth(savedWidth)
            : DEFAULT_WORKSPACE_PANEL_WIDTH;
    } catch { return DEFAULT_WORKSPACE_PANEL_WIDTH; }
};

function getGreeting(t: (key: string) => string): string {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return t('greeting.morning');
    if (h >= 12 && h < 17) return t('greeting.afternoon');
    if (h >= 17 && h < 21) return t('greeting.evening');
    return t('greeting.night');
}

interface ConversationTurn {
    messageIndex: number;
    question: string;
    answer: string;
}

const summarizeTurnText = (content: string, maxLength: number): string => {
    const normalized = content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
};

const buildConversationTurns = (messages: MessageType[]): ConversationTurn[] => {
    const turns: ConversationTurn[] = [];
    let nextAssistantIndex = 0;
    messages.forEach((message, messageIndex) => {
        if (message.role !== 'user') return;
        nextAssistantIndex = Math.max(nextAssistantIndex, messageIndex + 1);
        while (nextAssistantIndex < messages.length && messages[nextAssistantIndex].role !== 'assistant') {
            nextAssistantIndex += 1;
        }
        turns.push({
            messageIndex,
            question: summarizeTurnText(message.content, 70),
            answer: summarizeTurnText(messages[nextAssistantIndex]?.content || '', 130),
        });
    });
    return turns;
};

const WelcomeGreeting: React.FC = () => {
    const {t} = useTranslation('main');
    const [nickname, setNickname] = useState('');

    useEffect(() => {
        void getUserProfile().then(profile => setNickname(profile.nickname)).catch(() => {});
        return onUserProfileUpdated(profile => setNickname(profile.nickname));
    }, []);

    const greeting = getGreeting(t);

    return (
        <div className="welcome">
            <h2 className="welcome-title">
                {nickname ? t('greeting.withName', {name: nickname, greeting}) : greeting}
            </h2>
            <p className="welcome-shortcut-hint">
                {t('shortcutModal.hint')}
            </p>
        </div>
    );
};

interface ChatAreaProps {
    messages: MessageType[];
    isLoading: boolean;
    isEmpty: boolean;
    onRetry?: () => void;
    imageGenProgress?: number;
    imageGenMessage?: string;
    loadingMessage?: string;
    onPdfEdit?: (params: NonNullable<MessageType['pdfParams']>) => void;
    onShowInjectedContext?: (ctx: Array<{ source: string; title?: string; data: string }>) => void;
    onOpenMemo?: (memoId: string) => void;
    convId?: string;
    children?: React.ReactNode;
    googleWorkspaceOpen?: boolean;
    selectedGoogleMailId?: string | null;
    selectedGoogleCalendarEvent?: GoogleCalendarSelection | null;
    onGoogleWorkspaceClose?: () => void;
    onAttachDriveFileToChat?: (file: DriveFile) => Promise<void> | void;
    onAttachMailFilesToChat?: (files: File[]) => Promise<void> | void;
    onIndexDriveDocument?: (file: DriveFile) => Promise<void> | void;
    onAttachVideo?: (article: ArticleAttachment) => void;
    onDetachVideo?: (url: string) => void;
    onDetachAllVideos?: () => void;
    onQueryWithVideo?: (articles: ArticleAttachment[], question: string) => void;
    streamingMessageId?: string | null;  // 현재 토큰 스트리밍 중인 assistant 메시지 id
    responseStartedAt?: number | null;
    onFollowupSubmit?: (message: string) => void;  // follow-up 선택/입력 전송
    onFollowupDismiss?: (messageId: string) => void;  // follow-up 닫기
    /** FollowupBar의 현재 선택+입력 상태를 외부에서 읽을 수 있도록 ref 전달 */
    followupComposedRef?: React.MutableRefObject<string>;
}

const ChatArea: React.FC<ChatAreaProps> = ({
                                               messages,
                                               isLoading,
                                               isEmpty,
                                               onRetry,
                                               imageGenProgress = 0,
                                               imageGenMessage = '',
                                               loadingMessage = '',
                                               onPdfEdit,
                                               onShowInjectedContext,
                                               onOpenMemo,
                                               convId,
                                               children,
                                               googleWorkspaceOpen = false,
                                               selectedGoogleMailId,
                                               selectedGoogleCalendarEvent,
                                               onGoogleWorkspaceClose,
                                               onAttachDriveFileToChat,
                                               onAttachMailFilesToChat,
                                               onIndexDriveDocument,
                                               onAttachVideo,
                                               onDetachVideo,
                                               onDetachAllVideos,
                                               onQueryWithVideo,
                                               streamingMessageId = null,
                                               responseStartedAt = null,
                                               onFollowupSubmit,
                                               onFollowupDismiss,
                                           followupComposedRef,
                                       }) => {
    const chatRef = useRef<HTMLDivElement>(null);
    const [activeTurnIndex, setActiveTurnIndex] = useState(0);
    const conversationTurns = useMemo(() => buildConversationTurns(messages), [messages]);
    const googlePanelWasActiveRef = useRef(false);
    const googleWorkspaceWasOpenRef = useRef(false);
    // 사용자가 위로 스크롤해 "맨 아래에서 떨어진" 상태인지 (의도 기반, 스트리밍 중 auto-scroll 억제)
    const userDetachedRef = useRef(false);
    // RAF 배칭용 pending 플래그
    const scrollPendingRef = useRef(false);
    const [panelWidth, setPanelWidth] = useState(getSavedPanelWidth);
    const [workspacePanelWidth, setWorkspacePanelWidth] = useState(getSavedWorkspacePanelWidth);
    const handlePanelResize = useCallback((pct: number) => {
        setPanelWidth(pct);
        savePanelWidth(pct);
    }, []);
    const handleWorkspacePanelResize = useCallback((pct: number) => {
        const nextWidth = clampWorkspacePanelWidth(pct);
        setWorkspacePanelWidth(nextWidth);
        try { localStorage.setItem(WORKSPACE_PANEL_WIDTH_KEY, String(nextWidth)); } catch { /* ignore */ }
    }, []);
    const resetWorkspacePanelWidth = useCallback(() => {
        setWorkspacePanelWidth(DEFAULT_WORKSPACE_PANEL_WIDTH);
        try { localStorage.removeItem(WORKSPACE_PANEL_WIDTH_KEY); } catch { /* ignore */ }
    }, []);
    const {panel, closePanel, openPanel: openCodePanel} = useCodePanel();
    const panels = usePanelManager();
    const {sidePanels} = usePluginExtensions();

    useEffect(() => {
        const container = chatRef.current;
        if (!container || conversationTurns.length === 0) return;

        const updateActiveTurn = () => {
            // 질문 버블이 화면 상단에 살짝 걸린 상태에서도 그 응답을 읽는 중으로 본다.
            // 너무 얕은 고정값을 쓰면 다음 턴의 긴 답변 중에도 이전 턴이 활성으로 남는다.
            const viewportTop = container.getBoundingClientRect().top
                + Math.min(240, container.clientHeight * 0.25);
            let currentTurn = 0;
            conversationTurns.forEach((turn, turnIndex) => {
                const target = container.querySelector<HTMLElement>(`[data-turn-index="${turn.messageIndex}"]`);
                if (target && target.getBoundingClientRect().top <= viewportTop) currentTurn = turnIndex;
            });
            setActiveTurnIndex(currentTurn);
        };

        updateActiveTurn();
        container.addEventListener('scroll', updateActiveTurn, {passive: true});
        return () => container.removeEventListener('scroll', updateActiveTurn);
    }, [conversationTurns]);

    const navigateToTurn = useCallback((messageIndex: number) => {
        const target = chatRef.current?.querySelector<HTMLElement>(`[data-turn-index="${messageIndex}"]`);
        if (!target) return;
        userDetachedRef.current = true;
        target.scrollIntoView({behavior: 'smooth', block: 'start'});
    }, []);
    const activeFollowup = useMemo(() => {
        const last = messages[messages.length - 1];
        const visible = last && last.role === 'assistant'
            && !last.isError
            && !isLoading
            && !streamingMessageId
            && last.followups && last.followups.length > 0;
        return visible ? {id: last.id || last.timestamp || '', followups: last.followups!} : null;
    }, [isLoading, messages, streamingMessageId]);

    // 새 대화 또는 대화 전환 시 패널 닫기
    useEffect(() => {
        if (panel) {
            closePanel();
            panels.close('code');
        }
    }, [convId]);

    // user 메시지 PASTED chip 클릭 → 코드패널 열기
    useEffect(() => {
        const handler = (e: Event) => {
            const {files, activeIdx, viewerId} = (e as CustomEvent).detail;
            openCodePanel(files, activeIdx, viewerId);
            panels.open('code');
        };
        window.addEventListener('open-code-panel', handler);
        return () => window.removeEventListener('open-code-panel', handler);
    }, [openCodePanel, panels.open]);

    useEffect(() => {
        const googleWorkspaceWasOpen = googleWorkspaceWasOpenRef.current;
        if (googleWorkspaceOpen && !googleWorkspaceWasOpen) {
            panels.open('google-workspace');
        } else if (
            !googleWorkspaceOpen
            && googleWorkspaceWasOpen
            && panels.activePanel === 'google-workspace'
        ) {
            panels.close('google-workspace');
        }
        googleWorkspaceWasOpenRef.current = googleWorkspaceOpen;
    }, [googleWorkspaceOpen, panels.activePanel, panels.close, panels.open]);

    useEffect(() => {
        if (panels.activePanel !== 'code' && panel) closePanel();
        const googlePanelIsActive = panels.activePanel === 'google-workspace';
        if (
            googlePanelWasActiveRef.current
            && !googlePanelIsActive
            && googleWorkspaceOpen
        ) {
            onGoogleWorkspaceClose?.();
        }
        googlePanelWasActiveRef.current = googlePanelIsActive;
    }, [closePanel, googleWorkspaceOpen, onGoogleWorkspaceClose, panel, panels.activePanel]);

    // 사용자가 직접 바닥에 "확실히" 닿았을 때만 re-attach (히스테리시스: 작게 잡아 살짝 올림을 존중)
    const REATTACH_THRESHOLD = 8;

    // 실제 스크롤 수행 — 설정한 top 값을 기록해두고, scroll 이벤트에서 이 값과 비교해 판정
    const doScrollToBottom = useCallback(() => {
        const el = chatRef.current;
        if (!el) return;
        const target = el.scrollHeight - el.clientHeight;
        el.scrollTop = target;
    }, []);

    // RAF 배칭 — 토큰이 초당 수십 번 와도 프레임당 1회만 스크롤
    const scheduleScroll = useCallback(() => {
        if (scrollPendingRef.current) return;

        scrollPendingRef.current = true;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                scrollPendingRef.current = false;

                if (!userDetachedRef.current) {
                    doScrollToBottom();
                }
            });
        });
    }, [doScrollToBottom]);

    const scrollToBottom = useCallback(() => {
        if (!userDetachedRef.current) doScrollToBottom();
    }, [doScrollToBottom]);

    // ── 스크롤/입력 이벤트 처리 ──
    useEffect(() => {
        const el = chatRef.current;
        if (!el) return;

        // wheel/touch/key 는 "위로 가려는 의도"를 즉시 detach로 확정 (auto-scroll보다 우선)
        const onWheel = (e: WheelEvent) => {
            if (e.deltaY < 0) userDetachedRef.current = true;
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) userDetachedRef.current = true;
        };
        let lastTouchY = 0;
        const onTouchStart = (e: TouchEvent) => {
            lastTouchY = e.touches[0]?.clientY ?? 0;
        };
        const onTouchMove = (e: TouchEvent) => {
            const y = e.touches[0]?.clientY ?? 0;
            if (y > lastTouchY + 2) userDetachedRef.current = true; // 아래로 당김 = 위로 스크롤
            lastTouchY = y;
        };

        // 레이아웃 변화(FollowupBar 표시, 입력창 높이 변화)는 scrollTop을 건드리지 않아도
        // 거리/위치가 달라진다. 이를 사용자 스크롤로 오인하면 이후 스트리밍 자동 추적이
        // 영구적으로 해제되므로, detach는 wheel/touch/keyboard의 위로 이동 의도로만 결정한다.
        // 여기서는 사용자가 직접 하단으로 돌아왔을 때 re-attach만 처리한다.
        const onScroll = () => {
            const el2 = chatRef.current;
            if (!el2) return;
            const distanceFromBottom = el2.scrollHeight - el2.scrollTop - el2.clientHeight;
            if (distanceFromBottom <= REATTACH_THRESHOLD) {
                userDetachedRef.current = false;
            }
        };

        el.addEventListener('wheel', onWheel, {passive: true});
        el.addEventListener('keydown', onKeyDown);
        el.addEventListener('touchstart', onTouchStart, {passive: true});
        el.addEventListener('touchmove', onTouchMove, {passive: true});
        el.addEventListener('scroll', onScroll, {passive: true});
        return () => {
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('keydown', onKeyDown);
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('scroll', onScroll);
        };
    }, []);

    // 메시지 개수 추적 — 새 메시지가 "추가"되면(스트리밍 중 content 증가와 구분) 강제로 맨 아래로
    const prevMsgCountRef = useRef(0);

    // 새 메시지/토큰이 붙을 때
    useEffect(() => {
        const count = messages.length;
        if (count > prevMsgCountRef.current) {
            // 새 메시지 추가(사용자 전송/새 응답 시작) → detach 해제하고 무조건 하단
            userDetachedRef.current = false;
            // 새 DOM 레이아웃 반영 후 스크롤 (scrollHeight 갱신 대기)
            requestAnimationFrame(() => doScrollToBottom());
        } else {
            // 같은 메시지의 content만 늘어남(스트리밍) → detach 존중
            scheduleScroll();
        }
        prevMsgCountRef.current = count;
    }, [messages, isLoading, scheduleScroll, doScrollToBottom]);

    // 새 대화 전환 시엔 무조건 맨 아래로 + attach 복귀
    useEffect(() => {
        userDetachedRef.current = false;
        doScrollToBottom();
    }, [convId, doScrollToBottom]);

    // FollowupBar는 chat-area 스크롤 컨테이너의 바깥 형제라서, 바가 표시되며
    // 스크롤 영역 높이가 줄어드는 순간에는 일반 메시지 변경 감지만으로 하단 추적이 누락될 수 있다.
    // 직전까지 하단을 보고 있던 경우에만, 렌더 및 CSS animation 레이아웃 반영 뒤 한 번 더 맞춘다.
    useEffect(() => {
        if (!activeFollowup || userDetachedRef.current) return;
        requestAnimationFrame(() => requestAnimationFrame(doScrollToBottom));
    }, [activeFollowup, doScrollToBottom]);

    useEffect(() => {
        const container = chatRef.current;
        if (!container) return;

        const handleImageLoad = () => scheduleScroll();

        const attachListeners = (root: HTMLElement) => {
            root.querySelectorAll<HTMLImageElement>('img').forEach(img => {
                if (!img.complete) {
                    img.addEventListener('load', handleImageLoad, {once: true});
                }
            });
        };

        attachListeners(container);

        const observer = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node instanceof HTMLElement) {
                        attachListeners(node);
                        if (node.tagName === 'IMG') {
                            const img = node as HTMLImageElement;
                            if (!img.complete) {
                                img.addEventListener('load', handleImageLoad, {once: true});
                            }
                        }
                    }
                });
            });
        });

        observer.observe(container, {childList: true, subtree: true});
        return () => observer.disconnect();
    }, [scrollToBottom]);

    // 콘텐츠 실제 높이 변화를 직접 감지해서 스크롤을 재조정한다 (메시지 개수/이미지 로드
    // 감지만으로는 못 잡는 경우들을 포괄하기 위한 안전망). 예: 스트리밍 완료 시 stats 줄
    // ("출력 토큰 · 생성 시간 · 총 소요")이 같은 메시지에 추가로 붙으면서 레이아웃이
    // 한 번 더 커지는데, 그 시점엔 messages 배열 길이도 안 바뀌고 이미지도 아니라서
    // 기존 감지 로직이 못 잡아 바닥에서 살짝 뜬 채로 남는 문제가 있었다. 코드 하이라이팅,
    // 수식(KaTeX) 렌더링처럼 비동기로 높이가 바뀌는 다른 경우들도 이걸로 같이 커버된다.
    useEffect(() => {
        const container = chatRef.current;
        if (!container) return;
        const contentEl = container.querySelector('.chat-area-content');
        if (!contentEl) return;

        const ro = new ResizeObserver(() => {
            scheduleScroll();
        });
        ro.observe(contentEl);
        // FollowupBar는 scroll 영역 바깥(입력창 바로 위)에 렌더된다. 이때 chat-area의
        // 높이가 줄어드는 변화도 관찰해야 현재 하단을 보고 있는 사용자가 그대로 하단에 머문다.
        ro.observe(container);
        return () => ro.disconnect();
    }, [scheduleScroll]);

    return (
        <div
            className={`chat-area-wrap${panels.activePanel ? ' chat-area-split' : ''}`}>
            {conversationTurns.length > 1 && (
                <nav className="conversation-navigator" aria-label="대화 탐색">
                    {conversationTurns.map((turn, turnIndex) => (
                        <button
                            key={turn.messageIndex}
                            type="button"
                            className={turnIndex === activeTurnIndex ? 'active' : ''}
                            onClick={() => navigateToTurn(turn.messageIndex)}
                        >
                            <span className="conversation-navigator-bar"/>
                            <span className="conversation-navigator-tooltip">
                                <strong>{turn.question || '질문'}</strong>
                                {turn.answer && <span>{turn.answer}</span>}
                            </span>
                        </button>
                    ))}
                </nav>
            )}
            {/* 왼쪽: 채팅 + 인풋 컬럼 */}
            <div className="chat-col">
                <div className="chat-area" ref={chatRef}>
                    <div className="chat-area-content">
                        {isEmpty && !isLoading && <WelcomeGreeting/>}

                        {messages.map((msg, idx) => (
                            <div
                                key={msg.id || msg.timestamp || idx}
                                className={`chat-message-row chat-message-row--${msg.role}`}
                                data-turn-index={msg.role === 'user' ? idx : undefined}
                            >
                            <Message
                                role={msg.role}
                                content={msg.content}
                                timestamp={msg.timestamp || ''}
                                model={msg.model}
                                attachments={msg.attachments}
                                isError={msg.isError}
                                onRetry={msg.isError ? onRetry : undefined}
                                isGeneratedImage={msg.isGeneratedImage}
                                articleSources={msg.articleSources}
                                pdfFile={msg.pdfFile}
                                injectedContext={msg.injectedContext}
                                onShowInjectedContext={onShowInjectedContext}
                                onOpenMemo={onOpenMemo}
                                pdfParams={msg.pdfParams}
                                onPdfEdit={onPdfEdit}
                                isStreaming={!!streamingMessageId && (msg.id === streamingMessageId)}
                                conversationId={convId}
                                requestStartedAt={msg.id === streamingMessageId ? responseStartedAt : null}
                                toolStatus={msg.toolStatus}
                                activityLog={msg.activityLog}
                                stats={msg.role === 'user' ? messages[idx + 1]?.stats : msg.stats}
                                truncated={msg.truncated}
                            />
                            </div>
                        ))}

                        {/* 스트리밍 중에는 별도 로딩 인디케이터를 띄우지 않는다
                            (토큰이 실시간으로 버블에 흐르므로) */}
                        {isLoading && !streamingMessageId && (
                            <LoadingIndicator
                                progress={imageGenProgress}
                                message={imageGenMessage || loadingMessage}
                                isImageMode={imageGenProgress > 0 || imageGenMessage !== ''}
                            />
                        )}

                    </div>
                </div>

                {/* 마지막 assistant 응답의 follow-ups — ChatInput 바로 위 */}
                {activeFollowup && (
                    <FollowupBar
                        key={activeFollowup.id}
                        followups={activeFollowup.followups}
                        onSubmit={(m) => onFollowupSubmit?.(m)}
                        onDismiss={() => onFollowupDismiss?.(activeFollowup.id)}
                        composedRef={followupComposedRef}
                    />
                )}

                {/* children = ChatInput */}
                {children}
            </div>

            {/* 리사이저 + 오른쪽 패널 */}
            {panels.activePanel && (
                <PanelResizer onWidthChange={googleWorkspaceOpen ? handleWorkspacePanelResize : handlePanelResize} onReset={googleWorkspaceOpen ? resetWorkspacePanelWidth : undefined}/>
            )}
            {panels.activePanel === 'code' && panel && (
                <React.Suspense fallback={null}>
                    <CodePanel style={{width: `${panelWidth}%`}}/>
                </React.Suspense>
            )}
            {sidePanels
                .filter(item => item.id === panels.activePanel || panels.minimizedPanels.includes(item.id))
                .map(item => (
                    <div
                        key={item.id}
                        className={item.id === panels.activePanel ? 'plugin-side-panel' : 'plugin-side-panel plugin-side-panel--minimized'}
                    >
                        {item.render({
                            panels,
                            panelWidth,
                            minimized: item.id !== panels.activePanel,
                            onAttachVideo,
                            onDetachVideo,
                            onDetachAllVideos,
                            onQueryWithVideo,
                        })}
                    </div>
                ))}
            {panels.activePanel === 'google-workspace' && googleWorkspaceOpen && (
                <React.Suspense fallback={null}>
                    <GoogleWorkspacePanel embedded selectedMessageId={selectedGoogleMailId}
                        selectedCalendarEvent={selectedGoogleCalendarEvent}
                        onClose={onGoogleWorkspaceClose || (() => {})} style={{width: `${workspacePanelWidth}%`}}
                        onAttachDriveFileToChat={onAttachDriveFileToChat}
                        onAttachMailFilesToChat={onAttachMailFilesToChat}
                        onIndexDriveDocument={onIndexDriveDocument}/>
                </React.Suspense>
            )}
        </div>
    );
};

export default ChatArea;
