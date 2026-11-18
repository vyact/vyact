import {createContext} from 'react';

export interface WorkspaceSidebarControl {
    shortcutScope?: 'stock-analysis';
    collapsed: boolean;
    toggle: () => void;
    onHoverEnter: () => void;
    onHoverLeave: () => void;
}

export const WorkspaceSidebarContext = createContext<(control: WorkspaceSidebarControl | null) => void>(() => {});

export interface WorkspaceRightSidebarControl {
    collapsed: boolean;
    toggle: () => void;
}

export const WorkspaceRightSidebarContext = createContext<(control: WorkspaceRightSidebarControl | null) => void>(() => {});
