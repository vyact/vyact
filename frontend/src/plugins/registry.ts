import type {OfficialPluginModule} from './types';

type OfficialPluginLoader = () => Promise<{default: OfficialPluginModule}>;

const loadPluginModule = (frontendUrl: string): ReturnType<OfficialPluginLoader> =>
    import(/* @vite-ignore */ frontendUrl);

let activePlugins: OfficialPluginModule[] = [];

export async function refreshActivePlugins(): Promise<void> {
    const response = await fetch('/api/plugins');
    if (!response.ok) {
        activePlugins = [];
        return;
    }
    const data = await response.json();
    const activePluginEntries: Array<{id: string; frontend_url?: string}> = data.plugins || [];
    activePlugins = (await Promise.all(activePluginEntries.map(async pluginEntry => {
        if (!pluginEntry.frontend_url) return null;
        try {
            const pluginModule = (await loadPluginModule(pluginEntry.frontend_url)).default;
            return pluginModule?.id === pluginEntry.id ? pluginModule : null;
        } catch (error) {
            console.error(`Failed to load plugin frontend: ${pluginEntry.id}`, error);
            return null;
        }
    }))).filter((plugin): plugin is OfficialPluginModule => Boolean(plugin));
}

export function getActivePluginModules(): OfficialPluginModule[] {
    return activePlugins;
}

export function getPluginCommands() {
    return getActivePluginModules().flatMap(plugin => plugin.extensions.commands || []);
}

export function findPluginCommand(command: string) {
    return getPluginCommands().find(item => item.cmd === command);
}

export function openPluginModal(modalId: string) {
    window.dispatchEvent(new CustomEvent('vyact:open-plugin-modal', {detail: {modalId}}));
}

export function openPluginPanel(panelId: string) {
    window.dispatchEvent(new CustomEvent('vyact:open-plugin-panel', {detail: {panelId}}));
}
