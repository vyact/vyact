import {cloneElement, isValidElement, ReactElement, ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import './Tooltip.css';

type TooltipSize = 'small' | 'medium';
type TooltipProps = {content: ReactNode; multiline?: boolean; size?: TooltipSize; hoverOnly?: boolean; children: ReactElement};
const tooltipContentRegistry = new Map<string, ReactNode>();
const copiedTooltipEvent = 'vyact:show-copied-tooltip';

export function showCopiedTooltip(target: HTMLElement, content: string) {
    requestAnimationFrame(() => {
        if (target.isConnected) window.dispatchEvent(new CustomEvent(copiedTooltipEvent, {detail: {target, content}}));
    });
}

export function Tooltip({content, multiline, size = 'small', hoverOnly = false, children}: TooltipProps) {
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
        'data-instant-tooltip-hover-only': hoverOnly ? '' : undefined,
        title: undefined,
    } as never);
}

type TooltipState = {content: ReactNode; x: number; y: number; targetTop: number; targetBottom: number; placement: 'above' | 'below'; multiline: boolean; size: TooltipSize} | null;

const getTooltipTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element) || target.closest('[data-tooltip-disabled]')) return null;
    return target.closest<HTMLElement>('[data-instant-tooltip], [title], [data-vyact-tooltip-title]');
};

const adoptNativeTitle = (target: Element) => {
    if (!(target instanceof HTMLElement)) return;
    const nativeTitle = target.getAttribute('title');
    if (!nativeTitle) return;
    target.dataset.vyactTooltipTitle = nativeTitle;
    target.removeAttribute('title');
};

export function TooltipProvider({children}: {children: ReactNode}) {
    const [tooltip, setTooltip] = useState<TooltipState>(null);
    const activeTargetRef = useRef<HTMLElement | null>(null);
    const clickedTargetRef = useRef<HTMLElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);

    const show = useCallback((target: HTMLElement, contentOverride?: string) => {
        adoptNativeTitle(target);
        const content = contentOverride || target.dataset.instantTooltip
            || tooltipContentRegistry.get(target.dataset.instantTooltipId || '')
            || target.dataset.vyactTooltipTitle;
        const rect = target.getBoundingClientRect();
        const isLongNativeTitle = Boolean(target.dataset.vyactTooltipTitle && target.dataset.vyactTooltipTitle.length > 48);
        const multiline = target.hasAttribute('data-instant-tooltip-multiline') || isLongNativeTitle;
        const size = target.dataset.instantTooltipSize === 'medium' ? 'medium' : 'small';
        const x = rect.left + rect.width / 2;
        if (content) {
            const wasActive = activeTargetRef.current === target;
            activeTargetRef.current = target;
            const nextTooltip: NonNullable<TooltipState> = {
                content,
                x,
                y: rect.top,
                targetTop: rect.top,
                targetBottom: rect.bottom,
                placement: 'above',
                multiline,
                size,
            };
            setTooltip(current => current && wasActive
                && current.content === content && current.x === x && current.targetTop === rect.top
                ? current : nextTooltip);
        }
    }, []);

    useEffect(() => {
        const onCopiedTooltip = (event: Event) => {
            const {target, content} = (event as CustomEvent<{target: HTMLElement; content: string}>).detail;
            if (target.isConnected) show(target, content);
        };
        window.addEventListener(copiedTooltipEvent, onCopiedTooltip);
        return () => window.removeEventListener(copiedTooltipEvent, onCopiedTooltip);
    }, [show]);

    useLayoutEffect(() => {
        const adoptTitlesWithin = (root: ParentNode) => {
            if (root instanceof Element && root.hasAttribute('title')) adoptNativeTitle(root);
            root.querySelectorAll?.('[title]').forEach(adoptNativeTitle);
        };
        adoptTitlesWithin(document.body);
        const observer = new MutationObserver(records => {
            // Removing a hovered trigger does not reliably emit pointerout/blur.
            if (activeTargetRef.current && !activeTargetRef.current.isConnected) {
                activeTargetRef.current = null;
                setTooltip(null);
            }
            if (clickedTargetRef.current && !clickedTargetRef.current.isConnected) clickedTargetRef.current = null;
            records.forEach(record => {
                if (record.type === 'attributes') {
                    adoptNativeTitle(record.target as Element);
                    if (record.attributeName === 'data-instant-tooltip'
                        && record.target instanceof HTMLElement
                        && record.target === clickedTargetRef.current
                        && !record.target.hasAttribute('data-tooltip-show-on-change')) {
                        clickedTargetRef.current = null;
                        if (!record.target.matches(':hover') && activeTargetRef.current === record.target) {
                            activeTargetRef.current = null;
                            setTooltip(null);
                            return;
                        }
                    }
                    if (record.attributeName === 'data-instant-tooltip'
                        && record.target instanceof HTMLElement
                        && (document.activeElement === record.target || clickedTargetRef.current === record.target
                            || record.target.hasAttribute('data-tooltip-show-on-change'))) {
                        show(record.target);
                        if (record.target.hasAttribute('data-tooltip-show-on-change')) {
                            const copiedTarget = record.target;
                            const copiedLabel = copiedTarget.dataset.instantTooltip;
                            requestAnimationFrame(() => {
                                if (copiedTarget.isConnected && copiedTarget.dataset.instantTooltip === copiedLabel) show(copiedTarget);
                            });
                        }
                        return;
                    }
                    if (record.target === activeTargetRef.current) {
                        const label = activeTargetRef.current.dataset.instantTooltip
                            ?? activeTargetRef.current.dataset.vyactTooltipTitle;
                        if (label) setTooltip(current => current && current.content !== label
                            ? {...current, content: label} : current);
                    }
                    return;
                }
                record.addedNodes.forEach(node => {
                    if (node instanceof Element) adoptTitlesWithin(node);
                });
            });
        });
        observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['title', 'data-instant-tooltip']});
        return () => observer.disconnect();
    }, [show]);

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
            activeTargetRef.current = null;
            setTooltip(null);
        };
        const hideOnScroll = () => {
            const target = activeTargetRef.current;
            if (target?.isConnected && (target.hasAttribute('data-tooltip-show-on-change') || clickedTargetRef.current === target)) show(target);
            else hideTooltip();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') hideTooltip();
        };
        window.addEventListener('scroll', hideOnScroll, true);
        window.addEventListener('resize', hideTooltip);
        window.addEventListener('keydown', closeOnEscape, true);
        const hideOnOutsideClick = (event: PointerEvent | MouseEvent) => {
            if (!activeTargetRef.current?.contains(event.target as Node)) {
                clickedTargetRef.current = null;
                hideTooltip();
            }
        };
        window.addEventListener('pointerdown', hideOnOutsideClick, true);
        window.addEventListener('click', hideOnOutsideClick, true);
        return () => {
            window.removeEventListener('scroll', hideOnScroll, true);
            window.removeEventListener('resize', hideTooltip);
            window.removeEventListener('keydown', closeOnEscape, true);
            window.removeEventListener('pointerdown', hideOnOutsideClick, true);
            window.removeEventListener('click', hideOnOutsideClick, true);
        };
    }, [show]);

    return <>
        <div onPointerOver={event => { const target = getTooltipTarget(event.target); if (target) show(target); }}
             onPointerDownCapture={event => { const target = getTooltipTarget(event.target); if (target) { clickedTargetRef.current = target; show(target); } }}
             onClickCapture={event => { const target = getTooltipTarget(event.target); if (target) { clickedTargetRef.current = target; show(target); } }}
             onPointerOut={event => { const target = getTooltipTarget(event.target); if (target && target === activeTargetRef.current && !target.hasAttribute('data-tooltip-show-on-change') && !target.contains(event.relatedTarget as Node) && !target.matches(':hover')) {
                 activeTargetRef.current = null;
                 if (clickedTargetRef.current === target) clickedTargetRef.current = null;
                 setTooltip(null);
             } }}
             onFocusCapture={event => { const target = getTooltipTarget(event.target); if (target && !target.hasAttribute('data-instant-tooltip-hover-only')) show(target); }}
             onBlurCapture={event => {
                 if (event.target === activeTargetRef.current && !activeTargetRef.current.hasAttribute('data-tooltip-show-on-change')) {
                     activeTargetRef.current = null;
                     setTooltip(null);
                 }
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
