import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import './PanelResizer.css';

const STORAGE_KEY = 'vyact-panel-width';
const DEFAULT_WIDTH = 48;   // %
const MIN_WIDTH = 20;       // %
const MAX_WIDTH = 70;       // %

/** 패널(코드뷰/유튜브) 너비를 localStorage에 저장·복원한다. */
export function getSavedPanelWidth(): number {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v) {
            const n = parseFloat(v);
            if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
        }
    } catch { /* ignore */
    }
    return DEFAULT_WIDTH;
}

export function savePanelWidth(pct: number) {
    try {
        localStorage.setItem(STORAGE_KEY, String(pct));
    } catch { /* ignore */
    }
}

export function resetPanelWidth() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */
    }
    return DEFAULT_WIDTH;
}

interface Props {
    onWidthChange: (pct: number) => void;
    /**
     * 패널별 너비 계산이 필요한 경우 사용한다.
     * 기본 동작은 사이드 패널과 호환되는 비율(%) 계산이다.
     */
    getWidth?: (event: MouseEvent, resizer: HTMLDivElement) => number;
    onReset?: () => void;
    className?: string;
    title?: string;
}

const PanelResizer: React.FC<Props> = ({onWidthChange, getWidth, onReset, className = '', title}) => {
    const {t} = useTranslation('main');
    const dragging = useRef(false);
    const [active, setActive] = useState(false);

    const overlayRef = useRef<HTMLDivElement | null>(null);
    const resizerRef = useRef<HTMLDivElement | null>(null);

    const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();

        dragging.current = true;
        setActive(true);

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const rect = e.currentTarget.getBoundingClientRect();

        // 리사이저 오른쪽 영역만 덮음
        const overlay = document.createElement('div');

        overlay.style.cssText = `
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        left: ${rect.right}px;
        z-index: 99999;
        cursor: col-resize;
    `;

        document.body.appendChild(overlay);
        overlayRef.current = overlay;
    }, []);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragging.current) return;
            if (getWidth && resizerRef.current) {
                onWidthChange(getWidth(e, resizerRef.current));
                return;
            }
            const wrap = document.querySelector('.chat-area-wrap') as HTMLElement;
            if (!wrap) return;
            const rect = wrap.getBoundingClientRect();
            const rightPct = ((rect.right - e.clientX) / rect.width) * 100;
            const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, rightPct));
            onWidthChange(clamped);
        };
        const onUp = () => {
            if (!dragging.current) return;
            dragging.current = false;
            setActive(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            overlayRef.current?.remove();
            overlayRef.current = null;
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [getWidth, onWidthChange]);

    const onDoubleClick = useCallback(() => {
        if (onReset) {
            onReset();
            return;
        }
        if (getWidth) return;
        const def = resetPanelWidth();
        onWidthChange(def);
    }, [getWidth, onReset, onWidthChange]);

    return (
        <div
            ref={resizerRef}
            className={`panel-resizer${active ? ' panel-resizer--active' : ''}${className ? ` ${className}` : ''}`}
            onMouseDown={onMouseDown}
            onDoubleClick={onDoubleClick}
            aria-label={title || t('panelResizer.label')}
        >
            <div className="panel-resizer-line"/>
            <div className="panel-resizer-handle" aria-hidden="true"/>
            <div className="panel-resizer-hint" aria-hidden="true">
                <strong>{t('panelResizer.drag')}</strong>
                <span>{t('panelResizer.reset')}</span>
            </div>
        </div>
    );
};

export default PanelResizer;
