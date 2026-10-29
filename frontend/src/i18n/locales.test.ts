import {describe, expect, it} from 'vitest';

const translations = import.meta.glob<string>('./locales/*/*.json', {query: '?raw', import: 'default', eager: true});
describe('locale JSON syntax', () => {
    it('discovers translation files', () => {expect(Object.keys(translations).length).toBeGreaterThan(0);});
    it.each(Object.entries(translations))('parses %s', (_path, source) => {
        expect(() => JSON.parse(source)).not.toThrow();
    });
});
