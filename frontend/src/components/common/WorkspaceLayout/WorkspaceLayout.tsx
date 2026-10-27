import type {ReactNode} from 'react';
import './WorkspaceLayout.css';

interface WorkspaceLayoutProps {
    label: string;
    header: ReactNode;
    sidebar: ReactNode;
    children: ReactNode;
    inspector?: ReactNode;
    className?: string;
}

/** Full main-view workspace shared by tools with navigation, an editor and optional inspector. */
export default function WorkspaceLayout({label, header, sidebar, children, inspector, className = ''}: WorkspaceLayoutProps) {
    return <section aria-label={label} className={`workspace-layout ${inspector ? 'has-inspector' : ''} ${className}`}>
        <header className="workspace-layout-header">{header}</header>
        <div className="workspace-layout-body">
            <div className="workspace-layout-sidebar">{sidebar}</div>
            <div className="workspace-layout-content">{children}</div>
            {inspector && <div className="workspace-layout-inspector">{inspector}</div>}
        </div>
    </section>;
}
