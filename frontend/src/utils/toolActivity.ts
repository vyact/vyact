export type ToolActivityTranslator = (key: string, options?: Record<string, unknown>) => string;

const MAX_VISIBLE_TOOL_PATHS = 3;
const MAX_TOOL_SNIPPET_LENGTH = 80;
const TRACKING_QUERY_PARAMETERS = new Set([
    'clickEventId', 'imagePath', 'searchId', 'source', 'sourceType', 'subSourceType',
    'utm_campaign', 'utm_content', 'utm_id', 'utm_medium', 'utm_source',
]);

function canonicalUrlKey(url: string): string {
    try {
        const parsed = new URL(url);
        TRACKING_QUERY_PARAMETERS.forEach(parameter => parsed.searchParams.delete(parameter));
        parsed.hash = '';
        parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/';
        return parsed.toString();
    } catch {
        return url.replace(/\/$/, '');
    }
}

const TOOL_ACTION_KEYS: Record<string, string> = {
    search: 'searching', list: 'listing', get: 'reading', read: 'reading', check: 'checking',
    create: 'creating', add: 'creating', upload: 'uploadingAction', append: 'updating',
    update: 'updating', edit: 'updating', move: 'moving', download: 'downloadingAction',
    send: 'sending', reply: 'replying', delete: 'deleting', trash: 'deleting',
    batch: 'deleting', clear: 'clearing', push: 'uploadingAction',
};

const GOOGLE_WORKSPACE_SERVICES: Record<string, string> = Object.fromEntries(
    Object.entries({
        Gmail: ['search_emails', 'get_email', 'create_email_draft', 'send_email', 'reply_email', 'trash_email', 'batch_trash_emails'],
        'Google Calendar': ['list_upcoming_events', 'search_calendar_events', 'list_calendars', 'check_free_busy', 'get_calendar_event', 'create_calendar_event', 'update_calendar_event', 'delete_calendar_event'],
        'Google Drive': ['search_files', 'get_drive_file', 'read_document_content', 'list_drive_folder_items', 'upload_drive_file', 'download_drive_file', 'create_drive_file', 'update_drive_file', 'delete_drive_file', 'move_drive_file', 'create_drive_folder'],
        'Google Docs': ['create_google_doc', 'get_google_doc', 'append_to_google_doc', 'update_google_doc'],
        'Google Sheets': ['create_google_sheet', 'get_google_sheet', 'update_google_sheet', 'append_to_google_sheet', 'clear_google_sheet'],
        'Google Slides': ['create_google_slides', 'get_google_slides', 'add_slide', 'update_slide_text', 'delete_slide'],
        'Google Forms': ['create_google_form', 'get_google_form', 'add_form_question', 'get_form_responses', 'update_form_info'],
    }).flatMap(([service, tools]) => tools.map(tool => [tool, service])),
);

const MICROSOFT_TOOL_SERVICES: Record<string, string> = {
    microsoft_search_emails: 'Outlook', microsoft_get_email: 'Outlook',
    microsoft_send_email: 'Outlook', microsoft_create_email_draft: 'Outlook',
    microsoft_list_calendar_events: 'Outlook Calendar', microsoft_create_calendar_event: 'Outlook Calendar',
    microsoft_search_files: 'OneDrive',
};

const GITHUB_TOOLS = new Set([
    'search_repositories', 'get_file_contents', 'list_commits', 'search_code', 'create_issue',
    'create_branch', 'create_or_update_file', 'push_files', 'create_pull_request', 'list_branches',
]);

function splitToolName(name: string): {server?: string; tool: string} {
    const separatorIndex = name.indexOf('__');
    return separatorIndex < 0
        ? {tool: name}
        : {server: name.slice(0, separatorIndex), tool: name.slice(separatorIndex + 2)};
}

function toolService(tool: string, server?: string): string | undefined {
    if (server) return /^github(?:_|$)/i.test(server) ? 'GitHub' : server.replace(/[_-]+/g, ' ');
    if (tool.startsWith('code_')) return undefined;
    if (GITHUB_TOOLS.has(tool)) return 'GitHub';
    return MICROSOFT_TOOL_SERVICES[tool] ?? GOOGLE_WORKSPACE_SERVICES[tool];
}

function toolActionKey(tool: string): string | undefined {
    const action = tool.replace(/^microsoft_/, '').split('_')[0];
    return TOOL_ACTION_KEYS[action];
}

function compactPaths(paths: string[]): string | undefined {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length) return undefined;
    const visiblePaths = uniquePaths.slice(0, MAX_VISIBLE_TOOL_PATHS);
    const hiddenPathCount = uniquePaths.length - visiblePaths.length;
    return `${visiblePaths.join(', ')}${hiddenPathCount > 0 ? ` +${hiddenPathCount}` : ''}`;
}

function patchPaths(patch: string): string[] {
    const applyPatchPaths = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
        .map(match => match[1].trim());
    if (applyPatchPaths.length) return applyPatchPaths;
    return [...patch.matchAll(/^\+\+\+ (?:b\/)?(.+)$/gm)]
        .map(match => match[1].trim())
        .filter(path => path !== '/dev/null');
}

function compactSnippet(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const firstContentLine = value.split('\n').find(line => line.trim())?.trim();
    if (!firstContentLine) return undefined;
    return firstContentLine.length > MAX_TOOL_SNIPPET_LENGTH
        ? `${firstContentLine.slice(0, MAX_TOOL_SNIPPET_LENGTH)}…`
        : firstContentLine;
}

export function getToolActivityDetail(args?: Record<string, unknown>): string | undefined {
    if (!args) return undefined;

    if (Array.isArray(args.urls)) {
        const hosts = args.urls.filter((url): url is string => typeof url === 'string').map(url => {
            try { return new URL(url).hostname; } catch { return url; }
        });
        return compactPaths(hosts);
    }

    if (Array.isArray(args.paths)) {
        const paths = args.paths.filter((path): path is string => typeof path === 'string');
        return compactPaths(paths);
    }

    if (typeof args.patch === 'string') {
        return compactPaths(patchPaths(args.patch));
    }

    const path = args.path ?? args.file_path ?? args.filename;
    const pattern = args.pattern ?? args.query;
    const details: string[] = [];
    if (typeof path === 'string' && path) {
        const offset = typeof args.offset === 'number' ? args.offset : undefined;
        const limit = typeof args.limit === 'number' ? args.limit : undefined;
        details.push(offset !== undefined && limit !== undefined
            ? `${path}:${offset + 1}-${offset + limit}`
            : path);
    }
    if (typeof pattern === 'string' && pattern) details.push(pattern);
    const check = args.check ?? args.task;
    if (typeof check === 'string' && check) {
        const workingDirectory = typeof args.working_directory === 'string'
            ? args.working_directory
            : '.';
        details.push(`${workingDirectory} · ${check}`);
    }

    if (!details.length) {
        const safeSummary = args.subject ?? args.title ?? args.document_title
            ?? args.name ?? args.file_name ?? args.summary ?? args.branch;
        const summarySnippet = compactSnippet(safeSummary);
        if (summarySnippet) details.push(summarySnippet);
    }
    return details.length ? details.join(' · ') : undefined;
}

export function getToolActivityLinks(args?: Record<string, unknown>): Array<{label: string; url: string}> | undefined {
    if (!args) return undefined;
    const urls = Array.isArray(args.urls) ? args.urls : [args.url];
    const uniqueUrls = [...new Map(urls
        .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url))
        .map(url => [canonicalUrlKey(url), url] as const)).values()];
    const links = uniqueUrls
        .map(url => {
            try { return {label: new URL(url).hostname, url}; } catch { return {label: url, url}; }
        });
    return links.length ? links : undefined;
}

export function getToolActivityResultPresentation(
    result: unknown,
    args?: Record<string, unknown>,
): {detail?: string; links?: Array<{label: string; url: string}>} {
    const failureDetail = getToolActivityFailureDetail(result);
    let payload: Record<string, unknown> | undefined;
    if (typeof result === 'string' && result.trim().startsWith('{')) {
        try { payload = JSON.parse(result) as Record<string, unknown>; } catch { /* use args fallback */ }
    } else if (result && typeof result === 'object') {
        payload = result as Record<string, unknown>;
    }
    const element = payload?.element && typeof payload.element === 'object'
        ? payload.element as Record<string, unknown>
        : undefined;
    const elementName = element?.name ?? element?.title ?? element?.tag;
    const elementUrl = typeof element?.href === 'string' ? element.href : undefined;
    const payloadUrl = typeof payload?.url === 'string' ? payload.url : undefined;
    const payloadTitle = typeof payload?.title === 'string' ? payload.title : undefined;
    const pageLinks = Array.isArray(payload?.pages) ? payload.pages.flatMap(page => {
        if (!page || typeof page !== 'object') return [];
        const pageData = page as Record<string, unknown>;
        const url = typeof pageData.url === 'string' ? pageData.url : '';
        if (!/^https?:\/\//i.test(url)) return [];
        const title = typeof pageData.title === 'string' && pageData.title.trim()
            ? pageData.title.trim()
            : (() => { try { return new URL(url).hostname; } catch { return url; } })();
        return [{label: title, url}];
    }) : [];
    const fallbackLinks = getToolActivityLinks({
        urls: [elementUrl, payloadUrl, ...(getToolActivityLinks(args)?.map(link => link.url) ?? [])]
            .filter((url): url is string => Boolean(url)),
    });
    const uniqueLinks = new Map<string, {label: string; url: string}>();
    for (const link of [...pageLinks, ...(fallbackLinks ?? [])]) {
        let key: string;
        try {
            key = canonicalUrlKey(link.url);
        } catch {
            key = link.url.replace(/\/$/, '');
        }
        if (!uniqueLinks.has(key)) uniqueLinks.set(key, link);
    }
    const links = [...uniqueLinks.values()];
    return {
        detail: failureDetail ?? compactSnippet(elementName) ?? payloadTitle ?? (links?.length ? undefined : getToolActivityDetail(args)),
        links: links.length ? links : undefined,
    };
}

export function getToolActivityFailureDetail(result: unknown): string | undefined {
    if (typeof result === 'string') {
        const trimmed = result.trim();
        if (trimmed.startsWith('[오류]')) return compactSnippet(trimmed.slice('[오류]'.length).trim());
        if (!trimmed.startsWith('{')) return undefined;
        try {
            return getToolActivityFailureDetail(JSON.parse(trimmed));
        } catch {
            return undefined;
        }
    }
    if (!result || typeof result !== 'object') return undefined;
    const payload = result as Record<string, unknown>;
    if (payload.ok !== false && !payload.error) return undefined;
    const error = payload.error;
    if (typeof error === 'string') return compactSnippet(error);
    if (error && typeof error === 'object') {
        const errorPayload = error as Record<string, unknown>;
        return compactSnippet(errorPayload.message ?? errorPayload.detail ?? errorPayload.code);
    }
    return compactSnippet(payload.message ?? payload.detail);
}

export function isToolActivityResultFailed(result: unknown): boolean {
    if (typeof result === 'string') {
        if (result.startsWith('[오류]')) return true;
        if (!result.trim().startsWith('{')) return false;
        try {
            const payload = JSON.parse(result) as Record<string, unknown>;
            return payload.ok === false || Boolean(payload.error);
        } catch {
            return false;
        }
    }
    if (!result || typeof result !== 'object') return false;
    const payload = result as Record<string, unknown>;
    return payload.ok === false || Boolean(payload.error);
}

export function getStoredToolActivityDetail(detail?: string): string | undefined {
    if (!detail?.trim().startsWith('{')) return detail;
    try {
        const args = JSON.parse(detail) as Record<string, unknown>;
        return getToolActivityDetail(args);
    } catch {
        return detail;
    }
}

export function getToolActivityLabel(
    name: string | undefined,
    t: ToolActivityTranslator,
): string {
    if (!name) return t('toolActivity.working');
    const {server, tool} = splitToolName(name);
    const translationKeys: Record<string, string> = {
        read_file: 'readFile', read_text_file: 'readFile', read_multiple_files: 'readFile',
        write_file: 'writeFile', edit_file: 'editFile', create_directory: 'createDirectory',
        list_directory: 'listDirectory', list_directory_with_sizes: 'listDirectory', directory_tree: 'directoryTree',
        move_file: 'moveFile', search_files: 'searchFiles', get_file_info: 'fileInfo',
        list_allowed_directories: 'allowedDirectories', search_related_context: 'searchContext',
        search_knowledge_collection: 'searchKnowledgeCollection',
        code_list_directory: 'codeListDirectory', code_read_file: 'codeReadFile', code_edit_file: 'codeEditFile',
        code_read_files: 'codeReadFiles', code_find_files: 'codeFindFiles',
        code_file_inventory: 'codeFileInventory', code_install_dependencies: 'codeInstallDependencies',
        code_create_file: 'codeCreateFile', code_grep_search: 'codeSearch', code_apply_patch: 'codeApplyPatch',
        code_list_tasks: 'codeListTasks', code_run_task: 'codeRunTask', code_run_check: 'codeRunCheck',
        code_git_status: 'codeGitStatus', code_git_diff: 'codeGitDiff',
        code_move_file: 'codeMoveFile', code_delete_file: 'codeDeleteFile',
        search_repositories: 'githubRepositories', get_file_contents: 'githubFile', list_commits: 'githubCommits',
        search_code: 'githubCode', create_issue: 'githubIssue',
        web_search: 'browserSearching', browser_search: 'browserSearching', browser_open: 'browserOpening',
        browser_read: 'browserReading', browser_read_urls: 'browserBatchReading',
        browser_inspect: 'browserInspecting', browser_type: 'browserTyping',
        browser_click: 'browserClicking', browser_scroll: 'browserScrolling',
        browser_wait: 'browserWaiting', browser_back: 'browserGoingBack',
        browser_status: 'browserCheckingStatus', browser_close: 'browserClosing',
        browser_wait_for_user: 'waitingBrowserUser', browser_ask_user: 'waitingBrowserUser',
        user_memory_list: 'memoryListing', user_memory_save: 'memorySaving',
        user_memory_update: 'memoryUpdating', user_memory_delete: 'memoryDeleting',
    };
    if (server && !/^filesystem(?:_|$)/i.test(server) && !/^github(?:_|$)/i.test(server)) {
        const actionKey = toolActionKey(tool);
        return t('toolActivity.serviceAction', {
            service: toolService(tool, server),
            action: actionKey ? t(`toolActivity.actions.${actionKey}`) : tool.replace(/[_-]+/g, ' '),
        });
    }
    if (!server && tool === 'search_files') {
        return t('toolActivity.serviceAction', {
            service: 'Google Drive',
            action: t('toolActivity.actions.searching'),
        });
    }
    if (translationKeys[tool]) return t(`toolActivity.${translationKeys[tool]}`);

    const service = toolService(tool, server);
    const actionKey = toolActionKey(tool);
    if (service && actionKey) {
        return t('toolActivity.serviceAction', {
            service,
            action: t(`toolActivity.actions.${actionKey}`),
        });
    }
    const readableTool = tool.replace(/[_-]+/g, ' ');
    return service
        ? t('toolActivity.serviceAction', {service, action: readableTool})
        : t('toolActivity.runningTool', {tool: readableTool});
}

export function getToolActivityDisplayLabel(
    name: string | undefined,
    label: string,
    t: ToolActivityTranslator,
    phase?: 'judging' | 'running' | 'completed',
    outcome?: 'success' | 'rejected' | 'failed',
    awaitingApproval?: boolean,
): string {
    if (awaitingApproval) return label;
    if (outcome === 'rejected') return t('toolActivity.approvalRejected');
    if (outcome === 'failed') {
        const {server, tool} = name ? splitToolName(name) : {tool: ''};
        const service = toolService(tool, server);
        const actionKey = toolActionKey(tool);
        return service && actionKey
            ? t('toolActivity.serviceAction', {
                service,
                action: t(`toolActivity.failedActions.${actionKey}`),
            })
            : t('toolActivity.failed');
    }
    if (phase === 'completed') {
        const {server, tool} = name ? splitToolName(name) : {tool: ''};
        const memoryCompletionKeys: Record<string, string> = {
            user_memory_list: 'memoryListCompleted', user_memory_save: 'memorySaveCompleted',
            user_memory_update: 'memoryUpdateCompleted', user_memory_delete: 'memoryDeleteCompleted',
        };
        if (!server && memoryCompletionKeys[tool]) return t(`toolActivity.${memoryCompletionKeys[tool]}`);
        if (!server && tool === 'code_file_inventory') return t('toolActivity.codeFileInventoryCompleted');
        if (!server && tool === 'code_install_dependencies') return t('toolActivity.codeInstallDependenciesCompleted');
        if (!server && ['code_read_file', 'code_read_files'].includes(tool)) return t('toolActivity.readCompleted');
        if (!server && ['code_grep_search', 'code_find_files', 'code_list_directory'].includes(tool)) return t('toolActivity.searchCompleted');
        if (!server && ['code_edit_file', 'code_apply_patch', 'code_create_file', 'code_move_file', 'code_delete_file'].includes(tool)) {
            return t('toolActivity.editCompleted');
        }
        if (!server && ['code_run_check', 'code_run_task', 'code_list_tasks', 'code_git_status', 'code_git_diff'].includes(tool)) {
            return t('toolActivity.checkCompleted');
        }
        const browserCompletionKeys: Record<string, string> = {
            web_search: 'browserSearchCompleted', browser_search: 'browserSearchCompleted',
            browser_open: 'browserOpenCompleted',
            browser_read: 'browserReadCompleted',
            browser_read_urls: 'browserBatchReadCompleted',
            browser_inspect: 'browserInspectCompleted',
            browser_type: 'browserTypeCompleted',
            browser_click: 'browserClickCompleted',
            browser_scroll: 'browserScrollCompleted',
            browser_wait: 'browserWaitCompleted',
            browser_back: 'browserBackCompleted',
            browser_status: 'browserStatusCompleted',
            browser_close: 'browserCloseCompleted',
            browser_wait_for_user: 'browserUserActionCompleted',
            browser_ask_user: 'browserUserActionCompleted',
        };
        if (!server && browserCompletionKeys[tool]) return t(`toolActivity.${browserCompletionKeys[tool]}`);
        const service = toolService(tool, server);
        const actionKey = toolActionKey(tool);
        if (service && actionKey) {
            return t('toolActivity.serviceAction', {
                service,
                action: t(`toolActivity.completedActions.${actionKey}`),
            });
        }
        return t('toolActivity.completed');
    }
    if (name) {
        const {server, tool} = splitToolName(name);
        if (!server && (tool.startsWith('code_') || MICROSOFT_TOOL_SERVICES[tool] || GOOGLE_WORKSPACE_SERVICES[tool])) {
            return getToolActivityLabel(name, t);
        }
    }
    return label && label !== name ? label : getToolActivityLabel(name, t);
}
