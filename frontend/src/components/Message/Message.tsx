import React, {useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Braces, CircleAlert, RotateCcw} from 'lucide-react';
import 'katex/dist/katex.min.css';
import {escapeHtml, nl2br, unwrapPastedText} from '../../utils/helpers';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import CodeBlock from '../CodeBlock';
import CodeFileViewer from '../CodeFileViewer/CodeFileViewer';
import ImageViewer from '../ImageViewer/ImageViewer';
import ActivityTimeline from './ActivityTimeline';
import InlineToolApproval from './InlineToolApproval';
import CodeChangesCard from './CodeChangesCard';
import {useCodePanel} from '../../contexts/CodePanelContext';
import './Message.css';
import {ttsService} from '../../services/tts/ttsService';
import {getLocalizedSourceLabel} from '../../utils/sourceLabels';
import {
    formatTimestamp,
    groupContentParts,
    linkify,
    MessageProps,
    parseContent,
    parseFollowups,
    renderMarkdown,
    splitStreamSafe
} from "../../utils/markdownUtils.ts";

// 나노초 → "0.42s" 형태로 변환. 값이 없으면 null (해당 항목은 렌더링에서 제외됨)
function formatNs(ns: number | null | undefined): string | null {
    if (ns === null || ns === undefined) return null;
    return `${(ns / 1_000_000_000).toFixed(2)}s`;
}

function formatModelDisplayName(model: string | undefined): string {
    if (!model) return '';
    const normalized = model.replaceAll('\\', '/').replace(/\/$/, '');
    const isLocalPath = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('mlx/');
    return isLocalPath ? normalized.split('/').pop() || model : model;
}

// [라벨, 값] 쌍들을 "라벨 값" 형태로 이어붙인 문자열로 변환. 값이 없는 항목은 건너뜀.
function formatStats(pairs: Array<[string, number | string | null | undefined]>): string {
    return pairs
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([label, v]) => `${label} ${v}`)
        .join(' · ');
}

function stripHiddenMetadata(text: string): string {
    const hiddenTag = '(conv_title|conv_summary|project_summary|project_memory)';
    const completeTags = new RegExp(`<${hiddenTag}\\s*(?:>|=)[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
    const trailingTag = new RegExp(`<${hiddenTag}\\b[\\s\\S]*$`, 'i');
    return text.replace(completeTags, '').replace(trailingTag, '').trimEnd();
}

// ── 스트리밍 중 텍스트 그룹을 단락 단위로 분리 렌더링 ──────────────────
// 완성된 단락(\n\n으로 구분)은 별도 <span>으로 렌더하여 innerHTML이 동일하면
// React가 DOM을 건드리지 않으므로 selection이 유지된다.
// 마지막 단락(아직 스트리밍 중)만 매 토큰마다 re-render.
const FrozenParagraph = React.memo(({html}: { html: string }) => (
    <span dangerouslySetInnerHTML={{__html: html}}/>
), (prev, next) => prev.html === next.html);

const StreamingTextGroup: React.FC<{
    value: string;
    isStreaming: boolean;
    onClick?: (e: React.MouseEvent) => void;
    renderFn: (text: string) => string;
}> = ({value, isStreaming, onClick, renderFn}) => {
    const paragraphs = value.split('\n\n');
    const frozenHtmls = useMemo(
        () => value.split('\n\n').slice(0, -1).map(paragraph => renderFn(paragraph) + '\n'),
        [value, renderFn],
    );

    if (!isStreaming) {
        return <span dangerouslySetInnerHTML={{__html: renderFn(value)}} onClick={onClick}/>;
    }
    // \n\n 기준으로 단락 분리. 마지막 단락만 live, 나머지는 frozen.
    if (paragraphs.length <= 1) {
        return <span dangerouslySetInnerHTML={{__html: renderFn(value)}} onClick={onClick}/>;
    }
    const live = paragraphs[paragraphs.length - 1];
    // frozen 단락의 렌더 결과를 캐싱 — 단락 수가 늘어날 때만 새 항목 추가
    return (
        <span onClick={onClick}>
            {frozenHtmls.map((html, i) => (
                <FrozenParagraph key={i} html={html}/>
            ))}
            <span dangerouslySetInnerHTML={{__html: renderFn(live)}}/>
        </span>
    );
};

const Message: React.FC<MessageProps> = ({
                                             role, content, timestamp, sources, model, attachments,
                                             isError, errorTitle, onRetry, isGeneratedImage, articleSources,
                                             pdfFile, pdfParams, onPdfEdit, injectedContext, onShowInjectedContext, onOpenMemo,
                                             isStreaming = false, conversationId, requestStartedAt, toolStatus, activityLog, stats,
                                             truncated,
                                             codeChanges,
                                         }) => {
    const {t} = useTranslation('main');
    const {panel} = useCodePanel();
    const visibleContent = useMemo(
        () => role === 'assistant' ? stripHiddenMetadata(content) : content,
        [role, content],
    );
    const [pastedViewerId] = useState(() => `message-paste-${Math.random().toString(36).slice(2)}`);
    // 스트리밍 중에는 아직 닫히지 않은 코드/프로젝트 블록을 잘라내고(safe만 렌더),
    // 미완성 블록은 플레이스홀더로 대체한다. 스트림이 끝나면(isStreaming=false)
    // content 전체를 그대로 파싱하므로 완성 렌더와 동일하다.
    const {safe: streamSafeContent, pending: streamPending} = useMemo(
        () => (role === 'assistant' && isStreaming)
            ? splitStreamSafe(visibleContent)
            // 완료 후에는 followups 블록을 본문에서 제거한 뒤 렌더한다
            // (버블 아래 별도 UI로 표시되므로 본문에 노출되면 안 됨)
            : {safe: role === 'assistant' ? parseFollowups(visibleContent).body : visibleContent,
                pending: null as null | 'code' | 'project' | 'table' | 'followups' | 'summary'},
        [role, isStreaming, visibleContent]
    );
    const normalizedContent = streamSafeContent;
    // "프로젝트 생성 중..." 표시에 현재 작성 중인 파일명을 같이 보여주기 위해,
    // 아직 안전 영역엔 없지만(펜딩 중) 실제 버퍼(content)엔 이미 스트리밍된 <file path="..."> 중
    // 가장 마지막(=지금 쓰고 있는) 파일 경로를 뽑는다. 새 파일이 열릴 때마다 자동으로 갱신됨.
    const currentProjectFile = useMemo(() => {
        if (streamPending !== 'project') return null;
        const matches = [...content.matchAll(/<file\s+path="([^"]*)"/gi)];
        return matches.length > 0 ? matches[matches.length - 1][1] : null;
    }, [streamPending, content]);
    const contentParts = useMemo(
        () => role === 'assistant' ? parseContent(normalizedContent) : [],
        [role, normalizedContent]
    );
    const [copied, setCopied] = React.useState(false);
    const [speaking, setSpeaking] = React.useState(false);
    const [requestElapsedSeconds, setRequestElapsedSeconds] = React.useState(0);
    const speakingRef = useRef(false);
    React.useEffect(() => {
        if (!isStreaming) return;
        const startedAt = requestStartedAt ?? Date.now();
        const updateElapsedSeconds = () => {
            setRequestElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        };
        const timerId = window.setInterval(updateElapsedSeconds, 1000);
        return () => window.clearInterval(timerId);
    }, [isStreaming, requestStartedAt]);
    const displayedRequestElapsedSeconds = isStreaming ? requestElapsedSeconds : 0;
    const requestElapsedLabel = displayedRequestElapsedSeconds < 60
        ? t('toolActivity.elapsedShort', {seconds: displayedRequestElapsedSeconds})
        : t('toolActivity.elapsedMinutesSeconds', {
            minutes: Math.floor(displayedRequestElapsedSeconds / 60),
            seconds: displayedRequestElapsedSeconds % 60,
        });
    const [viewerIndex, setViewerIndex] = React.useState<number | null>(null);
    const [tableImgViewer, setTableImgViewer] = React.useState<{
        images: { src: string; alt: string }[];
        index: number
    } | null>(null);

    const imageAttachments = useMemo(
        () => attachments?.filter(a => a.type === 'image') ?? [],
        [attachments]
    );
    const fileAttachments = useMemo(
        () => attachments?.filter(a => a.type !== 'image') ?? [],
        [attachments]
    );
    const savedDocumentAttachments = useMemo(
        () => articleSources?.filter(article => article.url?.startsWith('manual://') || article.url?.startsWith('file://')) ?? [],
        [articleSources]
    );
    const hasUserAttachments = imageAttachments.length > 0 || fileAttachments.length > 0 || savedDocumentAttachments.length > 0;
    const viewerImages = useMemo(
        () => imageAttachments.map(a => ({
            src: `http://localhost:8000/api/images/${a.filename}`,
            alt: a.filename,
        })),
        [imageAttachments]
    );

    const handleCopy = () => {
        const copyText = (text: string) => {
            if (window.ragAPI?.copyToClipboard) {
                window.ragAPI.copyToClipboard(text);
                return;
            }
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).catch(() => fallback(text));
            } else {
                fallback(text);
            }
        };
        const fallback = (text: string) => {
            const el = document.createElement('textarea');
            el.value = text;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.focus();
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        };
        const clipboardContent = role === 'user' ? unwrapPastedText(content) : visibleContent;
        copyText(clipboardContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSpeak = () => {
        if (speakingRef.current) {
            ttsService.stop();
            speakingRef.current = false;
            setSpeaking(false);
        } else {
            // 상태 업데이트 전에 다시 클릭해도 중복 재생 요청이 생기지 않도록 즉시 잠근다.
            speakingRef.current = true;
            ttsService.speak(visibleContent);
            setSpeaking(true);
            const timer = setInterval(() => {
                if (!ttsService.isSpeaking()) {
                    speakingRef.current = false;
                    setSpeaking(false);
                    clearInterval(timer);
                }
            }, 300);
        }
    };

    // user 메시지 붙여넣기 chip 파싱 — «PASTE: 마커 기반
    const userPastedChips = useMemo(() => {
        if (role !== 'user') return null;
        const re = /«PASTE:(.*?)»\n([\s\S]*?)«\/PASTE»/g;
        const chips: Array<{ label: string; content: string }> = [];
        let m;
        while ((m = re.exec(content)) !== null) {
            chips.push({ label: m[1], content: m[2].replaceAll('«\\/PASTE»', '«/PASTE»') });
        }
        return chips.length > 0 ? chips : null;
    }, [role, content]);

    // PASTE 마커로 첨부된 텍스트는 본문에서 제외한다.
    const contentWithoutPaste = useMemo(
        () => userPastedChips ? content.replace(/«PASTE:[\s\S]*?«\/PASTE»/g, '').trim() : content,
        [content, userPastedChips]
    );
    const renderGroups = useMemo(
        () => groupContentParts(contentParts),
        [contentParts]
    );
    const isUserBubbleEmpty = role === 'user'
        && !contentWithoutPaste.trim()
        && !articleSources?.length;
    const errorDetail = isError
        ? content.replace(/^오류\s*:\s*/i, '').replace(/^error\s*:\s*/i, '').trim()
        : '';

    return (
        <div className={`msg ${role === 'user' ? 'user' : 'bot'}`}>
            {/* 붙여넣기 chip — 버블 위에 */}
            {userPastedChips && (
                <div className="msg-pasted-preview-list">
                    {userPastedChips.map((chip, i) => (
                        <div
                            key={i}
                            className={`msg-pasted-preview${panel?.viewerId === `${pastedViewerId}-${i}` ? ' msg-pasted-preview--active' : ''}`}
                        >
                            <div
                                onClick={() => {
                                    const firstLine = chip.content.split('\n').find(l => l.trim()) || '';
                                    const langMap: [string, string][] = [
                                        ['import ', 'tsx'], ['from ', 'tsx'], ['const ', 'tsx'], ['function ', 'tsx'],
                                        ['def ', 'python'], ['class ', 'tsx'], ['public ', 'java'], ['package ', 'java'],
                                        ['#', 'python'], ['<', 'html'],
                                    ];
                                    const lang = langMap.find(([k]) => firstLine.startsWith(k))?.[1] || 'text';
                                    window.dispatchEvent(new CustomEvent('open-code-panel', {
                                        detail: { files: [{ name: chip.label, lang, code: chip.content }], activeIdx: 0, viewerId: `${pastedViewerId}-${i}` }
                                    }));
                                }}
                                className="msg-pasted-preview__content"
                            >
                                <span className="msg-pasted-preview__icon"><Braces size={18}/></span>
                                <div className="msg-pasted-preview__copy">
                                    <span className="msg-pasted-preview__title">{chip.label}</span>
                                    <span className="msg-pasted-preview__meta">{t('message.pastedText')} · {chip.content.length.toLocaleString()}자</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {role === 'user' && hasUserAttachments && (
                <div className="user-attachment-stack">
                    {imageAttachments.length > 0 && (
                        <div className="user-image-gallery">
                            {imageAttachments.map((att, idx) => (
                                <button
                                    key={`${att.filename}-${idx}`}
                                    type="button"
                                    className="user-image-card"
                                    onClick={() => setViewerIndex(idx)}
                                    aria-label={att.filename || `image-${idx + 1}`}
                                >
                                    <img
                                        src={`http://localhost:8000/api/images/${att.filename}`}
                                        alt={att.filename || ''}
                                    />
                                </button>
                            ))}
                        </div>
                    )}
                    {fileAttachments.length > 0 && (
                        <div className="user-file-list">
                            {fileAttachments.map((att, idx) => (
                                <div className="user-file-card" key={`${att.saved_name || att.filename}-${idx}`}>
                                    <span className="user-file-card__icon" aria-hidden="true">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="1.8">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                            <polyline points="14 2 14 8 20 8"/>
                                        </svg>
                                    </span>
                                    <span className="user-file-card__name">
                                        {att.original_name || att.saved_name || att.filename || '파일'}
                                    </span>
                                    {att.type === 'zip' && att.file_count != null && (
                                        <span className="user-file-card__meta">{att.file_count}개</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {savedDocumentAttachments.length > 0 && (
                        <div className="user-file-list">
                            {savedDocumentAttachments.map((article, idx) => (
                                <div className="user-file-card" key={`${article.file_id || article.url}-${idx}`}>
                                    <span className="user-file-card__icon" aria-hidden="true">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="1.8">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                            <polyline points="14 2 14 8 20 8"/>
                                        </svg>
                                    </span>
                                    <span className="user-file-card__name">{article.title}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            <div className={`msg-bubble${isUserBubbleEmpty ? ' msg-bubble--empty' : ''}`}>
                {role === 'user' ? (
                    <>
                        <span
                            className={hasUserAttachments ? 'user-message-text user-message-text--with-attachments' : 'user-message-text'}
                            dangerouslySetInnerHTML={{__html: linkify(nl2br(escapeHtml(contentWithoutPaste)))}}
                        />
                    </>
                ) : isError ? (
                    <div className="message-error-card" role="alert">
                        <span className="message-error-icon" aria-hidden="true"><CircleAlert size={18}/></span>
                        <div className="message-error-copy">
                            <strong>{errorTitle || t('message.requestFailed')}</strong>
                            <span>{errorDetail || t('message.unknownError')}</span>
                        </div>
                        {onRetry && (
                            <button type="button" onClick={onRetry} className="message-retry">
                                <RotateCcw size={14}/>
                                {t('message.retry')}
                            </button>
                        )}
                    </div>
                ) : isGeneratedImage && attachments && attachments.length > 0 ? (
                    <div>
                        {attachments.map((att, idx) => (
                            att.type === 'image' && (
                                <div className="generated-image-item" key={idx}>
                                    <img
                                        src={`http://localhost:8000/api/images/${att.filename}`}
                                        alt={`generated-${idx}`}
                                        onClick={() => setViewerIndex(idx)}
                                        className="generated-image-preview"
                                    />
                                    <button
                                        onClick={async () => {
                                            try {
                                                const res = await fetch(`http://localhost:8000/api/images/${att.filename}`);
                                                const blob = await res.blob();
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = att.filename ?? '';
                                                a.click();
                                                URL.revokeObjectURL(url);
                                            } catch (e) {
                                                console.error('다운로드 실패', e);
                                            }
                                        }}
                                        className="generated-image-download"
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                            <polyline points="7 10 12 15 17 10"/>
                                            <line x1="12" y1="15" x2="12" y2="3"/>
                                        </svg>
                                        다운로드
                                    </button>
                                </div>
                            )
                        ))}
                        <span className="generated-image-caption">🎨 {content}</span>
                    </div>
                ) : (
                    <>
                        {!isGeneratedImage && attachments && attachments.length > 0 && (
                            <div className="message-image-attachments">
                                {attachments.map((att, idx) => (
                                    att.type === 'image' && (
                                        <img key={idx}
                                             src={`http://localhost:8000/api/images/${att.filename}`}
                                             alt={`chart-${idx}`}
                                             onClick={() => setViewerIndex(idx)}
                                             className="message-image-attachment"
                                        />
                                    )
                                ))}
                            </div>
                        )}
                        {/* 첫 토큰 전에는 현재 판정/도구 상태를, 상태 이벤트 전에는 로딩 점을 표시한다. */}
                        {isStreaming && !content.trim() && activityLog?.some(activity => activity.group === 'code' || activity.group === 'tool') ? (
                            <ActivityTimeline
                                activities={activityLog}
                                isStreaming
                                currentStatus={toolStatus}
                                requestElapsedLabel={requestElapsedLabel}
                            />
                        ) : isStreaming && !content.trim() && toolStatus ? (
                            <div className={`msg-tool-status ${toolStatus.phase} ${toolStatus.group ?? 'analysis'}`} aria-live="polite" aria-label={t('toolActivity.ariaLabel')}>
                                {toolStatus.phase === 'completed'
                                    ? <span className="msg-tool-icon completed" aria-hidden="true">✓</span>
                                    : <span className="msg-tool-spinner"/>}
                                <span className="msg-tool-copy">
                                    <span className="msg-tool-text">{toolStatus.label}</span>
                                    {toolStatus.detail && <code className="msg-tool-detail">{toolStatus.detail}</code>}
                                </span>
                                <span className="msg-request-elapsed">{requestElapsedLabel}</span>
                            </div>
                        ) : isStreaming && !content.trim() && (
                            <div className="msg-response-preparing" role="status" aria-live="polite">
                                <span className="msg-tool-spinner" aria-hidden="true"/>
                                <span>{t('toolActivity.preparingResponse')}</span>
                                <span className="msg-request-elapsed">{requestElapsedLabel}</span>
                            </div>
                        )}
                        {isStreaming && !content.trim() && (
                            <InlineToolApproval conversationId={conversationId}/>
                        )}
                        {renderGroups.map((group, idx) => {
                            if (group.type === 'project') {
                                // xml:vyproject 블록 → 다운로드 버튼
                                let projectName = 'my-project';
                                let fileCount = 0;
                                const parseProjectXml = (raw: string) => {
                                    const nameM = raw.match(/<vyproject\s+name=["']([^"']+)["']/i);
                                    const projName = nameM ? nameM[1] : 'my-project';
                                    const files: { path: string; content: string }[] = [];
                                    const trimContent = (c: string) => {
                                        let out = c;
                                        if (out.startsWith('\n')) out = out.slice(1);
                                        if (out.endsWith('\n')) out = out.slice(0, -1);
                                        return out;
                                    };
                                    // 모든 <file path="..."> 여는 태그 위치를 순서대로 수집한다.
                                    // (예전엔 "마지막 파일만" </file> 생략을 허용했는데, LLM이 파일
                                    // 중간에 실수로 </vyproject>를 써서 블록을 조기 종료시키는 경우
                                    // 앞쪽 파일이 안 닫힌 채로 내용이 통째로 사라지는 문제가 있었다.
                                    // 이제는 "어떤 파일이든" </file>이 없으면 바로 다음 <file> 태그
                                    // (또는 블록 끝)에서 암묵적으로 닫힌 것으로 처리한다.)
                                    const openRe = /<file\s+path=["']([^"']+)["']>/gi;
                                    const opens: { path: string; tagStart: number; contentStart: number }[] = [];
                                    let om;
                                    while ((om = openRe.exec(raw)) !== null) {
                                        opens.push({path: om[1], tagStart: om.index, contentStart: om.index + om[0].length});
                                    }
                                    for (let i = 0; i < opens.length; i++) {
                                        const {path, contentStart} = opens[i];
                                        const nextOpenStart = i + 1 < opens.length ? opens[i + 1].tagStart : raw.length;
                                        const segment = raw.slice(contentStart, nextOpenStart);
                                        const closeIdx = segment.search(/<\/file>/i);
                                        let fileContent: string;
                                        if (closeIdx !== -1) {
                                            fileContent = segment.slice(0, closeIdx);
                                        } else {
                                            // </file> 없음 → 다음 <file> 직전(또는 블록 끝)까지를 암묵적
                                            // 내용으로 보고, 남은 </vyproject>/펜스 꼬리는 제거한다.
                                            fileContent = segment.replace(/<\/vyproject>[\s\S]*$/i, '');
                                        }
                                        fileContent = trimContent(fileContent.trimEnd());
                                        if (fileContent) files.push({path, content: fileContent});
                                    }
                                    if (!files.length) return null;
                                    return {project_name: projName, files};
                                };
                                const parsedProject = parseProjectXml(group.value ?? '');
                                if (parsedProject) {
                                    projectName = parsedProject.project_name || projectName;
                                    fileCount = parsedProject.files?.length ?? 0;
                                }
                                const handleProjectDownload = async () => {
                                    try {
                                        const data = parseProjectXml(group.value ?? '');
                                        if (!data) throw new Error('XML 파싱 실패');
                                        const res = await fetch('/api/project/download', {
                                            method: 'POST',
                                            headers: {'Content-Type': 'application/json'},
                                            body: JSON.stringify(data),
                                        });
                                        if (!res.ok) throw new Error('다운로드 실패');
                                        const blob = await res.blob();
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = `${data?.project_name || 'my-project'}.zip`;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                    } catch {
                                        toast.error('프로젝트 다운로드 실패');
                                    }
                                };
                                return (
                                    <div key={idx} style={{
                                        margin: '12px 0',
                                        padding: '14px 18px',
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '10px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '14px',
                                    }}>
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                                             stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round"
                                             strokeLinejoin="round">
                                            <path
                                                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                        </svg>
                                        <div style={{flex: 1}}>
                                            <div style={{fontWeight: 600, fontSize: '14px'}}>{projectName}</div>
                                            <div style={{
                                                fontSize: '12px',
                                                color: 'var(--text-secondary)',
                                                marginTop: '2px'
                                            }}>
                                                {fileCount}개 파일
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleProjectDownload}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                padding: '7px 14px', borderRadius: '7px',
                                                background: 'var(--accent)', color: '#fff',
                                                border: 'none', cursor: 'pointer',
                                                fontSize: '13px', fontWeight: 600,
                                            }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                                                 strokeLinejoin="round">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                <polyline points="7 10 12 15 17 10"/>
                                                <line x1="12" y1="15" x2="12" y2="3"/>
                                            </svg>
                                            ZIP 다운로드
                                        </button>
                                    </div>
                                );
                            } else if (group.type === 'codefiles' && group.files) {
                                return <CodeFileViewer key={idx} files={group.files}/>;
                            } else if (group.type === 'text') {
                                const imgClick = (e: React.MouseEvent) => {
                                    const target = e.target as HTMLElement;
                                    if (target.tagName === 'IMG') {
                                        const container = e.currentTarget as HTMLElement;
                                        const imgs = Array.from(container.querySelectorAll('td img')) as HTMLImageElement[];
                                        const clickedSrc = (target as HTMLImageElement).src;
                                        const index = imgs.findIndex(img => img.src === clickedSrc);
                                        setTableImgViewer({
                                            images: imgs.map(img => ({src: img.src, alt: img.alt || ''})),
                                            index: index >= 0 ? index : 0,
                                        });
                                    }
                                };
                                return (
                                    <StreamingTextGroup
                                        key={idx}
                                        value={group.value ?? ''}
                                        isStreaming={isStreaming && idx === renderGroups.length - 1}
                                        onClick={imgClick}
                                        renderFn={(t) => linkify(renderMarkdown(t))}
                                    />
                                );
                            } else {
                                return <CodeBlock key={idx} code={group.value ?? ''} language={group.lang}/>;
                            }
                        })}
                        {/* 스트리밍 중 아직 닫히지 않은 코드/프로젝트 블록은 플레이스홀더로 표시 */}
                        {isStreaming && streamPending && (
                            <div className="msg-stream-pending">
                                <span className="msg-stream-spinner" aria-hidden="true"/>
                                {streamPending === 'project'
                                    ? <><span>{t('toolActivity.projectGenerating')}</span>{currentProjectFile && <span className="msg-stream-file">{currentProjectFile}</span>}</>
                                    : streamPending === 'table'
                                        ? t('toolActivity.tableGenerating')
                                        : streamPending === 'followups'
                                            ? t('toolActivity.followupsPreparing')
                                            : streamPending === 'summary'
                                                ? t('toolActivity.summaryGenerating')
                                                : t('toolActivity.codeGenerating')}
                            </div>
                        )}
                    </>
                )}
                {role === 'assistant' && !isStreaming && truncated && (
                    <div className="msg-truncation-notice" role="status">
                        {t('message.outputTruncated')}
                    </div>
                )}
            </div>

            {tableImgViewer && (
                <ImageViewer
                    images={tableImgViewer.images}
                    currentIndex={tableImgViewer.index}
                    onClose={() => setTableImgViewer(null)}
                    onIndexChange={(i) => setTableImgViewer(prev => prev ? {...prev, index: i} : null)}
                />
            )}

            {sources && sources.length > 0 && (
                <div className="sources">
                    <div className="sources-lbl">📄 {t('message.sources', {count: sources.length})}</div>
                    {sources.map((src, idx) => (
                        <div key={idx} className="src-item">
                            <span className="src-name">{getLocalizedSourceLabel(src.source, t)}</span>
                            <a href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a>
                            <span className="src-score">{src.score}</span>
                        </div>
                    ))}
                </div>
            )}

            {role !== 'user' && articleSources && articleSources.length > 0 && (() => {
                // 일반 메모와 빠른 메모를 RAG 메모 소스로 함께 표시한다.
                const memoSources = articleSources.filter(a =>
                    a.url?.startsWith('memo://') || a.url?.startsWith('quicknote://')
                );
                if (memoSources.length > 0) {
                    return (
                        <div className="sources" style={{borderColor: 'rgba(255,160,80,0.25)'}}>
                            <div className="sources-lbl" style={{color: 'rgba(255,160,80,0.9)'}}>📝 {t('message.memoSources', {count: memoSources.length})}
                            </div>
                            {memoSources.map((art, idx) => {
                                const isQuicknote = art.url?.startsWith('quicknote://');
                                const memoId = art.url?.replace('memo://', '').split('::')[0];
                                return (
                                    <div key={idx} className="src-item"
                                         style={{cursor: !isQuicknote && onOpenMemo ? 'pointer' : 'default'}}
                                         onClick={() => !isQuicknote && memoId && onOpenMemo?.(memoId)}
                                    >
                                        <span className="src-name" style={{color: 'rgba(255,160,80,0.8)'}}>
                                            {isQuicknote ? t('inputMenu.quickMemo') : t('message.memo')}
                                        </span>
                                        {art.indexed_at && (
                                            <span className="src-date">{(() => {
                                                const d = new Date(art.indexed_at);
                                                return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
                                            })()}</span>
                                        )}
                                        <span style={{color: 'rgba(255,160,80,0.9)'}}>{art.title}</span>
                                    </div>
                                );
                            })}
                        </div>
                    );
                }
                return null;
            })()}

            {role !== 'user' && articleSources && articleSources.length > 0 && (() => {
                // 뉴스/기사(http/https)만 참고 표시 — 문서(file://, manual://)는 제외
                const newsSources = articleSources.filter(a =>
                    a.url && (a.url.startsWith('http://') || a.url.startsWith('https://'))
                );
                if (newsSources.length === 0) return null;
                return (
                    <div className="sources">
                        <div className="sources-lbl">📰 {t('message.sources', {count: newsSources.length})}</div>
                        {newsSources.map((art, idx) => (
                            <div key={idx} className="src-item">
                                <span className="src-name">{getLocalizedSourceLabel(art.source, t)}</span>
                                {art.application_deadline ? (
                                    <span className="src-date src-deadline" data-tooltip={art.application_deadline}>
                                        <span className="src-deadline-text">
                                            {t('message.applicationDeadline')} {art.application_deadline}
                                        </span>
                                    </span>
                                ) : art.source !== 'Government24' && art.indexed_at && (
                                    <span className="src-date">{(() => {
                                        const d = new Date(art.indexed_at);
                                        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
                                    })()}</span>
                                )}
                                <a href={art.url} target="_blank" rel="noopener noreferrer">{art.title}</a>
                            </div>
                        ))}
                    </div>
                );
            })()}

            {role === 'assistant' && injectedContext && injectedContext.length > 0 && (() => {
                const injectedItems = injectedContext.filter(item => item.context_origin !== 'external_data');
                const externalItems = injectedContext.filter(item => item.context_origin === 'external_data');
                const externalItemsWithSourceLinks = externalItems.map(item => {
                    const matchingArticle = articleSources?.find(article =>
                        article.title?.trim() === item.title?.trim()
                        && (!item.source || !article.source || article.source === item.source),
                    );
                    if (!matchingArticle?.url || item.external_document?.url) return item;
                    return {
                        ...item,
                        external_document: {
                            ...item.external_document,
                            url: matchingArticle.url,
                        },
                    };
                });
                return <div className="message-context-actions">
                    {injectedItems.length > 0 && <button
                        className="message-context-action"
                        onClick={() => onShowInjectedContext?.(injectedItems, 'injected')}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        {t('message.injectedData', {count: injectedItems.length})}
                    </button>}
                    {externalItems.length > 0 && <button
                        className="message-context-action message-context-action--external"
                        onClick={() => onShowInjectedContext?.(externalItemsWithSourceLinks, 'external')}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>
                        </svg>
                        {t('message.externalData', {count: externalItems.length})}
                    </button>}
                </div>;
            })()}

            {pdfFile && (
                <div className="message-export-file">
                    <div className="message-export-file-info">
                        <div className="message-export-file-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                            </svg>
                        </div>
                        <div>
                            <div className="message-export-file-title">
                                {t('pdfModal.fileReady', {
                                    format: pdfParams?.output_format?.toUpperCase() || (pdfFile.toLowerCase().endsWith('.pptx') ? 'PPTX' : 'PDF'),
                                })}
                            </div>
                            <div className="message-export-file-name">{pdfFile}</div>
                        </div>
                    </div>
                    <div className="message-export-file-actions">
                        {pdfParams && onPdfEdit && (
                            <button
                                onClick={() => onPdfEdit(pdfParams)}
                                className="message-export-edit"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     strokeWidth="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                                {t('pdfModal.edit')}
                            </button>
                        )}
                        <button
                            onClick={async () => {
                                try {
                                    const res = await fetch(`/api/pdf/download/${pdfFile}`);
                                    const blob = await res.blob();
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = pdfFile;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                } catch (e) {
                                    console.error('PDF 다운로드 실패', e);
                                }
                            }}
                            className="message-export-download"
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2.5">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            {t('pdfModal.download')}
                        </button>
                    </div>
                </div>
            )}

            {role === 'assistant' && !isStreaming && codeChanges?.files.length ? (
                <CodeChangesCard changes={codeChanges}/>
            ) : null}

            {/* 스트리밍 첫 토큰 전(빈 버블)에는 시간/복사 메타를 숨긴다 — ...만 표시 */}
            {!(isStreaming && role === 'assistant') && (
                <div className={`msg-meta ${role === 'user' ? 'user' : 'bot'}`}>
                    {role === 'user' ? (
                        <>
                            <button className="msg-copy-btn" onClick={handleCopy} aria-label={copied ? '복사됨' : '복사'}>
                                {copied ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                         strokeWidth="2">
                                        <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                         strokeWidth="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                    </svg>
                                )}
                            </button>
                            <span className="msg-time">{formatTimestamp(timestamp)}{model && ` · ${formatModelDisplayName(model)}`}</span>
                        </>
                    ) : (
                        <>
                            <span className="msg-time">{formatTimestamp(timestamp)}{model && ` · ${formatModelDisplayName(model)}`}</span>
                            <button className="msg-copy-btn" onClick={handleCopy} aria-label={copied ? '복사됨' : '복사'}>
                                {copied ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                         strokeWidth="2">
                                        <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                         strokeWidth="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                    </svg>
                                )}
                            </button>
                            {ttsService.isSupported() && (
                                <button
                                    className={`msg-copy-btn${speaking ? ' msg-speak-btn--active' : ''}`}
                                    onClick={handleSpeak}
                                    aria-label={speaking ? '읽기 중지' : '소리로 읽기'}
                                >
                                    {speaking ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                             strokeWidth="2">
                                            <rect x="6" y="4" width="4" height="16"/>
                                            <rect x="14" y="4" width="4" height="16"/>
                                        </svg>
                                    ) : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                             strokeWidth="2">
                                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                                        </svg>
                                    )}
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* 토큰수/처리시간 통계 — provider가 제공할 때 표시. user 버블엔 입력(prompt) 쪽,
                assistant 버블엔 생성(eval)+전체 소요시간 쪽을 보여준다. */}
            {!(isStreaming && role === 'assistant') && stats && (() => {
                if (role === 'user') {
                    const line = formatStats([
                        [t('message.inputTokens'), stats.prompt_eval_count],
                        [t('message.inputProcessing'), formatNs(stats.prompt_eval_duration)],
                    ]);
                    if (!line) return null;
                    return <div className={`msg-stats user`}>{line}</div>;
                }
                // assistant: 모델 응답 생성 통계. tool 통계는 바로 아래 활동 요약에서 제공한다.
                const llmTotal = stats.llm_total_duration || stats.total_duration;

                const line1 = formatStats([
                    [t('message.outputTokens'), stats.eval_count],
                    [t('message.modelLoading'), formatNs(stats.load_duration)],
                    [t('message.generationTime'), formatNs(stats.eval_duration)],
                    [t('message.llmTotal'), formatNs(llmTotal)],
                ]);
                return line1 ? <div className="msg-stats bot">{line1}</div> : null;
            })()}

            {role === 'assistant' && !isStreaming && activityLog?.length ? (
                <ActivityTimeline
                    activities={activityLog}
                    executionDurationNs={stats?.tool_duration}
                />
            ) : null}

            {viewerIndex !== null && viewerImages.length > 0 && (
                <ImageViewer
                    images={viewerImages}
                    currentIndex={viewerIndex}
                    onClose={() => setViewerIndex(null)}
                    onIndexChange={setViewerIndex}
                />
            )}
        </div>
    );
};

export default React.memo(Message);
