import { useState } from 'react';
import React from 'react';
import { api } from '../../services/api';
import { generateUUID, unwrapPastedText } from '../../utils/helpers';
import { parseFollowups } from '../../utils/markdownUtils';
import type { Conversation, Message, ArticleAttachment } from '../../types';

type StoredConversationMessage = Message & {
    is_generated_image?: boolean;
    pdf_file?: string;
    pdf_params?: Message['pdfParams'];
    article_sources?: ArticleAttachment[];
    injected_context?: Message['injectedContext'];
    rag_context?: Message['injectedContext']; // 이전 대화 레코드 호환용
    tool_calls?: unknown;
};

export function useConversation() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [favoriteConversations, setFavoriteConversations] = useState<Conversation[]>([]);
    // 응답 저장이 끝나기 전의 새 대화는 서버 히스토리 재조회 결과에 아직 없을 수 있다.
    // 이 ID들을 별도로 기억해 두면 다른 대화를 열어 목록을 재조회해도 항목이 사라지지 않는다.
    const optimisticConversationIdsRef = React.useRef<Set<string>>(new Set());
    const [historyTotal, setHistoryTotal] = useState<number>(0);
    const [initialHistoryLoaded, setInitialHistoryLoaded] = useState(false);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
    const HISTORY_PAGE = 20;
    const [currentConvId, setCurrentConvId] = useState<string>('');
    const currentConvIdRef = React.useRef<string>('');
    const [messages, setMessages] = useState<Message[]>([]);
    const messagesRef = React.useRef<Message[]>([]);
    // 대화 전환 중에도 백그라운드 스트리밍 결과가 다른 대화 화면에 섞이지 않도록
    // 메시지를 conversationId별로 보관한다.
    const messagesByConversationRef = React.useRef<Map<string, Message[]>>(new Map());
    const historyRequestRef = React.useRef<Promise<void> | null>(null);
    const [pendingArticles, setPendingArticles] = useState<ArticleAttachment[]>([]);
    const normalizeConversationTitle = (title: string): string => {
        const normalized = unwrapPastedText(title).replace(/\s+/g, ' ').trim();
        return normalized || '새 대화';
    };
    const normalizeConversation = (conversation: Conversation): Conversation => ({
        ...conversation,
        title: normalizeConversationTitle(conversation.title),
    });

    const setConvId = (id: string) => {
        currentConvIdRef.current = id;
        setCurrentConvId(id);
    };

    // 새 대화 첫 응답 시점에 conv_id가 막 생성된 경우, 백엔드 save_conversation은
    // 백그라운드 태스크(_save_history_bg)로 비동기 저장되어 done 이벤트 직후 loadHistory()를
    // 호출해도 아직 ES에 문서가 없어 사이드바에 안 나타날 수 있다(새로고침해야 보이는 버그).
    // → 서버 응답을 기다리지 않고 프론트에서 먼저 목록에 낙관적으로 추가해둔다.
    const addLocalConversation = (convId: string, title: string, projectId: string | null = null) => {
        optimisticConversationIdsRef.current.add(convId);
        setConversations(prev => {
            if (prev.some(c => c.conv_id === convId)) return prev;
            const now = new Date().toISOString();
            return [{
                conv_id: convId,
                title: normalizeConversationTitle(title).slice(0, 50),
                created_at: now,
                updated_at: now,
                project_id: projectId || undefined,
            }, ...prev];
        });
        setHistoryTotal(prev => prev + 1);
    };

    const completeLocalConversation = (
        convId: string, title: string, projectId: string | null = null, replaceTitle = false,
    ) => {
        const wasKnown = conversations.some(conversation => conversation.conv_id === convId)
            || optimisticConversationIdsRef.current.has(convId);
        if (!wasKnown) {
            optimisticConversationIdsRef.current.add(convId);
            setHistoryTotal(previous => previous + 1);
        }
        const updatedAt = new Date().toISOString();
        setConversations(previous => {
            const existing = previous.find(conversation => conversation.conv_id === convId);
            const normalizedTitle = normalizeConversationTitle(title).slice(0, 50);
            const updated = existing
                ? {...existing, ...(replaceTitle ? {title: normalizedTitle} : {}), updated_at: updatedAt}
                : {
                    conv_id: convId,
                    title: normalizedTitle,
                    created_at: updatedAt,
                    updated_at: updatedAt,
                    project_id: projectId || undefined,
                };
            return [updated, ...previous.filter(conversation => conversation.conv_id !== convId)];
        });
        setFavoriteConversations(previous => {
            const existing = previous.find(conversation => conversation.conv_id === convId);
            if (!existing) return previous;
            const normalizedTitle = normalizeConversationTitle(title).slice(0, 50);
            return [{
                ...existing,
                ...(replaceTitle ? {title: normalizedTitle} : {}),
                updated_at: updatedAt,
            }, ...previous.filter(conversation => conversation.conv_id !== convId)];
        });
    };

    const setMessagesWithRef = (updater: Message[] | ((prev: Message[]) => Message[])) => {
        const convId = currentConvIdRef.current;
        setMessagesForConversation(convId, updater);
    };

    const setMessagesForConversation = (
        convId: string,
        updater: Message[] | ((prev: Message[]) => Message[]),
    ) => {
        const previous = messagesByConversationRef.current.get(convId) || [];
        const next = typeof updater === 'function' ? updater(previous) : updater;
        messagesByConversationRef.current.set(convId, next);

        if (currentConvIdRef.current !== convId) return;
        setMessages(previous => {
            // React 상태 갱신이 큐에 머무는 사이 대화가 바뀔 수 있으므로 한 번 더 확인한다.
            if (currentConvIdRef.current !== convId) return previous;
            messagesRef.current = next;
            return next;
        });
    };

    const getMessagesForConversation = (convId: string) =>
        messagesByConversationRef.current.get(convId) || [];

    // snake_case → camelCase 변환
    const mapMsg = (msg: StoredConversationMessage, idx?: number): Message => {
        const storedArticleSources = msg.article_sources;
        const storedInjectedContext = msg.injected_context || msg.rag_context;
        // assistant 저장 content 말미의 <followups> 블록을 분리
        let content = msg.content;
        let followups: string[] | undefined = msg.followups;
        if (msg.role === 'assistant' && typeof content === 'string') {
            const parsed = parseFollowups(content);
            content = parsed.body;
            if (parsed.followups.length > 0) followups = parsed.followups;
        }
        return {
            id: msg.id || `${msg.timestamp || Date.now()}-${idx ?? 0}`,
            ...msg,
            content,
            followups,
            timestamp: msg.timestamp || new Date().toISOString(),
            isGeneratedImage: msg.is_generated_image ?? false,
            pdfFile: msg.pdf_file || msg.pdfFile || undefined,
            pdfParams: msg.pdf_params || msg.pdfParams || undefined,
            articleSources: storedArticleSources && storedArticleSources.length > 0
                ? storedArticleSources.map(source => ({
                    title: source.title || '',
                    url: source.url || '',
                    content: source.content || '',
                    source: source.source || '',
                    indexed_at: source.indexed_at || '',
                    application_deadline: source.application_deadline || '',
                    file_id: source.file_id || undefined,
                }))
                : msg.articleSources,
            injectedContext: storedInjectedContext && storedInjectedContext.length > 0
                ? storedInjectedContext
                : msg.injectedContext,
        };
    };

    // 첫 페이지(최신 20개)만 조회. 이후 삭제/생성 시에도 현재 로드된 개수를 유지해 재조회.
    const loadHistory = () => {
        if (historyRequestRef.current) return historyRequestRef.current;
        const request = (async () => {
            try {
                const keep = Math.max(HISTORY_PAGE, conversations.length);
                const data = await api.getHistory(keep, 0);
                const serverConversations = (data.conversations || []).map(normalizeConversation);
                setFavoriteConversations((data.favorite_conversations || []).map(normalizeConversation));
                const serverConversationIds = new Set(serverConversations.map(conversation => conversation.conv_id));
                for (const convId of optimisticConversationIdsRef.current) {
                    if (serverConversationIds.has(convId)) optimisticConversationIdsRef.current.delete(convId);
                }
                setConversations(previous => {
                    const pendingConversations = previous.filter(conversation =>
                        optimisticConversationIdsRef.current.has(conversation.conv_id)
                        && !serverConversationIds.has(conversation.conv_id),
                    );
                    return [...pendingConversations, ...serverConversations];
                });
                const serverTotal = data.total ?? serverConversations.length;
                setHistoryTotal(serverTotal + optimisticConversationIdsRef.current.size);
            } catch (error) {
                console.error('Failed to load history:', error);
            } finally {
                setInitialHistoryLoaded(true);
            }
        })();
        historyRequestRef.current = request;
        void request.finally(() => {
            if (historyRequestRef.current === request) historyRequestRef.current = null;
        });
        return request;
    };

    // 더보기: 다음 20개를 이어서 조회해 append.
    const loadMoreHistory = async () => {
        try {
            const data = await api.getHistory(HISTORY_PAGE, conversations.length, null, false);
            const more = (data.conversations || []).map(normalizeConversation);
            setConversations(prev => {
                const seen = new Set(prev.map(c => c.conv_id));
                return [...prev, ...more.filter(c => !seen.has(c.conv_id))];
            });
            if (typeof data.total === 'number') setHistoryTotal(data.total);
        } catch (error) {
            console.error('Failed to load more history:', error);
        }
    };

    const newConversation = (setResetTrigger: (fn: (n: number) => number) => void) => {
        const convId = generateUUID();
        setConvId(convId);
        setMessagesForConversation(convId, []);
        setPendingArticles([]);
        setResetTrigger(n => n + 1);
    };

    const clearConversation = async (setResetTrigger: (fn: (n: number) => number) => void) => {
        const convId = currentConvIdRef.current;
        if (convId) {
            await api.clearConversationMessages(convId);
        }
        setMessagesWithRef([]);
        setPendingArticles([]);
        setResetTrigger(n => n + 1);
    };

    const loadConversation = async (
        convId: string,
        setResetTrigger: (fn: (n: number) => number) => void,
        preserveLocalMessages = false,
    ) => {
        try {
            setPendingArticles([]);
            setResetTrigger(n => n + 1);
            setConvId(convId);
            // 이미 스트리밍 중인 대화를 다시 열면 로컬의 최신 토큰을 즉시 보여준다.
            setMessagesForConversation(convId, messagesByConversationRef.current.get(convId) || []);
            if (preserveLocalMessages) return;
            const data = await api.getConversation(convId);
            // 요청 완료 후 다른 대화를 선택했어도 해당 대화의 캐시만 갱신한다.
            const storedMessages = data.messages as StoredConversationMessage[];
            setMessagesForConversation(convId, storedMessages
                .filter(message => message.role === 'user' || (message.role === 'assistant' && !message.tool_calls))
                .map((message, index) => mapMsg(message, index)));
        } catch (error) {
            console.error('Failed to load conversation:', error);
        }
    };

    const deleteConversation = async (
        convId: string,
        currentConvId: string,
        setResetTrigger: (fn: (n: number) => number) => void
    ) => {
        try {
            optimisticConversationIdsRef.current.delete(convId);
            setConversations(prev => prev.filter(conv => conv.conv_id !== convId));
            setFavoriteConversations(prev => prev.filter(conv => conv.conv_id !== convId));
            setHistoryTotal(prev => Math.max(0, prev - 1));
            await api.deleteConversation(convId);
            if (convId === currentConvId) newConversation(setResetTrigger);
        } catch (error) {
            console.error('Failed to delete conversation:', error);
            await loadHistory();
        }
    };

    const setConversationFavorite = async (conversation: Conversation, isFavorite: boolean) => {
        const updatedConversation = {...conversation, is_favorite: isFavorite};
        setConversations(previous => previous.map(item =>
            item.conv_id === conversation.conv_id ? updatedConversation : item
        ));
        setFavoriteConversations(previous => isFavorite
            ? [updatedConversation, ...previous.filter(item => item.conv_id !== conversation.conv_id)]
            : previous.filter(item => item.conv_id !== conversation.conv_id));
        try {
            await api.setConversationFavorite(conversation.conv_id, isFavorite);
        } catch (error) {
            console.error('Failed to update favorite conversation:', error);
            await loadHistory();
        }
    };

    const deleteAllConversations = async (setResetTrigger: (fn: (n: number) => number) => void) => {
        const currentConversation = conversations.find(conversation => conversation.conv_id === currentConvIdRef.current);
        const shouldPreserveCurrentConversation = Boolean(
            currentConversation?.project_id || (!currentConversation && activeProjectId),
        );
        const projectConversationIds = new Set(
            conversations
                .filter(conversation => conversation.project_id)
                .map(conversation => conversation.conv_id),
        );
        await api.deleteAllConversations();
        optimisticConversationIdsRef.current.forEach(conversationId => {
            if (!projectConversationIds.has(conversationId)) {
                optimisticConversationIdsRef.current.delete(conversationId);
            }
        });
        await loadHistory();
        if (!shouldPreserveCurrentConversation) newConversation(setResetTrigger);
    };

    const deleteProjectConversations = async (
        projectId: string,
        setResetTrigger: (fn: (n: number) => number) => void,
    ) => {
        const deletedConversations = conversations.filter(conversation => conversation.project_id === projectId);
        const deletedConversationIds = new Set(deletedConversations.map(conversation => conversation.conv_id));
        const deletesCurrentConversation = deletedConversationIds.has(currentConvIdRef.current);

        await api.deleteProjectHistory(projectId);
        deletedConversationIds.forEach(conversationId => {
            optimisticConversationIdsRef.current.delete(conversationId);
            messagesByConversationRef.current.delete(conversationId);
        });
        setConversations(previous => previous.filter(conversation => conversation.project_id !== projectId));
        setHistoryTotal(previous => Math.max(0, previous - deletedConversations.length));
        await loadHistory();

        if (deletesCurrentConversation) newConversation(setResetTrigger);
    };

    return {
        conversations, favoriteConversations, currentConvId, currentConvIdRef, activeProjectId, setActiveProjectId,
        messages, messagesRef,
        pendingArticles, setPendingArticles,
        setConvId, addLocalConversation, completeLocalConversation, setMessagesWithRef, setMessagesForConversation, getMessagesForConversation, mapMsg,
        loadHistory, loadMoreHistory, historyTotal, initialHistoryLoaded,
        newConversation, clearConversation, loadConversation,
        deleteConversation, deleteAllConversations, deleteProjectConversations, setConversationFavorite,
    };
}
