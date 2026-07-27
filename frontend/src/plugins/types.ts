import type React from 'react';
import type {LucideIcon} from 'lucide-react';
import type {ArticleAttachment, Message} from '../types';
import type {usePanelManager} from '../contexts/PanelManagerContext';

type PluginPanelManager = ReturnType<typeof usePanelManager>;

export interface PluginCommand {
    name?: string;
    cmd: string;
    usage: string;
    desc: string;
    example: string;
    icon: LucideIcon;
    modalId: string;
}

export interface PluginAction {
    id: string;
    label: string;
    icon: LucideIcon;
    modalId: string;
    panelId?: string;
}

export interface PluginModalContext {
    conversationId: string;
    messages: Message[];
    appendUserMessage: (content: string) => void;
    appendAssistantMessage: (content: string, isError?: boolean) => string;
    updateAssistantMessage: (messageId: string, content: string, isError?: boolean) => void;
    reloadHistory: () => Promise<void>;
    onAttachVideo?: (article: ArticleAttachment) => void;
    onDetachVideo?: (url: string) => void;
    onQueryWithVideo?: (articles: ArticleAttachment[], question: string) => void;
}

export interface PluginModalDefinition {
    id: string;
    render: (props: {open: boolean; close: () => void; context: PluginModalContext}) => React.ReactNode;
}

export interface PluginSidePanelDefinition {
    id: string;
    supportsMiniMode?: boolean;
    preserveActivityWhenMinimized?: boolean;
    render: (context: PluginSidePanelContext) => React.ReactNode;
    renderMini?: (context: PluginSidePanelMiniContext) => React.ReactNode;
}

export interface PluginSidePanelContext {
    panels: PluginPanelManager;
    panelWidth: number;
    minimized: boolean;
    onAttachVideo?: (article: ArticleAttachment) => void;
    onDetachVideo?: (url: string) => void;
    onDetachAllVideos?: () => void;
    onQueryWithVideo?: (articles: ArticleAttachment[], question: string) => void;
}

export interface PluginSidePanelMiniContext {
    panels: PluginPanelManager;
}

export interface PluginKeyboardShortcut {
    id: string;
    key: string;
    shift?: boolean;
    meta?: boolean;
    panelId?: string;
    action: () => void;
}

export interface OfficialPluginModule {
    id: string;
    extensions: {
        commands?: PluginCommand[];
        inputMenu?: PluginAction[];
        commandPalette?: PluginAction[];
        modals?: PluginModalDefinition[];
        providers?: React.ComponentType<{children: React.ReactNode}>[];
        sidePanels?: PluginSidePanelDefinition[];
        keyboardShortcuts?: PluginKeyboardShortcut[];
    };
}
