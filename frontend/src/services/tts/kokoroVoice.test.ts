import {describe, expect, it} from 'vitest';
import {getKokoroVoiceLanguage, resolveKokoroVoice} from './kokoroVoice';

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
