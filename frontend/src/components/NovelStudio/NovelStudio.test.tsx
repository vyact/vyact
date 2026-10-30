import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import NovelStudio from './NovelStudio';

vi.mock('../../i18n', () => ({default: {t: (key: string) => key, on: vi.fn(), off: vi.fn()}}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key, i18n: {language: 'ko'}})}));
afterEach(() => vi.unstubAllGlobals());

describe('opening the writing workspace', () => {
    it('waits for the server instead of reading or replacing local manuscripts', () => {
        const read = vi.fn(() => {throw new Error('Local data must not be read');});
        const write = vi.fn();
        vi.stubGlobal('localStorage', {getItem: read, setItem: write});
        const html = renderToStaticMarkup(createElement(NovelStudio, {onClose: vi.fn()}));
        expect(html).toContain('novelStudio.loadingStories');
        expect(html).not.toContain('novel-manuscript');
        expect(html).not.toContain('novel-welcome');
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
    });
});
