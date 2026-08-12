import {useEffect, useRef} from 'react';
import type {HTMLAttributes, ReactNode} from 'react';
import {getTopmostModalOverlay} from './modalStack';
import './ModalOverlay.css';

interface ModalOverlayProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
    onClose?: () => void;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    dimOpacity?: number;
    blur?: number;
}

/**
 * 앱 전체 모달의 공통 배경 레이어.
 * 개별 모달은 className과 일반 div 속성으로 크기, z-index, drag 동작 등을 확장한다.
 */
const ModalOverlay = ({
    children,
    className = '',
    onClose,
    closeOnBackdrop = false,
    closeOnEscape = true,
    dimOpacity = 0.6,
    blur = 0,
    onClick,
    style,
    ...props
}: ModalOverlayProps) => {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!onClose || !closeOnEscape) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (getTopmostModalOverlay() !== overlayRef.current) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            onClose();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closeOnEscape, onClose]);

    const handleClick: HTMLAttributes<HTMLDivElement>['onClick'] = (event) => {
        onClick?.(event);
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
    };

    return (
        <div
            ref={overlayRef}
            {...props}
            className={`app-modal-overlay ${className}`.trim()}
            role="dialog"
            aria-modal="true"
            onClick={handleClick}
            onDragEnter={event => event.stopPropagation()}
            onDragOver={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
            onDragLeave={event => event.stopPropagation()}
            onDrop={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
            style={{...style, background: `rgba(0, 0, 0, ${dimOpacity})`, backdropFilter: blur ? `blur(${blur}px)` : 'none'}}
        >
            {children}
        </div>
    );
};

export default ModalOverlay;
