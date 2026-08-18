import { ApiError } from './apiError';

// streamClient.ts – 백엔드 토큰 SSE 엔드포인트 파서
//
// 서버는 event: token|meta|done|error 형식의 SSE 프레임을 흘려보낸다.
// 이 헬퍼는 fetch 스트림을 읽어 이벤트별 콜백으로 분배한다.
// (EventSource는 GET/커스텀헤더 제약이 있어 POST body가 필요한 이 API엔 fetch 스트림을 쓴다.)

export interface StreamHandlers {
    onMeta?: (data: { model?: string; sources?: any[] }) => void;
    onToken?: (text: string) => void;
    /** 판정 스트림이 서두를 relay한 뒤 tool 호출로 전환된 케이스 — 표시 중인 답변 초기화 */
    onReset?: () => void;
    onTool?: (data: { phase?: string; name?: string; args?: Record<string, unknown>; round?: number; result?: string; approval_id?: string; risk?: string; conversation_id?: string; project_id?: string }) => void;
    onIndexProgress?: (data: { source_name?: string; done?: number; total?: number }) => void;
    onDone?: (data: { conv_id?: string; answer?: string; stats?: Record<string, number | null>; truncated?: boolean; code_changes?: import('../types').CodeChanges; conversation_title?: string }) => void;
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
            detail = body?.detail || body?.message || '';
        } catch {
            // JSON이 아닌 응답 — 무시하고 상태 코드만 사용
        }
        const prefix = res.status >= 500 ? '서버 오류' : '요청 실패';
        throw new ApiError(`${prefix} (${res.status}): ${detail || res.statusText || '스트리밍 요청 실패'}`, res.status, detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // SSE 프레임은 빈 줄(\n\n)로 구분된다. 프레임 하나를 event/data로 파싱.
    const dispatchFrame = (frame: string): string => {
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) {
                event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
            }
        }
        if (!dataLines.length) return event;
        let payload: any;
        try {
            payload = JSON.parse(dataLines.join('\n'));
        } catch {
            return event;
        }
        switch (event) {
            case 'meta':  handlers.onMeta?.(payload); break;
            case 'token': if (payload.text) handlers.onToken?.(payload.text); break;
            case 'reset': handlers.onReset?.(); break;
            case 'tool':  handlers.onTool?.(payload); break;
            case 'index_progress': handlers.onIndexProgress?.(payload); break;
            case 'done':  handlers.onDone?.(payload); break;
            case 'error': handlers.onError?.(payload); break;
        }
        return event;
    };

    const waitForPaint = () => new Promise<void>(resolve => {
        requestAnimationFrame(() => resolve());
    });

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx: number;
        // 완성된 프레임(\n\n 경계)만 처리하고 나머지는 버퍼에 남긴다.
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            if (frame.trim()) {
                const event = dispatchFrame(frame);
                // 한 네트워크 청크에 여러 token 프레임이 함께 도착하면 React가 상태
                // 업데이트를 한 번에 배치한다. 다음 token도 이미 버퍼에 있을 때만 한
                // 프레임 양보하여 실제 스트리밍이 화면에 점진적으로 보이게 한다.
                if (event === 'token' && buffer.includes('\n\n')) await waitForPaint();
            }
        }
    }
    // 마지막 잔여 프레임 처리
    if (buffer.trim()) dispatchFrame(buffer);
}
