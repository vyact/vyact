import {useEffect, useRef} from 'react';
import type {ReactNode} from 'react';

interface SidebarOverflowMenuProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    trigger: ReactNode;
    children: ReactNode;
    title?: string;
    disabled?: boolean;
    className?: string;
}

const SidebarOverflowMenu = ({
    isOpen,
    onOpenChange,
    trigger,
    children,
    title,
    disabled = false,
    className = '',
}: SidebarOverflowMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) onOpenChange(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onOpenChange]);

    return (
        <div className={`sidebar-overflow-menu${className ? ` ${className}` : ''}`} ref={menuRef}>
            <button
                className="hist-menu-btn"
                title={title}
                disabled={disabled}
                onClick={event => {
                    event.stopPropagation();
                    onOpenChange(!isOpen);
                }}
            >
                {trigger}
            </button>
            {isOpen && <div className="hist-menu-popup" onClick={event => event.stopPropagation()}>{children}</div>}
        </div>
    );
};

export default SidebarOverflowMenu;
