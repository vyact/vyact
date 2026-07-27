import {useEffect, useMemo, useState} from 'react';
import {getActivePluginModules, refreshActivePlugins} from './registry';

export function usePluginExtensions() {
    const [plugins, setPlugins] = useState(getActivePluginModules());
    useEffect(() => {
        const refresh = () => void refreshActivePlugins().then(() => setPlugins(getActivePluginModules()));
        refresh();
        window.addEventListener('vyact:plugins-changed', refresh);
        return () => window.removeEventListener('vyact:plugins-changed', refresh);
    }, []);
    return useMemo(() => ({
        commands: plugins.flatMap(plugin => plugin.extensions.commands || []),
        inputMenu: plugins.flatMap(plugin => plugin.extensions.inputMenu || []),
        commandPalette: plugins.flatMap(plugin => plugin.extensions.commandPalette || []),
        modals: plugins.flatMap(plugin => plugin.extensions.modals || []),
        providers: plugins.flatMap(plugin => plugin.extensions.providers || []),
        sidePanels: plugins.flatMap(plugin => plugin.extensions.sidePanels || []),
        keyboardShortcuts: plugins.flatMap(plugin => plugin.extensions.keyboardShortcuts || []),
    }), [plugins]);
}
