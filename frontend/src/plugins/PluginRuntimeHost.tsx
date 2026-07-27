import React, {useEffect} from 'react';
import {usePanelManager} from '../contexts/PanelManagerContext';
import {usePluginExtensions} from './usePluginExtensions';

export const PluginProviders: React.FC<{children: React.ReactNode}> = ({children}) => {
    const {providers} = usePluginExtensions();
    return providers.reduceRight(
        (content, Provider) => <Provider>{content}</Provider>,
        children,
    );
};

export const PluginPanelCoordinator: React.FC = () => {
    const {sidePanels, keyboardShortcuts} = usePluginExtensions();
    const panels = usePanelManager();
    useEffect(
        () => sidePanels.map(panel => panels.register(panel)).reduce(
            (cleanup, unregister) => () => { cleanup(); unregister(); },
            () => {},
        ),
        [panels.register, sidePanels],
    );
    useEffect(() => {
        const openPanel = (event: Event) => panels.open(
            (event as CustomEvent<{panelId: string}>).detail.panelId,
        );
        window.addEventListener('vyact:open-plugin-panel', openPanel);
        return () => window.removeEventListener('vyact:open-plugin-panel', openPanel);
    }, [panels.open]);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            for (const shortcut of keyboardShortcuts) {
                if (
                    event.key.toLowerCase() === shortcut.key.toLowerCase()
                    && Boolean(event.shiftKey) === Boolean(shortcut.shift)
                    && (!shortcut.meta || event.metaKey || event.ctrlKey)
                ) {
                    event.preventDefault();
                    const targetPanelId = shortcut.panelId || sidePanels.find(
                        panel => panel.id.replaceAll('.', '-') === shortcut.id,
                    )?.id;
                    if (targetPanelId && panels.activePanel === targetPanelId) {
                        panels.close(targetPanelId);
                    } else {
                        shortcut.action();
                    }
                    return;
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [keyboardShortcuts, panels.activePanel, panels.close, sidePanels]);
    return null;
};
