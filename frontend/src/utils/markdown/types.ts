import type {ArticleAttachment, Message, Source, ToolActivity} from '../../types';
import type {CodeFile} from '../../components/CodeFileViewer/CodeFileViewer';

export interface MessageProps {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    sources?: Source[];
    model?: string;
    attachments?: Array<{ type: 'image' | 'zip' | 'file'; filename?: string; original_name?: string; saved_name?: string; path?: string; url?: string; file_count?: number; files?: unknown[]; content?: string }>;
    isError?: boolean;
    onRetry?: () => void;
    isGeneratedImage?: boolean;
    articleSources?: ArticleAttachment[];
    pdfFile?: string;
    pdfParams?: Message['pdfParams'];
    onPdfEdit?: (params: NonNullable<Message['pdfParams']>) => void;
    injectedContext?: Array<{ source: string; title?: string; data: string }>;
    onShowInjectedContext?: (ctx: Array<{ source: string; title?: string; data: string }>) => void;
    onOpenMemo?: (memoId: string) => void;
    isStreaming?: boolean;
    conversationId?: string;
    requestStartedAt?: number | null;
    toolStatus?: ToolActivity;
    activityLog?: ToolActivity[];
    stats?: {
        load_duration?: number | null;
        prompt_eval_count?: number | null;
        prompt_eval_duration?: number | null;
        eval_count?: number | null;
        eval_duration?: number | null;
        total_duration?: number | null;
        llm_total_duration?: number | null;
        tool_duration?: number | null;
        tool_call_count?: number | null;
        llm_rounds?: number | null;
    };
}

export interface RenderGroup {
    type: 'text' | 'code' | 'codefiles' | 'project';
    value?: string;
    lang?: string;
    files?: CodeFile[];
}

export interface ContentPart {
    type: 'text' | 'code' | 'project';
    value: string;
    lang?: string;
}

export interface StreamSafeResult {
    safe: string;
    pending: null | 'code' | 'project' | 'table' | 'followups' | 'summary';
}

export interface FollowupsResult {
    body: string;
    followups: string[];
}
