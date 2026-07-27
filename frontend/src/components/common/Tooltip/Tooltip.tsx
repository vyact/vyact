import {cloneElement, isValidElement, ReactElement, ReactNode, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import './Tooltip.css';

type TooltipProps = {content: string; multiline?: boolean; large?: boolean; children: ReactElement};

/** Use for new controls. TooltipProvider also migrates legacy title attributes. */
export function Tooltip({content, multiline, large, children}: TooltipProps) {
    if (!isValidElement(children)) return children;
    return cloneElement(children, {
        'data-instant-tooltip': content,
        ...(multiline ? {'data-instant-tooltip-multiline': ''} : {}),
        ...(large ? {'data-instant-tooltip-large': ''} : {}),
        title: undefined,
    } as never);
}

type TooltipState = {content: string; x: number; y: number; placement: 'above' | 'below'; multiline: boolean; large: boolean} | null;

const getTooltipTarget = (target: EventTarget | null) => target instanceof Element
    ? target.closest<HTMLElement>('[data-instant-tooltip]')
    : null;

const migrateTitle = (element: Element) => {
    if (!(element instanceof HTMLElement)) return;
    const title = element.getAttribute('title');
    if (title) {
        element.dataset.instantTooltip = title;
        element.removeAttribute('title');
    }
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

        if (horizontalOffset) {
            setTooltip(current => current && current.x === tooltip.x
                ? {...current, x: current.x + horizontalOffset}
                : current,
            );
        }
    }, [tooltip]);

    useEffect(() => {
        const migrateTree = (node: Node) => {
            if (!(node instanceof Element)) return;
            migrateTitle(node);
            node.querySelectorAll<HTMLElement>('[title]').forEach(migrateTitle);
        };
        const hideTooltip = () => {
            activeTargetRef.current = null;
            setTooltip(null);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') hideTooltip();
        };
        migrateTree(document.body);
        const observer = new MutationObserver(records => records.forEach(record => {
            if (record.type === 'attributes' && record.target instanceof Element) migrateTitle(record.target);
            record.addedNodes.forEach(migrateTree);
            if (activeTargetRef.current && !activeTargetRef.current.isConnected) hideTooltip();
        }));
        observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['title']});
        window.addEventListener('keydown', closeOnEscape, true);
        return () => {
            observer.disconnect();
            window.removeEventListener('keydown', closeOnEscape, true);
        };
    }, []);

    const show = (target: HTMLElement) => {
        const content = target.dataset.instantTooltip;
        const rect = target.getBoundingClientRect();
        const multiline = target.hasAttribute('data-instant-tooltip-multiline');
        const large = target.hasAttribute('data-instant-tooltip-large');
        const x = rect.left + rect.width / 2;
        const placement = rect.top < window.innerHeight / 2 ? 'below' : 'above';
        if (content) {
            activeTargetRef.current = target;
            setTooltip({
                content,
                x,
                y: placement === 'below' ? rect.bottom : rect.top,
                placement,
                multiline,
                large,
            });
        }
    };

    return <>
        <div onPointerOver={event => { const target = getTooltipTarget(event.target); if (target) show(target); }}
             onPointerOut={event => { const target = getTooltipTarget(event.target); if (target && !target.contains(event.relatedTarget as Node)) {
                 activeTargetRef.current = null;
                 setTooltip(null);
             } }}
             onFocusCapture={event => { const target = getTooltipTarget(event.target); if (target) show(target); }}
             onBlurCapture={() => {
                 activeTargetRef.current = null;
                 setTooltip(null);
             }}>
            {children}
        </div>
        {tooltip && createPortal(
            tooltip.multiline
                ? <div ref={tooltipRef} className={`instant-tooltip ${tooltip.placement} multiline${tooltip.large ? ' large' : ''}`} role="tooltip" style={{left: tooltip.x, top: tooltip.y}}
                >{tooltip.content}</div>
                : <div ref={tooltipRef} className={`instant-tooltip ${tooltip.placement}${tooltip.large ? ' large' : ''}`} role="tooltip" style={{left: tooltip.x, top: tooltip.y}}>{tooltip.content}</div>,
            document.body,
        )}
    </>;
}
