// 모델 관련 타입
export interface ModelInfo {
    id?: string;
    name: string;
    desc: string;
    size?: string;
    recommended?: boolean;
}

// 메시지 관련 타입
export interface MessageAttachment {
    type: 'image' | 'zip' | 'file';
    filename?: string;
    original_name?: string;
    saved_name?: string;
    path?: string;
    url?: string;
    file_count?: number;
    files?: unknown[];
    content?: string;
}

// 뉴스 기사 첨부
export interface ArticleAttachment {
    title: string;
    url: string;
    content: string;
    source: string;
    indexed_at?: string;
    file_id?: string;  // 인덱싱된 문서 참조용
}

export interface McpCatalogField {
    key: string;
    label: string;
    type: 'text' | 'secret' | 'dir_list' | 'lines' | 'env' | 'select' | 'file_json' | 'toggle';
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
}

export interface McpCatalogEntry {
    label: string;
    kind: string;
    fields: McpCatalogField[];
    default_prompt?: string;
    singleton?: boolean;
}

export interface McpServer {
    id: string;
    type: string;
    enabled: boolean;
    config: Record<string, unknown>;
    prompt?: string;
}

export interface PluginSettingsDefinition {
    endpoint: string;
    fields: Array<{
        id: string;
        type: 'secret';
        label: string;
        description?: string;
        help_url?: string;
    }>;
}

export interface InstalledPlugin {
    id: string;
    name: string;
    version: string;
    description?: string;
    mcp_types?: string[];
    data_indices?: string[];
    removal_items?: string[];
    settings?: PluginSettingsDefinition;
}

export interface RagContextItem {
    source: string;
    title?: string;
    data: string;
}

// Ollama 응답의 토큰수/처리시간 통계 (단위: eval_count류는 토큰 개수, duration류는 나노초)
export interface MessageStats {
    prompt_eval_count?: number | null;
    prompt_eval_duration?: number | null;
    eval_count?: number | null;
    eval_duration?: number | null;
    total_duration?: number | null;
    llm_total_duration?: number | null;
    tool_duration?: number | null;
    tool_call_count?: number | null;
    llm_rounds?: number | null;
}

/** 실행 중인 MCP/code tool의 사용자 표시용 상태. */
export interface ToolActivity {
    id?: string;
    phase: 'judging' | 'running' | 'completed';
    group?: 'analysis' | 'code' | 'tool';
    label: string;
    detail?: string;
    startedAt?: number;
    completedAt?: number;
}

export interface Message {
    id?: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    model?: string;
    attachments?: MessageAttachment[];
    isError?: boolean;
    toolStatus?: ToolActivity;  // MCP/code tool 실행 진행표시
    activityLog?: ToolActivity[]; // 도구·LLM 실행 흐름 누적 표시
    followups?: string[];  // 응답 말미 <followups> 블록에서 파싱한 후속 질문 목록
    isGeneratedImage?: boolean;
    articleSources?: ArticleAttachment[];  // 기사 기반 질의 시 참고 기사
    pdfFile?: string;
    ragContext?: RagContextItem[];  // API 조회 데이터 (히스토리 전달용)
    stats?: MessageStats;  // 토큰수/처리시간 통계 (ollama만 해당, 응답(assistant) 메시지에 저장)
    pdfParams?: {
        prompt: string;
        page_count: number;
        page_count_auto?: boolean;
        language: string;
        style: string;
        article_urls?: string[];
        image_filenames?: string[];
    };  // PDF 생성 시 파일명
}

// 소스 관련 타입
export interface Source {
    source: string;
    url: string;
    title: string;
    score: string;
}

/** 채팅 및 스트리밍 응답의 RAG/MCP 출처 항목. */
export interface ChatSource {
    title?: string;
    content?: string;
    url?: string;
    source?: string;
    indexed_at?: string;
    file_id?: string | null;
    score?: number | string;
}

// 대화 관련 타입
export interface Conversation {
    conv_id: string;
    title: string;
    created_at?: string;
    updated_at?: string;
    project_id?: string;
    has_summary?: boolean;
}

export interface Project { id: string; name: string; folder_path?: string; project_prompt?: string; created_at: string; updated_at: string; }

// API 응답 타입
export interface ChatResponse {
    answer: string;
    sources?: ChatSource[];
    model?: string;
    conv_id?: string;
    response_type?: 'action' | 'simple';
}

export interface HistoryResponse {
    conversations: Conversation[];
    total?: number;
}

export interface QuickNote {
    id: string;
    text: string;
    done: boolean;
    created_at: string;
    updated_at: string;
}

export interface ConversationDetailResponse {
    conv_id: string;
    title: string;
    messages: Message[];
    created_at?: string;
    updated_at?: string;
}

export interface StatusResponse {
    status: 'ok' | 'error';
    models: string[];
    active_model?: string;
    model_type?: 'chat' | 'image_gen' | 'image_edit';
    is_image_model?: boolean;
}

export interface CrawlResponse {
    status: string;
    count?: number;
    message?: string;
}

// 설치 관련 타입
export interface InstallProgress {
    stage: string;
    progress: number;
    message: string;
}

export type LogType = 'info' | 'ok' | 'log' | 'error';

export interface LogEntry {
    type: LogType;
    message: string;
}
