import {createContext} from 'react';

export interface WorkspaceSidebarControl {
    collapsed: boolean;
    toggle: () => void;
    onHoverEnter: () => void;
    onHoverLeave: () => void;
}

export const WorkspaceSidebarContext = createContext<(control: WorkspaceSidebarControl | null) => void>(() => {});
