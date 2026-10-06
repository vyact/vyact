const TOOL_STOP_KEYS = {
    tool_repeat_blocked: 'toolRepeatBlocked',
    tool_failures_exhausted: 'toolFailuresExhausted',
    tool_round_limit: 'toolRoundLimit',
} as const;

export function getToolStopMessage(code: string | undefined, t: (key: string) => string) {
    if (!code || !Object.prototype.hasOwnProperty.call(TOOL_STOP_KEYS, code)) return undefined;
    const key = TOOL_STOP_KEYS[code as keyof typeof TOOL_STOP_KEYS];
    return {title: t(`message.${key}Title`), description: t(`message.${key}Description`)};
}
