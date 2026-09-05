const KOKORO_VOICE_LANGUAGES: Record<string, string> = {
    af: 'en-US', am: 'en-US', bf: 'en-GB', bm: 'en-GB',
    ef: 'es', em: 'es', ff: 'fr', hf: 'hi', hm: 'hi',
    if: 'it', im: 'it', jf: 'ja-JP', jm: 'ja-JP',
    pf: 'pt-BR', pm: 'pt-BR', zf: 'zh-CN', zm: 'zh-CN',
};

export const getKokoroVoiceLanguage = (voice: string) =>
    KOKORO_VOICE_LANGUAGES[voice.split('_')[0]] ?? 'en-US';

/** Keep the requested language; an empty voice selects its backend default. */
export function resolveKokoroVoice(voice: string, language: string): string {
    const voiceLanguage = KOKORO_VOICE_LANGUAGES[voice.split('_')[0]];
    return voiceLanguage?.split('-')[0] === language.toLowerCase().split('-')[0] ? voice : '';
}
