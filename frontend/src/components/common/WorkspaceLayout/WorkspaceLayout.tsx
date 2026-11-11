import type {CSSProperties, ReactNode} from 'react';
import './WorkspaceLayout.css';

interface WorkspaceLayoutProps {
    label: string;
    header: ReactNode;
    sidebar: ReactNode;
    children: ReactNode;
    inspector?: ReactNode;
    className?: string;
    sidebarCollapsed?: boolean;
    sidebarToggle?: ReactNode;
    sidebarWidth?: number;
    sidebarOverlay?: boolean;
    onSidebarMouseEnter?: () => void;
    onSidebarMouseLeave?: () => void;
}

/** Full main-view workspace shared by tools with navigation, an editor and optional inspector. */
export default function WorkspaceLayout({label, header, sidebar, children, inspector, className = '', sidebarCollapsed = false, sidebarToggle, sidebarWidth, sidebarOverlay = false, onSidebarMouseEnter, onSidebarMouseLeave}: WorkspaceLayoutProps) {
    return <section aria-label={label} style={sidebarWidth === undefined ? undefined : {'--workspace-sidebar-width': `${sidebarWidth}px`} as CSSProperties}
        className={`workspace-layout ${inspector ? 'has-inspector' : ''} ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${sidebarOverlay ? 'is-sidebar-overlay' : ''} ${className}`}>
        <header className="workspace-layout-header">{header}</header>
        <div className="workspace-layout-body">
            <div className="workspace-layout-sidebar" onMouseEnter={onSidebarMouseEnter} onMouseLeave={onSidebarMouseLeave} inert={sidebarCollapsed && !sidebarOverlay} aria-hidden={sidebarCollapsed && !sidebarOverlay}>
                {sidebarToggle}
                {sidebarToggle ? <div className="workspace-layout-sidebar-content" inert={sidebarCollapsed && !sidebarOverlay} aria-hidden={sidebarCollapsed && !sidebarOverlay}>{sidebar}</div> : sidebar}
            </div>
            <div className="workspace-layout-content">{children}</div>
            {inspector && <div className="workspace-layout-inspector">{inspector}</div>}
        </div>
    </section>;
}
