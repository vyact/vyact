import {updateGoogleWorkspaceConnectionStatus} from '../services/googleWorkspaceStatus';
import type {McpServer} from '../types';

// MCP 서버 상태 변경을 앱 전역에 알리는 이벤트 유틸.
// 설정 모달(McpServersSection)과 입력창 배지(McpMenu)처럼 서로 떨어진
// 컴포넌트가 같은 MCP 상태를 공유하므로, 변경 시 이벤트로 동기화한다.
//
// 변경된 서버 목록(servers)을 이벤트에 실어 보낸다. 이렇게 하면 수신 측이
// API를 다시 호출할 필요가 없어, 백엔드 반영 타이밍과 무관하게 항상 최신
// 상태로 갱신된다. (servers 없이 호출되면 수신 측이 스스로 재조회)

const MCP_CHANGED_EVENT = 'vyact:mcp-servers-changed';
const GOOGLE_WORKSPACE_STATUS_CHANGED_EVENT = 'vyact:google-workspace-status-changed';

/**
 * MCP 서버가 추가/삭제/토글/수정되었을 때 호출.
 * @param servers 변경 후의 전체 서버 목록. 있으면 수신 측이 그대로 사용한다.
 */
export function emitMcpServersChanged(servers?: McpServer[]): void {
    window.dispatchEvent(new CustomEvent(MCP_CHANGED_EVENT, {detail: {servers}}));
}

/**
 * MCP 변경 이벤트 구독. cleanup 함수를 반환한다.
 * @param handler 변경 후 서버 목록(있으면)을 인자로 받는다. 없으면 undefined.
 */
export function onMcpServersChanged(handler: (servers?: McpServer[]) => void): () => void {
    const listener = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        handler(detail?.servers);
    };
    window.addEventListener(MCP_CHANGED_EVENT, listener);
    return () => window.removeEventListener(MCP_CHANGED_EVENT, listener);
}

/** Google OAuth 연결 또는 해제 후 Workspace 메뉴 상태를 즉시 갱신한다. */
export function emitGoogleWorkspaceStatusChanged(connected?: boolean): void {
    const status = connected === undefined
        ? undefined
        : updateGoogleWorkspaceConnectionStatus(connected);
    window.dispatchEvent(new CustomEvent(GOOGLE_WORKSPACE_STATUS_CHANGED_EVENT, {
        detail: {status},
    }));
}

/** Google OAuth 연결 상태 변경 이벤트를 구독한다. */
export function onGoogleWorkspaceStatusChanged(handler: () => void): () => void {
    window.addEventListener(GOOGLE_WORKSPACE_STATUS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(GOOGLE_WORKSPACE_STATUS_CHANGED_EVENT, handler);
}
