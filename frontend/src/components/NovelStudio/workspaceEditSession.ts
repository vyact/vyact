export interface WorkspaceEditSession {
    dirty: boolean;
    pending: boolean;
    characterText?: string;
    validationError?: string;
    save: () => Promise<boolean>;
    discard: () => Promise<boolean>;
}
