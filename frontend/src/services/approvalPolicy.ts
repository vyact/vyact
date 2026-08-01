export type ApprovalMode = 'always_confirm' | 'risky_only' | 'trusted';

const STORAGE_KEY = 'vyact-approval-policy';
const DEFAULT_MODE: ApprovalMode = 'risky_only';

function readMode(key: string): ApprovalMode | null {
    try {
        const value = localStorage.getItem(key);
        return value === 'always_confirm' || value === 'risky_only' || value === 'trusted' ? value : null;
    } catch {
        return null;
    }
}

export function resolveApprovalMode(): ApprovalMode {
    return readMode(STORAGE_KEY) || readMode(`${STORAGE_KEY}:global`) || DEFAULT_MODE;
}

export function saveApprovalMode(mode: ApprovalMode): void {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent('vyact:approval-policy-changed'));
}
