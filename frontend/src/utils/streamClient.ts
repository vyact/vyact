import { ApiError, translateBackendError } from './apiError';
import i18n from '../i18n';

const PAINT_FALLBACK_MS = 50;

// streamClient.ts – 백엔드 토큰 SSE 엔드포인트 파서
//
// 서버는 event: token|meta|done|error 형식의 SSE 프레임을 흘려보낸다.
// 이 헬퍼는 fetch 스트림을 읽어 이벤트별 콜백으로 분배한다.
// (EventSource는 GET/커스텀헤더 제약이 있어 POST body가 필요한 이 API엔 fetch 스트림을 쓴다.)

export interface StreamHandlers {
    onQueue?: (data: {waiting: boolean}) => void;
    onMeta?: (data: { model?: string; sources?: any[] }) => void;
    onToken?: (text: string) => void;
    /** 판정 스트림이 서두를 relay한 뒤 tool 호출로 전환된 케이스 — 표시 중인 답변 초기화 */
    onReset?: (data: {content?: string}) => void;
    onTool?: (data: { phase?: string; name?: string; args?: Record<string, unknown>; round?: number; result?: string; approval_id?: string; risk?: string; conversation_id?: string; project_id?: string }) => void;
    onIndexProgress?: (data: { source_name?: string; done?: number; total?: number }) => void;
    onDone?: (data: { conv_id?: string; answer?: string; stats?: Record<string, number | null>; truncated?: boolean; code_changes?: import('../types').CodeChanges; memory_updates?: import('../types').MemoryUpdate[]; conversation_title?: string }) => void;
    onError?: (error: { code?: string; model?: string; message?: string }) => void;
}

export async function streamSSE(
    url: string,
    body: any,
    handlers: StreamHandlers,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok || !res.body) {
        let detail = '';
        try {
            const body = await res.clone().json();
            detail = body?.code
                ? translateBackendError(body.code, body.params)
                : body?.detail || body?.message || '';
        } catch {
            // JSON이 아닌 응답 — 무시하고 상태 코드만 사용
        }
        const prefix = i18n.t(res.status >= 500 ? 'main:networkError.serverError' : 'main:networkError.requestFailed');
        const fallback = i18n.t('main:networkError.streamFailed');
        throw new ApiError(`${prefix} (${res.status}): ${detail || res.statusText || fallback}`, res.status, detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // SSE 프레임은 빈 줄(\n\n)로 구분된다. 프레임 하나를 event/data로 파싱.
    const dispatchFrame = (frame: string): string | null => {
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) {
                event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
            }
        }
        if (!dataLines.length) return null;
        let payload: any;
        try {
            payload = JSON.parse(dataLines.join('\n'));
        } catch {
            return null;
        }
        switch (event) {
            case 'queue': handlers.onQueue?.(payload); break;
            case 'meta':  handlers.onMeta?.(payload); break;
            case 'token': if (payload.text) handlers.onToken?.(payload.text); break;
            case 'reset': handlers.onReset?.(payload); break;
            case 'tool':  handlers.onTool?.(payload); break;
            case 'index_progress': handlers.onIndexProgress?.(payload); break;
            case 'done':  handlers.onDone?.(payload); break;
            case 'error': handlers.onError?.({
                ...payload,
                model: payload.model || payload.params?.model,
                message: payload.message || translateBackendError(payload.code, payload.params),
            }); break;
        }
        return event;
    };

    const waitForPaint = () => new Promise<void>((resolve, reject) => {
        signal?.throwIfAborted();
        const cleanup = () => {
            cancelAnimationFrame(frameId);
            clearTimeout(timeoutId);
            signal?.removeEventListener('abort', onAbort);
        };
        const finish = () => { cleanup(); resolve(); };
        const onAbort = () => { cleanup(); reject(signal?.reason); };
        const frameId = requestAnimationFrame(finish);
        // Hidden windows may stop painting; network processing must still continue.
        const timeoutId = setTimeout(finish, PAINT_FALLBACK_MS);
        signal?.addEventListener('abort', onAbort, {once: true});
    });

    try {
        while (true) {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            signal?.throwIfAborted();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let sepIdx: number;
            // Process complete frames, retaining partial frames for the next chunk.
            while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
                signal?.throwIfAborted();
                const frame = buffer.slice(0, sepIdx);
                buffer = buffer.slice(sepIdx + 2);
                if (frame.trim()) {
                    const event = dispatchFrame(frame);
                    if (event === 'done' || event === 'error') return;
                    // Let React paint between tokens delivered in the same chunk.
                    if (event === 'token' && buffer.includes('\n\n')) await waitForPaint();
                }
            }
        }
        buffer += decoder.decode();
        // Preserve support for a final event without a trailing blank line.
        const finalEvent = buffer.trim() ? dispatchFrame(buffer) : null;
        if (finalEvent !== 'done' && finalEvent !== 'error') {
            throw new ApiError(i18n.t('main:networkError.streamFailed'));
        }
    } finally {
        // Cleanup must not replace the original network/cancellation error.
        try { await reader.cancel(); } catch { /* The stream may already be errored. */ }
        reader.releaseLock();
    }
}
