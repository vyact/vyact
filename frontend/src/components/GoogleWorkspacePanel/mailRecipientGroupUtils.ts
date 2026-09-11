export type MailRecipientGroup = {id: string; name: string; emails: string[]};
export function mergeGroupRecipients(current: string[], emails: string[]): string[] {
    const seen = new Set(current.map(email => email.toLowerCase()));
    return [...current, ...emails.filter(email => {
        const key = email.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    })];
}


export function hasRecipientGroupChanges(draft: MailRecipientGroup | null, original: MailRecipientGroup | undefined, address: string, editingEmail: number | null): boolean {
    if (!draft) return false;
    const pendingChanged = editingEmail === null ? Boolean(address.trim()) : address.trim().toLowerCase() !== draft.emails[editingEmail];
    return pendingChanged || draft.name !== (original?.name || '') || JSON.stringify(draft.emails) !== JSON.stringify(original?.emails || []);
}
