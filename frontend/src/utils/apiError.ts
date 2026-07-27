// utils/apiError.ts – 백엔드 호출 실패를 일관된 형태로 표현하는 공용 에러 타입
//
// 지금까지 api.ts 여기저기서 `throw new Error(err.detail || '실패')`처럼 각자 다르게
// 처리하고 있어서, 화면에서 "이게 400(입력 문제)인지 500(서버 문제)인지" 구분할 방법이
// 없었다. ApiError는 상태 코드를 함께 들고 다녀서 호출부가 필요하면 구분해서 보여줄 수 있게 한다.

export class ApiError extends Error {
    /** HTTP 상태 코드 (네트워크 자체가 끊긴 경우 등 응답이 없으면 undefined) */
    status?: number;
    /** 서버가 내려준 원본 상세 메시지 (JSON body의 detail/message 등) */
    detail?: string;

    constructor(message: string, status?: number, detail?: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.detail = detail;
    }

    /** 4xx — 요청 자체(입력값 등)가 잘못된 경우 */
    get isClientError(): boolean {
        return this.status !== undefined && this.status >= 400 && this.status < 500;
    }

    /** 5xx — 서버 쪽 문제(모델 다운, 내부 오류 등) */
    get isServerError(): boolean {
        return this.status !== undefined && this.status >= 500;
    }
}

/**
 * fetch Response에서 에러 상세를 최대한 뽑아낸다.
 * JSON body의 detail(FastAPI 표준) 또는 message 필드를 우선 사용하고,
 * JSON 파싱이 안 되면 상태 텍스트로 폴백한다.
 */
async function readErrorDetail(res: Response): Promise<string> {
    try {
        const body = await res.clone().json();
        if (typeof body?.detail === 'string') return body.detail;
        if (typeof body?.message === 'string') return body.message;
    } catch {
        // JSON이 아닌 응답(HTML 에러 페이지 등) — 무시하고 아래 폴백 사용
    }
    return res.statusText || `HTTP ${res.status}`;
}

/**
 * res.ok가 아니면 상태 코드+상세 메시지를 담은 ApiError를 던진다.
 * 정상이면 아무것도 하지 않고 그냥 반환(체이닝용).
 *
 * 사용 예:
 *   const res = await fetch(url, opts);
 *   await assertOk(res, '서버 등록 실패');
 *   return res.json();
 */
export async function assertOk(res: Response, fallbackMessage = '요청 실패'): Promise<Response> {
    if (res.ok) return res;
    const detail = await readErrorDetail(res);
    const prefix = res.status >= 500 ? '서버 오류' : '요청 실패';
    throw new ApiError(`${prefix} (${res.status}): ${detail || fallbackMessage}`, res.status, detail);
}

/**
 * 사용자에게 보여줄 한 줄 메시지로 변환. ApiError면 4xx/5xx를 구분한 안내를 붙이고,
 * 그 외(네트워크 끊김, 코드 예외 등)는 일반 메시지로 폴백한다.
 */
export function formatApiErrorForUser(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.isClientError) {
            return `요청 오류 (${error.status}): ${error.detail || error.message}`;
        }
        if (error.isServerError) {
            return `서버 오류 (${error.status}): ${error.detail || error.message} — 잠시 후 다시 시도해주세요.`;
        }
        return error.message;
    }
    if (error instanceof Error) return `오류: ${error.message}`;
    return `오류: ${String(error)}`;
}