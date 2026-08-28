import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Check, Grid2x2Plus} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {onMcpServersChanged} from '../../utils/mcpEvents';
import type {McpCatalogEntry, McpServer} from '../../types';

export type MentionMcpServer = McpServer;

interface Props {
    query: string;
    selectedIds: string[];
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
    onSelect: (server: MentionMcpServer) => void;
    onVisibleServersChange: (servers: MentionMcpServer[]) => void;
}

export default function McpMentionMenu({query, selectedIds, activeIndex, onActiveIndexChange, onSelect, onVisibleServersChange}: Props) {
    const {t} = useTranslation(['main', 'settings']);
    const listRef = useRef<HTMLDivElement>(null);
    const [servers, setServers] = useState<MentionMcpServer[]>([]);
    const [catalog, setCatalog] = useState<Record<string, McpCatalogEntry>>({});
    useEffect(() => {
        const load = () => Promise.all([api.getMcpServers(), api.getMcpCatalog()])
            .then(([s, c]) => { setServers(s.servers || []); setCatalog(c.catalog || {}); }).catch(() => {});
        void load();
        return onMcpServersChanged(() => void load());
    }, []);
    const serverName = useCallback((server: MentionMcpServer): string => {
        const customName = server.config?.name;
        if (server.type === 'custom' && typeof customName === 'string') return customName;
        return t(`settings:mcpCatalog.servers.${server.type}`, {
            defaultValue: catalog[server.type]?.label || server.type,
        });
    }, [catalog, t]);
    const normalized = query.toLowerCase();
    const visible = useMemo(() => servers.filter(server => {
        return serverName(server).toLowerCase().includes(normalized);
    }), [servers, normalized, serverName]);
    useEffect(() => onVisibleServersChange(visible), [visible, onVisibleServersChange]);
    useEffect(() => {
        const activeItem = listRef.current?.querySelector<HTMLElement>('.mcp-mention-item.active');
        activeItem?.scrollIntoView({block: 'nearest'});
    }, [activeIndex]);
    return <div className="mcp-mention-menu">
        <div className="mcp-mention-header">
            <Grid2x2Plus size={15}/><span>{t('mcpMenu.mentionTitle')}</span>
            <small>{t('mcpMenu.mentionHint')}</small>
        </div>
        <div ref={listRef} className="mcp-mention-list">{visible.map((server, index) => {
            const name = serverName(server);
            return <button key={server.id} type="button" className={`mcp-mention-item${activeIndex === index ? ' active' : ''}`}
                           onMouseEnter={() => onActiveIndexChange(index)}
                           onMouseDown={e => { e.preventDefault(); onSelect(server); }}>
                <span className="mcp-mention-copy"><strong>{name}</strong></span>
                {selectedIds.includes(server.id) && <Check size={18} className="mcp-mention-check"/>}
            </button>;
        })}</div>
        {!visible.length && <div className="mcp-mention-empty">{t('mcpMenu.mentionEmpty')}</div>}
    </div>;
}
