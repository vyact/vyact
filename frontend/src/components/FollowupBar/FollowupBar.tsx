import React, { useState, useMemo, useEffect } from 'react';
import {useTranslation} from 'react-i18next';
import './FollowupBar.css';

interface FollowupBarProps {
    followups: string[];
    // 최종 전송 — 선택 항목 + (있으면) 직접 입력을 합쳐 하나의 메시지로 전달
    onSubmit: (message: string) => void;
    onDismiss?: () => void;  // 닫기(이 응답의 follow-ups 숨김)
    disabled?: boolean;
    /** 부모가 현재 composed 값을 읽을 수 있도록 ref 연결 */
    composedRef?: React.MutableRefObject<string>;
}

/**
 * 마지막 assistant 응답의 후속 질문(follow-ups)을 ChatInput 위에 표시.
 * - 각 항목 토글 선택(다중 선택 가능)
 * - 하단 자유 입력창 1개 고정("또는 직접 답장…")
 * - 선택 항목들 + 직접 입력을 합쳐 한 번에 전송
 */
const FollowupBar: React.FC<FollowupBarProps> = ({ followups, onSubmit, onDismiss, disabled = false, composedRef }) => {
    const {t} = useTranslation('main');
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [customText, setCustomText] = useState('');

    const toggle = (idx: number) => {
        if (disabled) return;
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(idx)) {
                next.delete(idx);
            } else {
                next.add(idx);
            }
            return next;
        });
    };

    const composed = useMemo(() => {
        const picked = followups.filter((_, i) => selected.has(i));
        const parts = [...picked];
        const t = customText.trim();
        if (t) parts.push(t);
        return parts.join('\n');
    }, [followups, selected, customText]);

    // composed 값을 부모 ref에 동기화
    useEffect(() => {
        if (composedRef) composedRef.current = composed;
    }, [composed, composedRef]);

    // ESC 키: 입력 중이면 입력 먼저 비우고, 비어있으면 닫기 (x 버튼과 동일)
    useEffect(() => {
        if (!onDismiss) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            if (customText.trim()) {
                setCustomText('');
            } else {
                onDismiss();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onDismiss, customText]);

    const canSend = composed.trim().length > 0 && !disabled;

    const clearComposition = () => {
        // 전송으로 인해 FollowupBar가 즉시 언마운트될 수 있으므로,
        // effect에만 맡기지 않고 부모 ref도 동기적으로 비운다.
        if (composedRef) composedRef.current = '';
        setSelected(new Set());
        setCustomText('');
    };

    const submit = () => {
        if (!canSend) return;
        const message = composed.trim();
        clearComposition();
        onSubmit(message);
    };

    // 단일 항목 즉시 전송(화살표) — 그 항목만 보내고 나머지 선택 무시
    const sendSingle = (idx: number) => {
        if (disabled) return;
        const message = followups[idx];
        clearComposition();
        onSubmit(message);
    };

    const onCustomKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    if (!followups || followups.length === 0) return null;
    const multiSelected = selected.size >= 1;

    return (
        <div className="followup-bar">
            <div className="followup-head">
                <span className="followup-title">{t('message.followupTitle')}</span>
                <div className="followup-head-right">
                    {multiSelected && (
                        <button
                            className="followup-send-selected"
                            onClick={submit}
                            disabled={!canSend}
                        >
                            {t('message.followupSendSelected', {count: selected.size})}
                        </button>
                    )}
                    {onDismiss && (
                        <button
                            className="followup-close"
                            onClick={() => {
                                if (composedRef) composedRef.current = '';
                                onDismiss();
                            }}
                            aria-label={t('message.followupClose')}
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            <div className="followup-list">
                {followups.map((q, i) => {
                    const on = selected.has(i);
                    return (
                        <div
                            key={i}
                            className={`followup-item${on ? ' selected' : ''}`}
                            onClick={() => toggle(i)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') toggle(i); }}
                        >
                            <span className="followup-check" aria-hidden>
                                {on ? '✓' : ''}
                            </span>
                            <span className="followup-text">{q}</span>
                            <button
                                className="followup-go"
                                onClick={(e) => { e.stopPropagation(); sendSingle(i); }}
                                aria-label={t('message.followupSendSingle')}
                            >
                                →
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="followup-custom">
                <input
                    type="text"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    onKeyDown={onCustomKeyDown}
                    placeholder={t('message.followupCustomPlaceholder')}
                    disabled={disabled}
                />
                {customText.trim() && (
                    <button className="followup-custom-send" onClick={submit} disabled={!canSend}>
                        전송
                    </button>
                )}
            </div>
        </div>
    );
};

export default FollowupBar;
