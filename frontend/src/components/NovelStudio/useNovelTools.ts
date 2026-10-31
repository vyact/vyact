import {useEffect, useState} from 'react';
import {api} from '../../services/api';
import type {McpServer} from '../../types';
import {onMcpServersChanged} from '../../utils/mcpEvents';

const NOVEL_TOOL_SELECTION_KEY = 'vyact:novel-studio:selected-mcp-ids';

/** Store only IDs, separately from chat switches and individual manuscripts. */
export default function useNovelTools() {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [servers, setServers] = useState<McpServer[]>([]);
    useEffect(() => {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(NOVEL_TOOL_SELECTION_KEY) ?? '[]');
            if (Array.isArray(saved)) setSelectedIds(saved.filter((id): id is string => typeof id === 'string'));
        } catch { /* Keep the session usable when local storage is unavailable. */ }
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
        setSelectedIds(ids);
        setServers(current => [...current.filter(server => !ids.includes(server.id)), ...selected]);
        try {localStorage.setItem(NOVEL_TOOL_SELECTION_KEY, JSON.stringify(ids));}
        catch { /* Selection still works for this session. */ }
    };
    return {selectedServers: servers.filter(server => selectedIds.includes(server.id)), setSelectedServers};
}
