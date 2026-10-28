import {readFileSync, readdirSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const root = new URL('./locales/', import.meta.url);
const languages = readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name);
describe('locale JSON syntax', () => {
    it.each(languages)('parses every translation file for %s', language => {
        const folder = new URL(`${language}/`, root);
        const files = readdirSync(folder).filter(file => file.endsWith('.json'));
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) expect(() => JSON.parse(readFileSync(new URL(file, folder), 'utf8'))).not.toThrow();
    });
});
