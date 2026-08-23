import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {ReactNode} from 'react';
import './ActionMenu.css';

interface ActionMenuProps { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; trigger: ReactNode; children: ReactNode; ariaLabel?: string; title?: string; disabled?: boolean; className?: string; triggerClassName?: string; menuClassName?: string; preferredSide?: 'top' | 'bottom' | 'right'; openOnHover?: boolean; }

/** Portal-based action menu that remains above panels and clipped scroll areas. */
const ActionMenu = ({isOpen, onOpenChange, trigger, children, ariaLabel, title, disabled = false, className = '', triggerClassName = '', menuClassName = '', preferredSide = 'bottom', openOnHover = false}: ActionMenuProps) => {
    const anchorRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [position, setPosition] = useState({left: 8, top: 8});
    useEffect(() => {
        if (!isOpen) return;
        const closeForOutsideClick = (event: PointerEvent) => { if (!anchorRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node) && !(event.target as Element).closest?.('.action-menu-content')) onOpenChange(false); };
        const closeForEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false); };
        document.addEventListener('pointerdown', closeForOutsideClick, true);
        window.addEventListener('keydown', closeForEscape);
        return () => { document.removeEventListener('pointerdown', closeForOutsideClick, true); window.removeEventListener('keydown', closeForEscape); };
    }, [isOpen, onOpenChange]);
    useLayoutEffect(() => {
        if (!isOpen) return;
        const updatePosition = () => {
            const anchor = anchorRef.current?.getBoundingClientRect();
            const menu = menuRef.current?.getBoundingClientRect();
            if (!anchor || !menu) return;
            const rightSideLeft = anchor.right + 4;
            const canOpenRight = window.innerWidth - anchor.right >= menu.width + 12;
            const left = preferredSide === 'right'
                ? (canOpenRight ? rightSideLeft : Math.max(8, anchor.left - menu.width - 4))
                : Math.min(Math.max(8, anchor.right - menu.width), window.innerWidth - menu.width - 8);
            const canOpenAbove = anchor.top >= menu.height + 12;
            const canOpenBelow = window.innerHeight - anchor.bottom >= menu.height + 12;
            const openAbove = preferredSide === 'top' ? canOpenAbove || !canOpenBelow : !canOpenBelow && canOpenAbove;
            const top = preferredSide === 'right'
                ? Math.min(Math.max(8, anchor.top), window.innerHeight - menu.height - 8)
                : openAbove ? Math.max(8, anchor.top - menu.height - 4) : anchor.bottom + 4;
            setPosition({left, top});
        };
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); };
    }, [isOpen, preferredSide]);
    const cancelHoverClose = () => { if (hoverCloseTimerRef.current !== null) { clearTimeout(hoverCloseTimerRef.current); hoverCloseTimerRef.current = null; } };
    const scheduleHoverClose = () => { if (!openOnHover) return; cancelHoverClose(); hoverCloseTimerRef.current = setTimeout(() => onOpenChange(false), 120); };
    return <div className={`action-menu${className ? ` ${className}` : ''}`} ref={anchorRef} onMouseEnter={() => { if (openOnHover && !disabled) { cancelHoverClose(); onOpenChange(true); } }} onMouseLeave={scheduleHoverClose}><button type="button" className={triggerClassName} aria-label={ariaLabel} title={title} disabled={disabled} aria-expanded={isOpen} onClick={event => { event.stopPropagation(); onOpenChange(!isOpen); }}>{trigger}</button>{isOpen && createPortal(<div ref={menuRef} className={`action-menu-content${menuClassName ? ` ${menuClassName}` : ''}`} style={position} onMouseEnter={cancelHoverClose} onMouseLeave={scheduleHoverClose} onClick={event => event.stopPropagation()}>{children}</div>, document.body)}</div>;
};

export default ActionMenu;
