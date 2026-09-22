import {describe, expect, it} from 'vitest';
import {getKokoroVoiceLanguage, resolveKokoroVoice, normalizeKokoroVoices, resolveConfiguredKokoroVoice} from './kokoroVoice';

describe('Kokoro voice language selection', () => {
    it.each([
        ['zf_xiaobei', 'en-US', ''],
        ['jf_nezumi', 'zh-CN', ''],
        ['af_heart', 'ja-JP', ''],
        ['jf_nezumi', 'ja-JP', 'jf_nezumi'],
        ['zf_xiaobei', 'zh-CN', 'zf_xiaobei'],
        ['ef_dora', 'es-ES', 'ef_dora'],
        ['bf_emma', 'en-US', 'bf_emma'],
        ['', 'en-US', ''],
        ['unknown', 'en-US', ''],
    ])('resolves %s for requested language %s', (voice, language, expected) => {
        expect(resolveKokoroVoice(voice, language)).toBe(expected);
    });
    it('keeps preview language tied to the selected voice', () => {
        expect(getKokoroVoiceLanguage('zf_xiaobei')).toBe('zh-CN');
        expect(getKokoroVoiceLanguage('jf_nezumi')).toBe('ja-JP');
    });
});

describe('per-language voice settings compatibility', () => {
    it('retains the old voice for its language and defaults other languages', () => {
        const settings = {kokoroVoice: 'bf_emma'};
        expect(resolveConfiguredKokoroVoice(settings, 'en-US')).toBe('bf_emma');
        expect(resolveConfiguredKokoroVoice(settings, 'ja-JP')).toBe('');
    });
    it('keeps independent selections and gives them priority over the old setting', () => {
        const settings = {kokoroVoice: 'af_heart', kokoroVoices: {en: 'bm_george', ja: 'jf_nezumi', zh: 'zf_xiaoni'}};
        expect(resolveConfiguredKokoroVoice(settings, 'en-US')).toBe('bm_george');
        expect(resolveConfiguredKokoroVoice(settings, 'ja-JP')).toBe('jf_nezumi');
        expect(resolveConfiguredKokoroVoice(settings, 'zh-CN')).toBe('zf_xiaoni');
        expect(resolveConfiguredKokoroVoice(settings, 'ko-KR')).toBe('');
    });
    it('ignores invalid stored maps and mismatched languages', () => {
        expect(normalizeKokoroVoices(null, 'jf_nezumi')).toEqual({ja: 'jf_nezumi'});
        expect(normalizeKokoroVoices({ja: 'af_heart', en: 42}, 'bf_emma')).toEqual({en: 'bf_emma'});
    });
});
