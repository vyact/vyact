import React, {useEffect} from 'react';
import {usePanelManager} from '../contexts/PanelManagerContext';
import {usePluginExtensions} from './usePluginExtensions';

const matchesShortcutKey = (event: KeyboardEvent, shortcutKey: string): boolean => {
    if (event.key.toLowerCase() === shortcutKey.toLowerCase()) return true;
    if (/^[a-z]$/i.test(shortcutKey)) return event.code === `Key${shortcutKey.toUpperCase()}`;
    if (/^[0-9]$/.test(shortcutKey)) return event.code === `Digit${shortcutKey}`;
    return false;
};

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
                    matchesShortcutKey(event, shortcut.key)
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
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [keyboardShortcuts, panels.activePanel, panels.close, sidePanels]);
    return null;
};
