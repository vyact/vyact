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

export const KOKORO_LANGUAGE_DEFAULTS: Record<string, string> = {
    en: 'af_heart', ja: 'jf_alpha', zh: 'zf_xiaobei', es: 'ef_dora',
    fr: 'ff_siwis', hi: 'hf_alpha', it: 'if_sara', pt: 'pf_dora',
};

export function normalizeKokoroVoices(voices: unknown, legacyVoice: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (voices && typeof voices === 'object' && !Array.isArray(voices)) {
        for (const [language, voice] of Object.entries(voices)) {
            if (Object.prototype.hasOwnProperty.call(KOKORO_LANGUAGE_DEFAULTS, language) && typeof voice === 'string'
                && resolveKokoroVoice(voice, language)) result[language] = voice;
        }
    }
    const legacyLanguage = getKokoroVoiceLanguage(legacyVoice).split('-')[0];
    if (!result[legacyLanguage] && resolveKokoroVoice(legacyVoice, legacyLanguage)) {
        result[legacyLanguage] = legacyVoice;
    }
    return result;
}

export function resolveConfiguredKokoroVoice(
    settings: {kokoroVoice: string; kokoroVoices?: Record<string, string>}, language: string,
): string {
    const languageKey = language.toLowerCase().split('-')[0];
    const voices = normalizeKokoroVoices(settings.kokoroVoices, settings.kokoroVoice);
    return resolveKokoroVoice(voices[languageKey] ?? '', language);
}
