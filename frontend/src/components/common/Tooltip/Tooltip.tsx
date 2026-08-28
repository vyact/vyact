import {cloneElement, isValidElement, ReactElement, ReactNode, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import './Tooltip.css';

type TooltipSize = 'small' | 'medium';
type TooltipProps = {content: ReactNode; multiline?: boolean; size?: TooltipSize; children: ReactElement};
const tooltipContentRegistry = new Map<string, ReactNode>();

export function Tooltip({content, multiline, size = 'small', children}: TooltipProps) {
    const tooltipId = useId();
    useEffect(() => {
        tooltipContentRegistry.set(tooltipId, content);
        return () => { tooltipContentRegistry.delete(tooltipId); };
    }, [content, tooltipId]);
    if (!isValidElement(children)) return children;
    return cloneElement(children, {
        'data-instant-tooltip': typeof content === 'string' ? content : '',
        'data-instant-tooltip-id': tooltipId,
        ...(multiline ? {'data-instant-tooltip-multiline': ''} : {}),
        'data-instant-tooltip-size': size,
        title: undefined,
    } as never);
}

type TooltipState = {content: ReactNode; x: number; y: number; targetTop: number; targetBottom: number; placement: 'above' | 'below'; multiline: boolean; size: TooltipSize} | null;

const getTooltipTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element) || target.closest('[data-tooltip-disabled]')) return null;
    return target.closest<HTMLElement>('[data-instant-tooltip], [title], [data-vyact-tooltip-title]');
};

export function TooltipProvider({children}: {children: ReactNode}) {
    const [tooltip, setTooltip] = useState<TooltipState>(null);
    const activeTargetRef = useRef<HTMLElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);

    // Initially anchor to the trigger itself, then correct only when the rendered
    // tooltip would leave the viewport. Using a fixed maximum width here shifts
    // short tooltips too far from their trigger in narrow or zoomed windows.
    useLayoutEffect(() => {
        if (!tooltip || !tooltipRef.current) return;

        const rect = tooltipRef.current.getBoundingClientRect();
        const viewportMargin = 12;
        const horizontalOffset = rect.right > window.innerWidth - viewportMargin
            ? window.innerWidth - viewportMargin - rect.right
            : rect.left < viewportMargin
                ? viewportMargin - rect.left
                : 0;

        const placement = tooltip.placement === 'above' && rect.top < viewportMargin ? 'below' : tooltip.placement;
        if (horizontalOffset || placement !== tooltip.placement) {
            setTooltip(current => current && current.x === tooltip.x
                ? {...current, x: current.x + horizontalOffset, placement, y: placement === 'above' ? current.targetTop : current.targetBottom}
                : current);
        }
    }, [tooltip]);

    useEffect(() => {
        const hideTooltip = () => {
            const activeTarget = activeTargetRef.current;
            if (activeTarget?.dataset.vyactTooltipTitle) {
                activeTarget.title = activeTarget.dataset.vyactTooltipTitle;
                delete activeTarget.dataset.vyactTooltipTitle;
            }
            activeTargetRef.current = null;
            setTooltip(null);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') hideTooltip();
        };
        window.addEventListener('keydown', closeOnEscape, true);
        return () => {
            window.removeEventListener('keydown', closeOnEscape, true);
        };
    }, []);

    const show = (target: HTMLElement) => {
        const previousTarget = activeTargetRef.current;
        if (previousTarget && previousTarget !== target && previousTarget.dataset.vyactTooltipTitle) {
            previousTarget.title = previousTarget.dataset.vyactTooltipTitle;
            delete previousTarget.dataset.vyactTooltipTitle;
        }
        const nativeTitle = target.getAttribute('title');
        if (nativeTitle) {
            target.dataset.vyactTooltipTitle = nativeTitle;
            target.removeAttribute('title');
        }
        const content = tooltipContentRegistry.get(target.dataset.instantTooltipId || '')
            ?? target.dataset.instantTooltip
            ?? target.dataset.vyactTooltipTitle;
        const rect = target.getBoundingClientRect();
        const isLongNativeTitle = Boolean(target.dataset.vyactTooltipTitle && target.dataset.vyactTooltipTitle.length > 48);
        const multiline = target.hasAttribute('data-instant-tooltip-multiline') || isLongNativeTitle;
        const size = target.dataset.instantTooltipSize === 'medium' ? 'medium' : 'small';
        const x = rect.left + rect.width / 2;
        if (content) {
            activeTargetRef.current = target;
            setTooltip({
                content,
                x,
                y: rect.top,
                targetTop: rect.top,
                targetBottom: rect.bottom,
                placement: 'above',
                multiline,
                size,
            });
        }
    };

    return <>
        <div onPointerOver={event => { const target = getTooltipTarget(event.target); if (target) show(target); }}
             onPointerOut={event => { const target = getTooltipTarget(event.target); if (target && !target.contains(event.relatedTarget as Node)) {
                 if (target.dataset.vyactTooltipTitle) {
                     target.title = target.dataset.vyactTooltipTitle;
                     delete target.dataset.vyactTooltipTitle;
                 }
                 activeTargetRef.current = null;
                 setTooltip(null);
             } }}
             onFocusCapture={event => { const target = getTooltipTarget(event.target); if (target) show(target); }}
             onBlurCapture={() => {
                 const activeTarget = activeTargetRef.current;
                 if (activeTarget?.dataset.vyactTooltipTitle) {
                     activeTarget.title = activeTarget.dataset.vyactTooltipTitle;
                     delete activeTarget.dataset.vyactTooltipTitle;
                 }
                 activeTargetRef.current = null;
                 setTooltip(null);
             }}>
            {children}
        </div>
        {tooltip && createPortal(
            tooltip.multiline
                ? <div ref={tooltipRef} className={`instant-tooltip ${tooltip.placement} multiline size-${tooltip.size}`} role="tooltip" style={{left: tooltip.x, top: tooltip.y}}
                >{tooltip.content}</div>
                : <div ref={tooltipRef} className={`instant-tooltip ${tooltip.placement} size-${tooltip.size}`} role="tooltip" style={{left: tooltip.x, top: tooltip.y}}>{tooltip.content}</div>,
            document.body,
        )}
    </>;
}
