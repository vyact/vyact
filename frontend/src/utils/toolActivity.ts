export type ToolActivityTranslator = (key: string, options?: Record<string, unknown>) => string;

const MAX_VISIBLE_TOOL_PATHS = 3;
const MAX_TOOL_SNIPPET_LENGTH = 80;

const TOOL_ACTION_KEYS: Record<string, string> = {
    search: 'searching', list: 'listing', get: 'reading', read: 'reading', check: 'checking',
    create: 'creating', add: 'creating', upload: 'uploadingAction', append: 'updating',
    update: 'updating', edit: 'updating', move: 'moving', download: 'downloadingAction',
    send: 'sending', reply: 'replying', delete: 'deleting', trash: 'deleting',
    batch: 'deleting', clear: 'clearing', push: 'uploadingAction',
};

const GOOGLE_TOOL_SERVICES: Record<string, string> = {
    email: 'Gmail', emails: 'Gmail', draft: 'Gmail',
    event: 'Google Calendar', events: 'Google Calendar', calendars: 'Google Calendar', calendar: 'Google Calendar', busy: 'Google Calendar',
    drive: 'Google Drive', file: 'Google Drive', files: 'Google Drive', folder: 'Google Drive',
    doc: 'Google Docs', document: 'Google Docs',
    sheet: 'Google Sheets', slides: 'Google Slides', slide: 'Google Slides',
    form: 'Google Forms', responses: 'Google Forms', question: 'Google Forms',
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
    if (GITHUB_TOOLS.has(tool) || server?.toLowerCase().includes('github')) return 'GitHub';
    const tokens = tool.split('_');
    for (const token of tokens) {
        if (GOOGLE_TOOL_SERVICES[token]) return GOOGLE_TOOL_SERVICES[token];
    }
    return server?.replace(/[_-]+/g, ' ');
}

function toolActionKey(tool: string): string | undefined {
    const action = tool.split('_')[0];
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
    const editSnippet = compactSnippet(args.old_string);
    if (editSnippet) details.push(editSnippet);

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
        code_create_file: 'codeCreateFile', code_grep_search: 'codeSearch', code_apply_patch: 'codeApplyPatch',
        code_list_tasks: 'codeListTasks', code_run_task: 'codeRunTask', code_run_check: 'codeRunCheck',
        code_git_status: 'codeGitStatus', code_git_diff: 'codeGitDiff',
        code_move_file: 'codeMoveFile', code_delete_file: 'codeDeleteFile',
        search_repositories: 'githubRepositories', get_file_contents: 'githubFile', list_commits: 'githubCommits',
        search_code: 'githubCode', create_issue: 'githubIssue',
    };
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
): string {
    return label && label !== name ? label : getToolActivityLabel(name, t);
}
