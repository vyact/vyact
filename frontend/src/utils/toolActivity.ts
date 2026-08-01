export type ToolActivityTranslator = (key: string, options?: Record<string, unknown>) => string;

export function getToolActivityLabel(
    name: string | undefined,
    t: ToolActivityTranslator,
): string {
    if (!name) return t('toolActivity.working');
    const tool = name.includes('__') ? name.split('__').slice(1).join('__') : name;
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
    return translationKeys[tool]
        ? t(`toolActivity.${translationKeys[tool]}`)
        : t('toolActivity.runningTool', {tool});
}
