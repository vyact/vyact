import {useEffect, useState} from 'react';
import {api} from '../../services/api';
import type {McpServer} from '../../types';
import {onMcpServersChanged} from '../../utils/mcpEvents';

/** Resolve explicitly selected tools independently of the main chat. */
export default function useSelectedMcpTools(selectedIds: string[] | undefined, onSelectionChange: (ids: string[]) => void, defaultType?: string) {
    const [servers, setServers] = useState<McpServer[]>([]);
    useEffect(() => {
        let active = true;
        const load = () => api.getMcpServers().then(result => {
            if (active) setServers(result.servers ?? []);
        }).catch(() => {});
        void load();
        const unsubscribe = onMcpServersChanged(() => void load());
        return () => {active = false; unsubscribe();};
    }, []);
    useEffect(() => {
        if (selectedIds !== undefined || !defaultType) return;
        const defaults = servers.filter(server => server.type === defaultType).map(server => server.id);
        if (defaults.length) onSelectionChange(defaults);
    }, [selectedIds, defaultType, servers, onSelectionChange]);
    const setSelectedServers = (selected: McpServer[]) => {
        const ids = selected.map(server => server.id);
        onSelectionChange(ids);
        setServers(current => [...current.filter(server => !ids.includes(server.id)), ...selected]);
    };
    return {selectedServers: servers.filter(server => (selectedIds ?? []).includes(server.id)), setSelectedServers};
}
