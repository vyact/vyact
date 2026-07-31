import type {ReactNode} from 'react';
import ActionMenu from '../common/ActionMenu/ActionMenu';

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
    return <ActionMenu isOpen={isOpen} onOpenChange={onOpenChange} trigger={trigger} title={title} disabled={disabled} className={`sidebar-overflow-menu${className ? ` ${className}` : ''}`} triggerClassName="hist-menu-btn" menuClassName="hist-menu-popup">{children}</ActionMenu>;
};

export default SidebarOverflowMenu;
