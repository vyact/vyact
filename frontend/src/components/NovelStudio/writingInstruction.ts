/** Keep task guidance separate from the author's editable input. */
export function buildWritingInstruction(taskGuidance: string, authorDirection: string): string {
    return [taskGuidance.trim(), authorDirection.trim()].filter(Boolean).join('\n\n');
}
