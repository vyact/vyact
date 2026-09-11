import {describe, expect, it} from 'vitest';
import {mergeGroupRecipients, hasRecipientGroupChanges} from './mailRecipientGroupUtils';
describe('recipient group application', () => {
    it('keeps existing recipients and removes case-insensitive duplicates', () => {
        expect(mergeGroupRecipients(['First@example.com'], ['first@example.com', 'second@example.com', 'SECOND@example.com'])).toEqual(['First@example.com', 'second@example.com']);
    });
    it('can apply a group twice without duplicates', () => {
        const group = ['a@example.com', 'b@example.com'];
        expect(mergeGroupRecipients(mergeGroupRecipients([], group), group)).toEqual(group);
    });
});

describe('unsaved recipient group changes', () => {
    const group = {id: '1', name: 'Team', emails: ['a@example.com']};
    it('ignores opening an editor and restoring original values', () => {
        expect(hasRecipientGroupChanges({...group}, group, '', null)).toBe(false);
        expect(hasRecipientGroupChanges({...group}, group, 'a@example.com', 0)).toBe(false);
        expect(hasRecipientGroupChanges({id: 'new', name: '', emails: []}, undefined, '', null)).toBe(false);
    });
    it('detects names, removals, and uncommitted invalid input', () => {
        expect(hasRecipientGroupChanges({...group, name: 'New'}, group, '', null)).toBe(true);
        expect(hasRecipientGroupChanges({...group, emails: []}, group, '', null)).toBe(true);
        expect(hasRecipientGroupChanges(group, group, 'invalid', null)).toBe(true);
    });
});
