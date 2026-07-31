import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {ReactNode} from 'react';
import './ActionMenu.css';

interface ActionMenuProps { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; trigger: ReactNode; children: ReactNode; ariaLabel?: string; title?: string; disabled?: boolean; className?: string; triggerClassName?: string; menuClassName?: string; preferredSide?: 'top' | 'bottom'; }

/** Portal-based action menu that remains above panels and clipped scroll areas. */
const ActionMenu = ({isOpen, onOpenChange, trigger, children, ariaLabel, title, disabled = false, className = '', triggerClassName = '', menuClassName = '', preferredSide = 'bottom'}: ActionMenuProps) => {
    const anchorRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({left: 8, top: 8});
    useEffect(() => {
        if (!isOpen) return;
        const closeForOutsideClick = (event: PointerEvent) => { if (!anchorRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) onOpenChange(false); };
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
            const left = Math.min(Math.max(8, anchor.right - menu.width), window.innerWidth - menu.width - 8);
            const canOpenAbove = anchor.top >= menu.height + 12;
            const canOpenBelow = window.innerHeight - anchor.bottom >= menu.height + 12;
            const openAbove = preferredSide === 'top' ? canOpenAbove || !canOpenBelow : !canOpenBelow && canOpenAbove;
            const top = openAbove ? Math.max(8, anchor.top - menu.height - 4) : anchor.bottom + 4;
            setPosition({left, top});
        };
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); };
    }, [isOpen]);
    return <div className={`action-menu${className ? ` ${className}` : ''}`} ref={anchorRef}><button type="button" className={triggerClassName} aria-label={ariaLabel} title={title} disabled={disabled} aria-expanded={isOpen} onClick={event => { event.stopPropagation(); onOpenChange(!isOpen); }}>{trigger}</button>{isOpen && createPortal(<div ref={menuRef} className={`action-menu-content${menuClassName ? ` ${menuClassName}` : ''}`} style={position} onClick={event => event.stopPropagation()}>{children}</div>, document.body)}</div>;
};

export default ActionMenu;
