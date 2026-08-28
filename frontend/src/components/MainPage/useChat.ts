import React from 'react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {generateUUID} from '../../utils/helpers';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import type {Message, ArticleAttachment, InjectedContextItem, ResponseProgressMessage, ToolActivity} from '../../types';
import {IMAGE_MODEL_IDS} from './useModels';
import {streamSSE} from '../../utils/streamClient';
import {parseFollowups} from '../../utils/markdownUtils';
import {getReasoningRequestValue} from '../../utils/reasoning';
import {formatApiErrorForUser} from '../../utils/apiError';
import {isSupportedChatFile} from '../../utils/fileValidation';
import type {FileAttachment} from '../ChatInput/useAttachments';
import type {ExternalDocumentSelection} from '../../services/externalDocumentSelections';
import {findPluginCommand} from '../../plugins/registry';
import {resolveApprovalMode} from '../../services/approvalPolicy';
import {getToolActivityDetail, getToolActivityLabel, getToolActivityLinks, getToolActivityResultPresentation, isToolActivityResultFailed} from '../../utils/toolActivity';

const STREAM_RENDER_INTERVAL_MS = 32;

function toolGroup(name?: string): ToolActivity['group'] {
    if (!name) return 'tool';
    const tool = name.includes('__') ? name.split('__').slice(1).join('__') : name;
    return tool.startsWith('code_') ? 'code' : 'tool';
}

function appendCompactActivity(
    activities: ToolActivity[],
    status: ToolActivity,
): ToolActivity[] {
    const now = Date.now();
    if (status.phase === 'completed') {
        let runningIndex = -1;
        for (let index = activities.length - 1; index >= 0; index -= 1) {
            if (activities[index].phase === 'running') {
                runningIndex = index;
                break;
            }
        }
        if (runningIndex < 0) return activities;
        if (status.outcome === 'rejected') {
            return activities.filter((_, index) => index !== runningIndex);
        }
        return activities.map((activity, index) => index === runningIndex
            ? {...activity, ...status, phase: 'completed', completedAt: now}
            : activity);
    }

    let compactActivities = activities;
    if (status.phase === 'running') {
        const lastActivity = activities[activities.length - 1];
        if (lastActivity?.phase === 'running'
            && lastActivity.awaitingApproval
            && lastActivity.name === status.name) {
            return activities.map((activity, index) => index === activities.length - 1
                ? {
                    ...activity,
                    ...status,
                    awaitingApproval: false,
                    id: activity.id,
                    startedAt: now,
                }
                : activity);
        }
        const hasPreviousTask = activities.some(activity => activity.group === 'code' || activity.group === 'tool');
        if (hasPreviousTask && lastActivity?.phase === 'judging') {
            compactActivities = activities.slice(0, -1);
        }
    }

    const lastActivity = compactActivities[compactActivities.length - 1];
    if (status.phase === 'judging' && lastActivity?.phase === 'judging') {
        return compactActivities.map((activity, index) => index === compactActivities.length - 1
            ? {...activity, ...status}
            : activity);
    }

    return [...compactActivities, {
        ...status,
        id: `${now}-${compactActivities.length}`,
        startedAt: now,
    }];
}

interface UseChatDeps {
    currentConvId: string;
    activeProjectId: string | null;
    currentConvIdRef: React.MutableRefObject<string>;
    messagesRef: React.MutableRefObject<Message[]>;
    selectedModel: string;
    isImageMode: boolean;
    pendingArticles: ArticleAttachment[];
    showVoiceChatModalRef: React.MutableRefObject<boolean>;
    setConvId: (id: string) => void;
    addLocalConversation: (convId: string, title: string, projectId?: string | null) => void;
    completeLocalConversation: (convId: string, title: string, projectId?: string | null, replaceTitle?: boolean) => void;
    setMessagesWithRef: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
    setMessagesForConversation: (convId: string, updater: Message[] | ((prev: Message[]) => Message[])) => void;
    getMessagesForConversation: (convId: string) => Message[];
    setPendingArticles: React.Dispatch<React.SetStateAction<ArticleAttachment[]>>;
    mapMsg: (msg: any, idx?: number) => Message;
    newConversation: (setResetTrigger: (fn: (n: number) => number) => void) => void;
    clearConversation: (setResetTrigger: (fn: (n: number) => number) => void) => Promise<void>;
    setResetTrigger: React.Dispatch<React.SetStateAction<number>>;
    setIsDownloading: (v: boolean) => void;
    setDownloadingModel: (v: string) => void;
    setDownloadProgress: (v: number) => void;
    setDownloadMessage: (v: string) => void;
    openPluginModal: (modalId: string) => void;
    setShowRememberModal: (ts: string) => void;
}

interface ConversationRequestState {
    isLoading: boolean;
    streamingMessageId: string | null;
    startedAt: number | null;
}

interface FailedRequest {
    query: string;
    attachments: any[];
    systemPromptOverride?: string;
    voiceMode?: boolean;
    extraArticles?: ArticleAttachment[];
    selectedMcpIds?: string[];
    knowledgeCollectionIds?: string[];
    externalResourceIds?: string[];
    externalDocumentSelections?: ExternalDocumentSelection[];
}

export function useChat(deps: UseChatDeps) {
    const {t} = useTranslation('main');
    const [requestStates, setRequestStates] = useState<Record<string, ConversationRequestState>>({});
    const [imageGenProgress, setImageGenProgress] = useState(0);
    const [imageGenMessage, setImageGenMessage] = useState('');
    const [lastFailedQuery, setLastFailedQuery] = useState<FailedRequest | null>(null);
    // 현재 토큰 스트리밍 중인 assistant 메시지의 id (없으면 null)
    const isSendingRef = React.useRef(false);
    const abortControllerRef = React.useRef<AbortController | null>(null);
    const [codeFolderPath, setCodeFolderPath] = useState<string>('');

    // zip 첨부 시 대상 파일이 너무 많아 사용자 확인이 필요한 경우의 요청 상태
    // (모달은 이 상태를 구독하는 컴포넌트 쪽에서 렌더링, 선택 결과는 resolver로 전달)
    const [zipConfirmRequest, setZipConfirmRequest] = useState<{
        originalName: string;
        totalEligible: number;
        defaultLimit: number;
    } | null>(null);
    const zipConfirmResolverRef = React.useRef<((maxFiles: number) => void) | null>(null);

    /** zip_confirm_needed 응답을 받았을 때 사용자 선택을 기다리는 Promise를 반환 */
    const waitForZipConfirm = (originalName: string, totalEligible: number, defaultLimit: number): Promise<number> => {
        setZipConfirmRequest({originalName, totalEligible, defaultLimit});
        return new Promise<number>(resolve => {
            zipConfirmResolverRef.current = (maxFiles: number) => {
                setZipConfirmRequest(null);
                resolve(maxFiles);
            };
        });
    };

    /** ConfirmModal에서 사용자가 선택했을 때 호출 (예: '50개만' → defaultLimit, '전체' → totalEligible) */
    const resolveZipConfirm = (maxFiles: number) => {
        zipConfirmResolverRef.current?.(maxFiles);
        zipConfirmResolverRef.current = null;
    };

    const {
        currentConvId, currentConvIdRef, messagesRef, selectedModel, activeProjectId,
        pendingArticles, showVoiceChatModalRef,
        setConvId, addLocalConversation, completeLocalConversation, setMessagesWithRef, setMessagesForConversation, getMessagesForConversation, setPendingArticles, mapMsg,
        clearConversation, setResetTrigger,
        openPluginModal,
        setShowRememberModal,
    } = deps;

    const setConversationRequestState = (
        convId: string,
        update: Partial<ConversationRequestState>,
    ) => {
        setRequestStates(previous => ({
            ...previous,
            [convId]: {
                isLoading: previous[convId]?.isLoading ?? false,
                streamingMessageId: previous[convId]?.streamingMessageId ?? null,
                startedAt: update.isLoading && !previous[convId]?.isLoading
                    ? Date.now()
                    : previous[convId]?.startedAt ?? null,
                ...update,
            },
        }));
    };

    const currentRequestState = requestStates[currentConvId];
    const isLoading = currentRequestState?.isLoading ?? false;
    const streamingMessageId = currentRequestState?.streamingMessageId ?? null;
    const responseStartedAt = currentRequestState?.startedAt ?? null;
    const activeConversationIds = Object.entries(requestStates)
        .filter(([, state]) => state.isLoading)
        .map(([convId]) => convId);
    const hasActiveRequests = activeConversationIds.length > 0;

    const resetImageGen = () => {
        setImageGenProgress(0);
        setImageGenMessage('');
    };

    // 새 대화방의 conv_id가 처음 확정되는 시점에 호출: state에 반영하는 동시에
    // 사이드바 목록에도 바로 추가해 백엔드 저장 타이밍 레이스를 피한다.
    const assignNewConvId = (id: string, titleSeed: string) => {
        setConvId(id);
        addLocalConversation(id, titleSeed || '새 대화', activeProjectId);
    };

    const handleSend = async (
        query: string,
        images?: File[],
        fileAttachments?: FileAttachment[],
        systemPromptOverride?: string,
        voiceMode?: boolean,
        extraArticles?: ArticleAttachment[],
        selectedMcpIds?: string[],
        knowledgeCollectionIds?: string[],
        externalResourceIds?: string[],
        externalDocumentSelections?: ExternalDocumentSelection[],
    ): Promise<boolean> => {
        const hasContent = query.trim() || (images?.length ?? 0) > 0
            || (fileAttachments?.length ?? 0) > 0
            || pendingArticles.length > 0
            || (extraArticles?.length ?? 0) > 0;
        if (!hasContent || hasActiveRequests || isSendingRef.current) return false;

        const unsupportedFile = [
            ...(images ?? []),
            ...(fileAttachments ?? []).map(attachment => attachment.file),
        ].find(file => !isSupportedChatFile(file));
        if (unsupportedFile) {
            toast.warning(t('documentModal.unsupportedFormat', {name: unsupportedFile.name}));
            return false;
        }

        isSendingRef.current = true;
        try {
            return await handleSendInner(query, images, fileAttachments, systemPromptOverride, voiceMode, extraArticles, selectedMcpIds, knowledgeCollectionIds, externalResourceIds, externalDocumentSelections);
        } finally {
            isSendingRef.current = false;
        }
    };

    /** returns false when all file uploads failed and request was aborted */
    const handleSendInner = async (
        query: string,
        images?: File[],
        fileAttachments?: FileAttachment[],
        systemPromptOverride?: string,
        voiceMode?: boolean,
        extraArticles?: ArticleAttachment[],
        selectedMcpIds?: string[],
        knowledgeCollectionIds?: string[],
        externalResourceIds?: string[],
        externalDocumentSelections?: ExternalDocumentSelection[],
        uploadedAttachments: any[] = [],
    ): Promise<boolean> => {
        const requestConvId = currentConvIdRef.current || currentConvId;
        const articlesSnapshot = extraArticles?.length
            ? [...extraArticles]
            : [...pendingArticles];

        // ── 커맨드 처리 ──────────────────────────────────────────────
        if (query.trim() === '/clear') {
            clearConversation(setResetTrigger);
            return true;
        }
        const pluginCommand = findPluginCommand(query.trim());
        if (pluginCommand) {
            openPluginModal(pluginCommand.modalId);
            return true;
        }
        if (query.trim() === '/remember') {
            setShowRememberModal(new Date().toISOString());
            return true;
        }

        // 새 대화는 응답 생성이나 파일 업로드가 진행되는 동안에도 사이드바에서 즉시
        // 다시 선택할 수 있어야 한다. 이미 저장된 대화면 중복 추가되지 않는다.
        addLocalConversation(requestConvId, query.trim() || t('sidebar.newChat'), activeProjectId);

        // ── 파일 업로드 (진행 표시 포함) ─────────────────────────────
        const totalFiles = (images?.length ?? 0) + (fileAttachments?.length ?? 0);
        const uploadStreamId = totalFiles > 0 ? `upload-${Date.now()}` : null;
        if (uploadStreamId) {
            setMessagesForConversation(requestConvId, prev => [...prev, {
                id: uploadStreamId,
                role: 'assistant', content: '', timestamp: new Date().toISOString(),
                toolStatus: {phase: 'running', label: t('toolActivity.indexing', {done: 0, total: totalFiles})},
            }]);
            setConversationRequestState(requestConvId, {streamingMessageId: uploadStreamId, isLoading: true});
        }
        let uploadedCount = 0;
        const updateUploadDetail = (detail: string, label?: string) => {
            if (uploadStreamId) {
                setMessagesForConversation(requestConvId, prev => prev.map(m =>
                    m.id === uploadStreamId
                        ? {...m, toolStatus: {phase: 'running', label: label ?? t('toolActivity.indexing', {done: uploadedCount, total: totalFiles}), detail}}
                        : m));
            }
        };
        const markUploadDone = (name: string) => {
            uploadedCount++;
            updateUploadDetail(name);
        };
        /** XHR 기반 파일 업로드 — progress 이벤트로 업로드 진행률 표시 */
        const uploadWithProgress = (url: string, formData: FormData, fileName: string): Promise<Response> => {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', url);
                xhr.upload.addEventListener('progress', e => {
                    if (e.lengthComputable && e.total > 0) {
                        const pct = Math.round((e.loaded / e.total) * 100);
                        updateUploadDetail(fileName, t('toolActivity.uploading', {name: fileName, pct}));
                    }
                });
                xhr.upload.addEventListener('loadend', () => {
                    updateUploadDetail(fileName, t('toolActivity.parsing', {name: fileName}));
                });
                xhr.addEventListener('load', () => {
                    resolve(new Response(xhr.responseText, {status: xhr.status, statusText: xhr.statusText, headers: new Headers({'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json'})}));
                });
                xhr.addEventListener('error', () => reject(new Error('Network error')));
                xhr.addEventListener('abort', () => reject(new DOMException('Upload aborted', 'AbortError')));
                xhr.send(formData);
            });
        };
        const attachments: any[] = [...uploadedAttachments];
        if (images?.length) {
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                try {
                    updateUploadDetail(img.name, t('toolActivity.uploading', {name: img.name, pct: 0}));
                    const formData = new FormData();
                    formData.append('file', img);
                    const response = await uploadWithProgress('http://localhost:8000/api/images/upload', formData, img.name);
                    const data = await response.json();
                    if (data.filename) {
                        attachments.push({type: 'image', filename: data.filename});
                        markUploadDone(img.name);
                    }
                } catch (error) {
                    console.error('Image upload failed:', error);
                }
            }
        }
        if (fileAttachments?.length) {
            for (const fa of fileAttachments) {
                try {
                    updateUploadDetail(fa.file.name, t('toolActivity.uploading', {name: fa.file.name, pct: 0}));
                    const formData = new FormData();
                    formData.append('file', fa.file);
                    const isAudio = fa.file.type.startsWith('audio/') || /\.(mp3|wav|flac)$/i.test(fa.file.name);
                    const uploadUrl = isAudio
                        ? 'http://localhost:8000/api/audio/upload'
                        : 'http://localhost:8000/api/files/upload';
                    const response = await uploadWithProgress(uploadUrl, formData, fa.file.name);
                    if (!response.ok) {
                        const errData = await response.json().catch(() => null);
                        const detail = isAudio && errData?.detail === 'unsupported_audio_format'
                            ? t('fileUpload.unsupportedAudioFormat')
                            : errData?.detail || response.statusText;
                        toast.error(t('fileUpload.failed', {name: fa.file.name}), detail);
                        continue;
                    }
                    let data = await response.json();

                    // zip 내 대상 파일이 너무 많으면 사용자에게 확인 후, 재업로드 없이 saved_name으로 재처리
                    if (data.type === 'zip_confirm_needed') {
                        const maxFiles = await waitForZipConfirm(
                            data.original_name, data.total_eligible, data.default_limit
                        );
                        const confirmParams = new URLSearchParams({
                            saved_name: data.saved_name,
                            original_name: data.original_name,
                            max_files: String(maxFiles),
                        });
                        const confirmResponse = await fetch(
                            `http://localhost:8000/api/files/upload/zip-confirm?${confirmParams}`,
                            {method: 'POST'}
                        );
                        if (!confirmResponse.ok) {
                            console.error('Zip 처리 실패:', confirmResponse.statusText);
                            continue;
                        }
                        data = await confirmResponse.json();
                    }

                    attachments.push(data);
                    markUploadDone(fa.file.name);
                } catch (error) {
                    toast.error(t('fileUpload.failed', {name: fa.file.name}), String(error));
                }
            }
        }

        // 모든 파일 업로드 실패 시: 무조건 요청 중단 (입력 상태 복원)
        if (totalFiles > 0 && attachments.length === 0) {
            if (uploadStreamId) {
                setMessagesForConversation(requestConvId, prev => prev.filter(m => m.id !== uploadStreamId));
                setConversationRequestState(requestConvId, {streamingMessageId: null, isLoading: false});
            }
            return false;
        }

        // 메일·Drive 문서·기사·영상 등 선택 자료는 이번 요청에서만 소비한다.
        // 대화 화면의 출처 기록은 userMessage/articleSources에 남지만 다음 요청에는 자동 재주입하지 않는다.
        if (articlesSnapshot.length > 0) setPendingArticles([]);

        const failedRequest: FailedRequest = {
            query,
            attachments,
            systemPromptOverride,
            voiceMode,
            extraArticles: articlesSnapshot,
            selectedMcpIds,
            knowledgeCollectionIds,
            externalResourceIds,
            externalDocumentSelections,
        };

        const userTs = new Date().toISOString();  // 전송 시각 — 화면/서버 동일하게 사용
        const userMessage: Message = {
            role: 'user', content: query, timestamp: userTs,
            attachments: attachments.length > 0 ? attachments : undefined,
            articleSources: articlesSnapshot.length > 0 ? articlesSnapshot : undefined,
        };
        // 업로드 진행 표시용 임시 메시지는 히스토리에서 제외
        const prevMessagesSnapshot = uploadStreamId
            ? messagesRef.current.filter(m => m.id !== uploadStreamId)
            : [...messagesRef.current];
        // 이전 메시지의 첨부는 화면 기록으로만 유지하고 다음 요청에는 다시 보내지 않는다.
        // 파일·ZIP은 별도의 chat_file_chunks 대화방 검색을 통해 관련 청크만 조회된다.
        const sanitizedHistory = prevMessagesSnapshot.map(msg => {
            if (!msg.attachments?.length) return msg;
            return {...msg, attachments: undefined};
        });
        // 업로드 진행 메시지 제거 후 유저 메시지 추가
        if (uploadStreamId) setConversationRequestState(requestConvId, {streamingMessageId: null});
        setMessagesForConversation(requestConvId, prev => [
            ...(uploadStreamId ? prev.filter(m => m.id !== uploadStreamId) : prev),
            userMessage
        ]);
        setConversationRequestState(requestConvId, {isLoading: true});

        try {
            const isCurrentlyImageMode = IMAGE_MODEL_IDS.includes(selectedModel);
            if (isCurrentlyImageMode) {
                resetImageGen();
                setImageGenMessage('이미지 생성 준비 중...');
                const response = await api.generateImage(query, requestConvId, sanitizedHistory,
                    attachments.length > 0 ? attachments : undefined,
                    (msg, progress) => {
                        setImageGenMessage(msg);
                        setImageGenProgress(progress);
                    });
                resetImageGen();
                if (response.conv_id && !requestConvId) assignNewConvId(response.conv_id, query);
                const finalConvId = response.conv_id || requestConvId;
                if (finalConvId) completeLocalConversation(finalConvId, query, activeProjectId);
                const assistantMessage = response.assistant_message
                    ? mapMsg(response.assistant_message)
                    : {
                        role: 'assistant', content: `이미지를 생성했습니다. (${response.count}장)`,
                        timestamp: new Date().toISOString(), model: response.model,
                        attachments: response.filenames.map((f: string) => ({type: 'image', filename: f})),
                        isGeneratedImage: true,
                    } as Message;
                setMessagesForConversation(requestConvId, prev => [...prev, assistantMessage]);
                return true;
            }

            // ── URL/기사 첨부 채팅은 토큰 스트리밍 경로 ─────────────────
            // 조건: (기사 첨부 있음) 또는 (질문에 URL 포함), 그리고 voice_mode 아님.
            // 이 경로는 <action> 실행 파이프라인을 타지 않아 스트리밍 안전.
            // 이미지 생성 모델/voice가 아니면 전부 스트리밍 (기사·URL·순수 일반채팅 모두 서버가 분기)
            const canStreamChat = !voiceMode && !isCurrentlyImageMode;

            if (canStreamChat) {
                abortControllerRef.current = new AbortController();

                const streamId = generateUUID();
                setMessagesForConversation(requestConvId, prev => [...prev, {
                    id: streamId, role: 'assistant', content: '', timestamp: new Date().toISOString(),
                }]);
                setConversationRequestState(requestConvId, {streamingMessageId: streamId});

                let responseWritingStarted = false;
                let streamedResponseText = '';
                let pendingStreamText = '';
                let streamRenderTimer: number | null = null;
                const flushStreamText = () => {
                    if (streamRenderTimer !== null) {
                        window.clearTimeout(streamRenderTimer);
                        streamRenderTimer = null;
                    }
                    if (!pendingStreamText) return;
                    const text = pendingStreamText;
                    pendingStreamText = '';
                    setMessagesForConversation(requestConvId, prev => prev.map(m =>
                        m.id === streamId ? {...m, content: (m.content || '') + text, toolStatus: undefined} : m));
                };
                const appendToStreamMsg = (piece: string) => {
                    if (!responseWritingStarted) {
                        responseWritingStarted = true;
                        // 최종 답변의 첫 토큰이 도착한 순간 작업 과정은 역할을 다했다.
                        // done까지 남겨두면 답변과 경과 시간 위에 완료된 도구 목록이 계속 보인다.
                        setMessagesForConversation(requestConvId, prev => prev.map(message => message.id === streamId
                            ? {
                                ...message,
                                toolStatus: undefined,
                                activityLog: undefined,
                                progressMessages: undefined,
                            }
                            : message));
                    }
                    streamedResponseText += piece;
                    pendingStreamText += piece;
                    if (streamRenderTimer === null) {
                        streamRenderTimer = window.setTimeout(flushStreamText, STREAM_RENDER_INTERVAL_MS);
                    }
                };

                // (onReset 제거됨 — 판정이 비스트리밍이므로 reset 불필요)

                const setToolStatus = (status: ToolActivity | undefined) => {
                    flushStreamText();
                    setMessagesForConversation(requestConvId, prev => prev.map(m =>
                        m.id === streamId
                            ? {
                                ...m,
                                toolStatus: status,
                                activityLog: status
                                    ? appendCompactActivity(m.activityLog || [], status)
                                    : m.activityLog,
                            }
                            : m));
                };

                try {
                    let streamModel = '';
                    let streamSources: any[] = [];
                    await streamSSE('http://localhost:8000/api/query/stream', {
                        question: query,
                        conv_id: requestConvId,
                        user_timestamp: userTs,
                        messages: sanitizedHistory,
                        system_prompt: systemPromptOverride || '',
                        attachments: attachments.length > 0 ? attachments : [],
                        articles: articlesSnapshot.length > 0 ? articlesSnapshot : [],
                        article_selection_explicit: true,
                        voice_mode: false,
                        reasoning: getReasoningRequestValue(),
                        folder_path: codeFolderPath || '',
                        project_id: deps.activeProjectId || '',
                        selected_mcp_ids: selectedMcpIds || [],
                        knowledge_collection_ids: knowledgeCollectionIds || [],
                        external_resource_ids: externalResourceIds || [],
                        external_document_selections: externalDocumentSelections || [],
                        approval_mode: resolveApprovalMode(),
                    }, {
                        onMeta: (data) => {
                            streamModel = data.model || '';
                            streamSources = data.sources || [];
                        },
                        onToken: (text) => appendToStreamMsg(
                            text.includes('VYACT_EMPTY_RESPONSE') ? t('emptyResponse') : text
                        ),
                        onReset: (data) => {
                            flushStreamText();
                            const progressContent = data.content?.trim() || streamedResponseText.trim();
                            pendingStreamText = '';
                            streamedResponseText = '';
                            responseWritingStarted = false;
                            setMessagesForConversation(requestConvId, prev => prev.map(m => {
                                if (m.id !== streamId) return m;
                                const progressMessages: ResponseProgressMessage[] = progressContent
                                    ? [...(m.progressMessages || []), {
                                        id: `${Date.now()}-${m.progressMessages?.length ?? 0}`,
                                        content: progressContent,
                                        createdAt: Date.now(),
                                    }]
                                    : m.progressMessages || [];
                                return {...m, content: '', progressMessages};
                            }));
                        },
                        onTool: (data) => {
                            if (data.phase === 'approval_required') {
                                window.dispatchEvent(new CustomEvent('vyact:tool-approval-required', {detail: data}));
                                const browserApprovalTool = data.name?.split('__').slice(-1)[0];
                                const isBrowserUserAction = browserApprovalTool === 'browser_wait_for_user' || browserApprovalTool === 'browser_ask_user';
                                const pendingActionLabel = getToolActivityLabel(data.name, t);
                                setToolStatus({phase: 'running', name: data.name, group: toolGroup(data.name), label: isBrowserUserAction
                                    ? t('toolActivity.waitingBrowserUser')
                                    : t('toolActivity.waitingApprovalForAction', {action: pendingActionLabel}), detail: getToolActivityDetail(data.args), awaitingApproval: true});
                            } else if (data.phase === 'approval_rejected') {
                                setToolStatus({phase: 'completed', outcome: 'rejected', name: data.name, group: toolGroup(data.name), label: t('toolActivity.approvalRejected'), detail: getToolActivityDetail(data.args)});
                                setToolStatus({phase: 'judging', group: 'analysis', label: t('toolActivity.approvalRejectedPreparingResponse')});
                            } else if (data.phase === 'judging') {
                                setToolStatus({phase: 'judging', group: 'analysis', label: t((data.round ?? 0) > 0 ? 'toolActivity.additionalAnalysis' : 'toolActivity.analyzing')});
                            } else if (data.phase === 'start') {
                                setToolStatus({phase: 'running', name: data.name, group: toolGroup(data.name), label: getToolActivityLabel(data.name, t), detail: getToolActivityDetail(data.args), links: getToolActivityLinks(data.args)});
                            } else if (data.phase === 'end') {
                                const toolResult = data.result ?? '';
                                const failed = isToolActivityResultFailed(toolResult);
                                const presentation = getToolActivityResultPresentation(toolResult, data.args);
                                if (failed && toolResult.includes('VYACT_BROWSER_EXTENSION_REQUIRED')) {
                                    window.dispatchEvent(new CustomEvent('vyact:browser-extension-required'));
                                }
                                setToolStatus({
                                    phase: 'completed',
                                    outcome: failed ? 'failed' : 'success',
                                    name: data.name,
                                    group: toolGroup(data.name),
                                    label: t(failed ? 'toolActivity.failed' : 'toolActivity.completed'),
                                    detail: presentation.detail,
                                    links: presentation.links,
                                });
                                // 검색/도구 단계가 끝난 뒤 첫 토큰이 오기까지는 프롬프트 평가가 진행된다.
                                // 완료된 작업명(예: 컬렉션 검색)을 계속 표시하지 않고 응답 준비 상태로 전환한다.
                                setToolStatus({phase: 'judging', group: 'analysis', label: t('toolActivity.thinking')});
                            }
                        },
                        onIndexProgress: (data) => {
                            // 첨부파일 임베딩 인덱싱이 LLM 호출보다 먼저 끝까지 진행되는 동안의
                            // 진행 표시. 완료(done>=total) 시점에 바로 "생각하는 중"으로 전환한다 —
                            // 안 그러면 인덱싱 완료 후 실제 토큰/tool 이벤트가 오기 전까지
                            // "인덱싱 중 N/N" 문구가 그대로 멈춰있는 것처럼 보인다.
                            const total = data.total ?? 0;
                            const done = data.done ?? 0;
                            if (total > 0 && done >= total) {
                                setToolStatus({phase: 'judging', group: 'analysis', label: t('toolActivity.thinking')});
                            } else {
                                setToolStatus({phase: 'running', group: 'tool', label: t('toolActivity.indexing', {done, total}), detail: data.source_name || undefined});
                            }
                        },
                        onDone: (data) => {
                            flushStreamText();
                            setMessagesForConversation(requestConvId, prev => prev.map(message => message.id === streamId
                                ? {
                                    ...message,
                                    activityLog: message.activityLog?.map(activity => activity.phase === 'completed'
                                        ? activity
                                        : {...activity, phase: 'completed', completedAt: Date.now()}),
                                }
                                : message));
                            if (data.conv_id && !requestConvId) assignNewConvId(data.conv_id, query);
                            completeLocalConversation(
                                data.conv_id || requestConvId,
                                data.conversation_title || query,
                                activeProjectId,
                                Boolean(data.conversation_title),
                            );
                            const esSources: ArticleAttachment[] = (streamSources || [])
                                .filter((s: any) => s.url && !s.url.startsWith('manual://'))
                                .map((s: any) => ({
                                    title: s.title || '',
                                    url: s.url || '',
                                    content: s.content || '',
                                    source: s.source || '',
                                    indexed_at: s.indexed_at || '',
                                    application_deadline: s.application_deadline || '',
                                }));
                            const mergedSources: ArticleAttachment[] = [
                                ...articlesSnapshot,
                                ...esSources.filter(e => !articlesSnapshot.some(a => a.url === e.url)),
                            ];
                            // "주입된 데이터" 모달용 — 이번 응답에 전달한 비메모 소스를 모두 보관한다.
                            // 이 목록은 검증 UI 전용이며, 다음 턴의 대화 이력에 재주입되지 않는다.
                            const injectedContextItems: InjectedContextItem[] = (streamSources || [])
                                .filter((s: any) => {
                                    if (!s.content) return false;
                                    return !['', null, undefined, 'memo', 'quicknote', '붙여넣기'].includes(s.source);
                                })
                                .map((s: any) => ({
                                    source: s.source || s.title || '',
                                    title: s.title || '',
                                    data: s.content || '',
                                    context_origin: s.context_origin,
                                    external_document: s.external_document || (s.context_origin === 'external_data' ? s : undefined),
                                }));
                            const rawAnswer = data.answer ?? '';
                            const {body: fuBody, followups: fuList} = parseFollowups(rawAnswer);
                            const followupsOnly = !fuBody?.trim() && fuList.length > 0;
                            if (followupsOnly || (!fuBody?.trim() && !streamedResponseText.trim())) {
                                setLastFailedQuery(failedRequest);
                            }
                            setMessagesForConversation(requestConvId, prev => prev.map(m => {
                                if (m.id !== streamId) return m;
                                // follow-up 블록만 생성된 경우에는 스트리밍 원문을 본문으로
                                // 되돌리지 않는다. 모델의 빈 본문을 안내하되 후속 질문은 유지한다.
                                const finalContent = followupsOnly
                                    ? t('message.modelNoResponse')
                                    : (fuBody?.trim() ? fuBody : null) || (m.content?.trim() ? m.content : null);
                                if (!finalContent) {
                                    return {
                                        ...m,
                                        content: t('message.modelNoResponse'),
                                        isError: true, toolStatus: undefined,
                                        stats: data.stats || m.stats
                                    };
                                }
                                return {
                                    ...m, content: finalContent, model: streamModel || m.model,
                                    timestamp: new Date().toISOString(), isError: followupsOnly, toolStatus: undefined,
                                    followups: fuList.length > 0 ? fuList : undefined,
                                    articleSources: mergedSources.length > 0 ? mergedSources : undefined,
                                    injectedContext: injectedContextItems.length > 0 ? injectedContextItems : undefined,
                                    stats: data.stats || m.stats,
                                    truncated: data.truncated || undefined,
                                    codeChanges: data.code_changes || m.codeChanges,
                                    progressMessages: undefined,
                                };
                            }));
                            if (showVoiceChatModalRef.current && data.answer)
                                window.dispatchEvent(new CustomEvent('voiceChatResponse', {detail: {text: data.answer}}));
                        },
                        onError: (error) => {
                            flushStreamText();
                            setLastFailedQuery(failedRequest);
                            const isImageUnsupported = error.code === 'model_image_unsupported';
                            const isInsufficientMemory = error.code === 'model_insufficient_memory';
                            const message = isImageUnsupported
                                ? t('message.modelImageUnsupportedDescription', {model: error.model || streamModel})
                                : isInsufficientMemory
                                    ? t('message.modelInsufficientMemoryDescription', {model: error.model || streamModel})
                                    : (error.message || t('message.unknownError'));
                            setMessagesForConversation(requestConvId, prev => prev.map(m =>
                                m.id === streamId ? {
                                    ...m,
                                    content: message,
                                    errorTitle: isImageUnsupported
                                        ? t('message.modelImageUnsupportedTitle')
                                        : isInsufficientMemory
                                            ? t('message.modelInsufficientMemoryTitle')
                                            : undefined,
                                    isError: true,
                                    toolStatus: undefined,
                                } : m));
                        },
                    }, abortControllerRef.current.signal);
                } catch (streamErr) {
                    flushStreamText();
                    // 사용자가 직접 중지한 경우 — 에러 아님
                    if (streamErr instanceof DOMException && streamErr.name === 'AbortError') {
                        setMessagesForConversation(requestConvId, prev => prev.map(m =>
                            m.id === streamId && !m.content?.trim()
                                ? {
                                    ...m,
                                    content: t('toolActivity.stopped'),
                                    isError: false,
                                    toolStatus: undefined,
                                    activityLog: m.activityLog?.map(activity => activity.phase === 'completed'
                                        ? activity
                                        : {...activity, phase: 'completed', completedAt: Date.now()}),
                                }
                                : m));
                    } else {
                        // HTTP 레벨 실패(ApiError)나 네트워크 중단 등 — onError(서버가 보낸 SSE error
                        // 이벤트)와 별개로, 요청 자체가 실패한 경우. 바깥 catch로 전파시키면 이미 만들어둔
                        // 빈 스트리밍 말풍선은 그대로 남은 채 에러 말풍선이 하나 더 추가돼 중복으로 보이므로,
                        // 여기서 같은 말풍선(streamId)에 에러 내용을 채워 넣고 끝낸다.
                        setMessagesForConversation(requestConvId, prev => prev.map(m =>
                            m.id === streamId
                                ? {
                                    ...m,
                                    content: formatApiErrorForUser(streamErr),
                                    isError: true,
                                    toolStatus: undefined
                                }
                                : m));
                        setLastFailedQuery(failedRequest);
                    }
                } finally {
                    flushStreamText();
                    setConversationRequestState(requestConvId, {streamingMessageId: null});
                    abortControllerRef.current = null;
                }
                return true;
            }

            // ── 일반 채팅 (비스트리밍: action 가능성 있음) ────────────────
            const response = await api.chat(query, requestConvId, sanitizedHistory,
                attachments.length > 0 ? attachments : undefined,
                articlesSnapshot.length > 0 ? articlesSnapshot : undefined,
                systemPromptOverride, voiceMode,
                getReasoningRequestValue());

            const isNewConv = !requestConvId;
            if (response.conv_id && isNewConv) {
                assignNewConvId(response.conv_id, query);
            }

            const isActionResponse = response.response_type === 'action';
            const esSources: ArticleAttachment[] = isActionResponse ? [] : (response.sources || [])
                .filter((s: any) => s.url && !s.url.startsWith('manual://'))
                .map((s: any) => ({
                    title: s.title || '',
                    url: s.url || '',
                    content: s.content || '',
                    source: s.source || '',
                    indexed_at: s.indexed_at || '',
                    application_deadline: s.application_deadline || '',
                }));

            const mergedSources: ArticleAttachment[] = isActionResponse ? [] : [
                ...articlesSnapshot,
                ...esSources.filter(e => !articlesSnapshot.some(a => a.url === e.url)),
            ];
            const injectedContextItems: InjectedContextItem[] = isActionResponse ? [] : (response.sources || [])
                .filter((source: any) => source.content
                    && !['', null, undefined, 'memo', 'quicknote', '붙여넣기'].includes(source.source))
                .map((source: any) => ({
                    source: source.source || source.title || '',
                    title: source.title || '',
                    data: source.content,
                    context_origin: source.context_origin,
                    external_document: source.external_document || (source.context_origin === 'external_data' ? source : undefined),
                }));

            const finalConvId = response.conv_id || requestConvId;
            if (finalConvId) completeLocalConversation(
                finalConvId, response.conversation_title || query, activeProjectId,
                Boolean(response.conversation_title),
            );
            const storedAssistantMessage = response.assistant_message
                ? mapMsg(response.assistant_message)
                : null;
            const botMessage: Message = {
                ...storedAssistantMessage,
                role: 'assistant',
                content: response.answer,
          model: response.model || storedAssistantMessage?.model,
          articleSources: mergedSources.length > 0 ? mergedSources : storedAssistantMessage?.articleSources,
                injectedContext: injectedContextItems.length > 0
                    ? injectedContextItems
                    : storedAssistantMessage?.injectedContext,
                timestamp: storedAssistantMessage?.timestamp || new Date().toISOString(),
            };
            setMessagesForConversation(requestConvId, prev => [...prev, botMessage]);
            if (showVoiceChatModalRef.current)
                window.dispatchEvent(new CustomEvent('voiceChatResponse', {detail: {text: botMessage.content}}));
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                // 사용자 중지 — 에러 표시 안 함
            } else {
                setLastFailedQuery(failedRequest);
                setMessagesForConversation(requestConvId, prev => [...prev, {
                    role: 'assistant',
                    content: formatApiErrorForUser(error),
                    timestamp: new Date().toISOString(),
                    isError: true
                }]);
            }
        } finally {
            setConversationRequestState(requestConvId, {isLoading: false, streamingMessageId: null});
            resetImageGen();
            abortControllerRef.current = null;
        }
        return true;
    };

    const handleRetry = async () => {
        if (!lastFailedQuery || isSendingRef.current || hasActiveRequests) return;
        const failedRequest = lastFailedQuery;
        setMessagesWithRef(prev => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].isError) next.pop();
            if (next.length > 0 && next[next.length - 1].role === 'user') next.pop();
            return next;
        });
        setLastFailedQuery(null);
        isSendingRef.current = true;
        try {
            await handleSendInner(
                failedRequest.query,
                undefined,
                undefined,
                failedRequest.systemPromptOverride,
                failedRequest.voiceMode,
                failedRequest.extraArticles,
                failedRequest.selectedMcpIds,
                failedRequest.knowledgeCollectionIds,
                failedRequest.externalResourceIds,
                failedRequest.externalDocumentSelections,
                failedRequest.attachments,
            );
        } finally {
            isSendingRef.current = false;
        }
    };

    const handleStop = () => {
        // 이 앱은 한 번에 한 요청만 실행한다. 다른 대화를 보고 있어도
        // 실제 응답 중인 대화를 찾아 그 요청을 중지해야 한다.
        const requestConvId = activeConversationIds[0] || currentConvIdRef.current || currentConvId;
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        // 빈 스트리밍 말풍선 제거, 내용 있으면 유지
        setMessagesForConversation(requestConvId, prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && !last.content?.trim()) return prev.slice(0, -1);
            return prev;
        });
        // 대화 ID가 스트리밍 도중 확정되거나 전환된 경우 이전 ID의 요청 상태가
        // 남을 수 있다. 모델 변경처럼 전체 응답을 중지하는 경로에서는 활성 상태를
        // 모두 해제해 히스토리를 다시 열었을 때 로딩 표시가 고착되지 않게 한다.
        const requestConversationIds = new Set([...activeConversationIds, requestConvId]);
        requestConversationIds.forEach(conversationId => {
            if (conversationId) {
                setConversationRequestState(conversationId, {isLoading: false, streamingMessageId: null});
            }
        });
        // 새 대화방이면 사이드바에 즉시 추가 (백엔드 저장 완료 대기 없이)
        if (requestConvId) {
            const firstMsg = getMessagesForConversation(requestConvId).find(m => m.role === 'user');
            addLocalConversation(requestConvId, firstMsg?.content?.slice(0, 30) || '새 대화', activeProjectId);
        }
    };

    return {
        isLoading, responseStartedAt, imageGenProgress, imageGenMessage, lastFailedQuery,
        handleSend, handleRetry, handleStop, streamingMessageId,
        activeConversationIds, hasActiveRequests,
        zipConfirmRequest, resolveZipConfirm,
        codeFolderPath, setCodeFolderPath,
    };
}
