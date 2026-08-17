/**
 * utils/reasoning.ts — 추론(gemma thinking) on/off 상태 관리
 *
 * ES가 아닌 localStorage에 저장한다. 웹앱과 크롬 확장이 각각 독립적으로
 * 동작하도록 하기 위함(공유 서버 설정 대신 클라이언트 로컬 상태).
 */
import { useCallback, useEffect, useState } from 'react';

export const REASONING_STORAGE_KEY = 'vyactReasoningEnabled';
export const REASONING_CHANGED_EVENT = 'vyact:reasoning-changed';

/**
 * 추론 on/off 안내 (물음표 툴팁용).
 * 상태와 무관하게 켜면 좋은 경우/끄면 좋은 경우를 한 번에 보여준다.
 */
export const REASONING_TOOLTIP = {
    title: '추론(Thinking)',
    intro: '답변 전에 모델이 단계적으로 생각하는 기능입니다.',
    on: {
        label: '켜면 좋은 경우',
        items: [
            '복잡한 추론·수학·코딩 질문',
            '뉴스·문서를 선택해 근거를 분석·요약할 때',
            '여러 자료를 비교하거나 논리적 판단이 필요할 때',
        ],
    },
    off: {
        label: '끄면 좋은 경우',
        items: [
            '번역·단순 요약 등 빠른 응답이 중요할 때',
            'PDF 생성처럼 형식이 정해진 작업',
            '짧고 단순한 질의응답',
        ],
    },
} as const;

/** 기본값: 추론 off */
const DEFAULT_REASONING = false;

/** localStorage에서 현재 추론 on/off 값을 읽는다. */
export function getReasoningEnabled(): boolean {
    try {
        const v = localStorage.getItem(REASONING_STORAGE_KEY);
        if (v === null) return DEFAULT_REASONING;
        return v === 'true';
    } catch {
        return DEFAULT_REASONING;
    }
}

/** localStorage에 추론 on/off 값을 저장한다. */
export function setReasoningEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(REASONING_STORAGE_KEY, String(enabled));
    } catch {
        // storage 접근 실패 시 무시 (in-memory 기본값으로 동작)
    }
    window.dispatchEvent(new CustomEvent(REASONING_CHANGED_EVENT, {detail: {enabled}}));
}

/**
 * 추론 on/off 토글 상태 훅.
 * 반환: [enabled, toggle]
 */
export function useReasoning(): [boolean, () => void] {
    const [enabled, setEnabled] = useState<boolean>(getReasoningEnabled);

    // 다른 탭/창(또는 크롬 확장 컨텍스트)에서 값이 바뀌면 동기화
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === REASONING_STORAGE_KEY) {
                setEnabled(getReasoningEnabled());
            }
        };
        const onReasoningChanged = (event: Event) => {
            const nextEnabled = (event as CustomEvent<{enabled?: unknown}>).detail?.enabled;
            setEnabled(typeof nextEnabled === 'boolean' ? nextEnabled : getReasoningEnabled());
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener(REASONING_CHANGED_EVENT, onReasoningChanged);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener(REASONING_CHANGED_EVENT, onReasoningChanged);
        };
    }, []);

    const toggle = useCallback(() => {
        setEnabled(prev => {
            const next = !prev;
            setReasoningEnabled(next);
            return next;
        });
    }, []);

    return [enabled, toggle];
}
