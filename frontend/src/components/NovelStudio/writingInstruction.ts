/** Keep task guidance separate from the author's editable input. */
export function buildWritingInstruction(taskGuidance: string, authorDirection: string): string {
    return [taskGuidance.trim(), authorDirection.trim()].filter(Boolean).join('\n\n');
}
export const AUTHOR_DIRECTION_MAX_LENGTH = 30_000;
export const TASK_GUIDANCE_MAX_LENGTH = 2_500;
