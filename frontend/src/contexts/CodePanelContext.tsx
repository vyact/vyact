import React, { createContext, useContext, useState, useCallback } from 'react';
import type { CodeFile } from '../components/CodeFileViewer/CodeFileViewer';
import {usePanelManager} from './PanelManagerContext';

interface CodePanelState {
    files: CodeFile[];
    activeIdx: number;
    viewerId: string;
}

interface CodePanelContextType {
    panel: CodePanelState | null;
    openPanel: (files: CodeFile[], activeIdx: number, viewerId: string) => void;
    setActiveIdx: (idx: number) => void;
    closePanel: () => void;
}

const CodePanelContext = createContext<CodePanelContextType | null>(null);

export const CodePanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const panels = usePanelManager();
    const [panel, setPanel] = useState<CodePanelState | null>(null);

    const openPanel = useCallback((files: CodeFile[], activeIdx: number, viewerId: string) => {
        setPanel({ files, activeIdx, viewerId });
        panels.open('code');
    }, [panels.open]);

    const setActiveIdx = useCallback((idx: number) => {
        setPanel(prev => prev ? { ...prev, activeIdx: idx } : prev);
    }, []);

    const closePanel = useCallback(() => {
        setPanel(null);
        panels.close('code');
    }, [panels.close]);

    return (
        <CodePanelContext.Provider value={{ panel, openPanel, setActiveIdx, closePanel }}>
            {children}
        </CodePanelContext.Provider>
    );
};

export const useCodePanel = () => {
    const ctx = useContext(CodePanelContext);
    if (!ctx) throw new Error('useCodePanel must be used within CodePanelProvider');
    return ctx;
};
