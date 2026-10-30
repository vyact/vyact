import React, {createContext, useCallback, useContext, useMemo, useRef, useState} from 'react';

export interface SidePanelPolicy {
    id: string;
    supportsMiniMode?: boolean;
    preserveActivityWhenMinimized?: boolean;
}

interface PanelManagerValue {
    activePanel: string | null;
    minimizedPanels: string[];
    open: (panelId: string) => void;
    close: (panelId: string, options?: {skipLeaveConfirmation: boolean}) => void;
    minimize: (panelId: string) => void;
    expand: (panelId: string) => void;
    register: (policy: SidePanelPolicy) => () => void;
    registerLeaveGuard: (panelId: string, guard: (proceed: () => void) => void) => () => void;
}

const PanelManagerContext = createContext<PanelManagerValue | null>(null);

export const PanelManagerProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
    const [activePanel, setActivePanel] = useState<string | null>(null);
    const [minimizedPanels, setMinimizedPanels] = useState<string[]>([]);
    const [policies] = useState(() => new Map<string, SidePanelPolicy>());
    const activePanelRef = useRef<string | null>(null);
    const leaveGuards = useRef(new Map<string, (proceed: () => void) => void>());
    const registerLeaveGuard = useCallback((panelId: string, guard: (proceed: () => void) => void) => {
        leaveGuards.current.set(panelId, guard);
        return () => {if (leaveGuards.current.get(panelId) === guard) leaveGuards.current.delete(panelId);};
    }, []);
    const requestLeave = useCallback((target: string | null, proceed: () => void) => {
        const current = activePanelRef.current;
        const guard = current && current !== target ? leaveGuards.current.get(current) : undefined;
        if (guard) guard(() => {if (activePanelRef.current === current) proceed();});
        else proceed();
    }, []);

    const open = useCallback((panelId: string) => {
        requestLeave(panelId, () => {
            const current = activePanelRef.current;
            if (current && current !== panelId) {
                const currentPolicy = policies.get(current);
                if (currentPolicy?.supportsMiniMode && currentPolicy.preserveActivityWhenMinimized) {
                    setMinimizedPanels(items => items.includes(current) ? items : [...items, current]);
                }
            }
            activePanelRef.current = panelId;
            setActivePanel(panelId);
            setMinimizedPanels(items => items.filter(id => id !== panelId));
        });
    }, [policies, requestLeave]);
    const close = useCallback((panelId: string, options?: {skipLeaveConfirmation: boolean}) => {
        const proceed = () => {
            if (activePanelRef.current === panelId) {activePanelRef.current = null; setActivePanel(null);}
            setMinimizedPanels(items => items.filter(id => id !== panelId));
        };
        if (options?.skipLeaveConfirmation || activePanelRef.current !== panelId) proceed();
        else requestLeave(null, proceed);
    }, [requestLeave]);
    const minimize = useCallback((panelId: string) => {
        const policy = policies.get(panelId);
        if (!policy?.supportsMiniMode) return;
        const proceed = () => {
            if (activePanelRef.current === panelId) {activePanelRef.current = null; setActivePanel(null);}
            setMinimizedPanels(items => items.includes(panelId) ? items : [...items, panelId]);
        };
        if (activePanelRef.current === panelId) requestLeave(null, proceed);
        else proceed();
    }, [policies, requestLeave]);
    const expand = useCallback((panelId: string) => open(panelId), [open]);
    const register = useCallback((policy: SidePanelPolicy) => {
        policies.set(policy.id, policy);
        return () => {
            policies.delete(policy.id);
            close(policy.id);
        };
    }, [close, policies]);

    const value = useMemo(() => ({
        activePanel, minimizedPanels, open, close, minimize, expand, register, registerLeaveGuard,
    }), [activePanel, close, expand, minimizedPanels, minimize, open, register, registerLeaveGuard]);
    return <PanelManagerContext.Provider value={value}>{children}</PanelManagerContext.Provider>;
};

export function usePanelManager(): PanelManagerValue {
    const context = useContext(PanelManagerContext);
    if (!context) throw new Error('usePanelManager must be used within PanelManagerProvider');
    return context;
}
