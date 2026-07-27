import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';

export interface SidePanelPolicy {
    id: string;
    supportsMiniMode?: boolean;
    preserveActivityWhenMinimized?: boolean;
}

interface PanelManagerValue {
    activePanel: string | null;
    minimizedPanels: string[];
    open: (panelId: string) => void;
    close: (panelId: string) => void;
    minimize: (panelId: string) => void;
    expand: (panelId: string) => void;
    register: (policy: SidePanelPolicy) => () => void;
}

const PanelManagerContext = createContext<PanelManagerValue | null>(null);

export const PanelManagerProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
    const [activePanel, setActivePanel] = useState<string | null>(null);
    const [minimizedPanels, setMinimizedPanels] = useState<string[]>([]);
    const [policies] = useState(() => new Map<string, SidePanelPolicy>());

    const open = useCallback((panelId: string) => {
        setActivePanel(current => {
            if (current && current !== panelId) {
                const currentPolicy = policies.get(current);
                if (currentPolicy?.supportsMiniMode && currentPolicy.preserveActivityWhenMinimized) {
                    setMinimizedPanels(items => items.includes(current) ? items : [...items, current]);
                }
            }
            return panelId;
        });
        setMinimizedPanels(items => items.filter(id => id !== panelId));
    }, [policies]);
    const close = useCallback((panelId: string) => {
        setActivePanel(current => current === panelId ? null : current);
        setMinimizedPanels(items => items.filter(id => id !== panelId));
    }, []);
    const minimize = useCallback((panelId: string) => {
        const policy = policies.get(panelId);
        if (!policy?.supportsMiniMode) return;
        setActivePanel(current => current === panelId ? null : current);
        setMinimizedPanels(items => items.includes(panelId) ? items : [...items, panelId]);
    }, [policies]);
    const expand = useCallback((panelId: string) => open(panelId), [open]);
    const register = useCallback((policy: SidePanelPolicy) => {
        policies.set(policy.id, policy);
        return () => {
            policies.delete(policy.id);
            close(policy.id);
        };
    }, [close, policies]);

    const value = useMemo(() => ({
        activePanel, minimizedPanels, open, close, minimize, expand, register,
    }), [activePanel, close, expand, minimizedPanels, minimize, open, register]);
    return <PanelManagerContext.Provider value={value}>{children}</PanelManagerContext.Provider>;
};

export function usePanelManager(): PanelManagerValue {
    const context = useContext(PanelManagerContext);
    if (!context) throw new Error('usePanelManager must be used within PanelManagerProvider');
    return context;
}
