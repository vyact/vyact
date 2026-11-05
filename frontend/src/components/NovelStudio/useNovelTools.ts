import {useEffect, useState} from 'react';
import {api} from '../../services/api';
import type {McpServer} from '../../types';
import {onMcpServersChanged} from '../../utils/mcpEvents';

/** Resolve the current story's saved tool IDs independently of chat switches. */
export default function useNovelTools(selectedIds: string[], onSelectionChange: (ids: string[]) => void) {
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
    const setSelectedServers = (selected: McpServer[]) => {
        const ids = selected.map(server => server.id);
        onSelectionChange(ids);
        setServers(current => [...current.filter(server => !ids.includes(server.id)), ...selected]);
    };
    return {selectedServers: servers.filter(server => selectedIds.includes(server.id)), setSelectedServers};
}
