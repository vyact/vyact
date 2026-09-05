import i18n from 'i18next';

/** Samples follow the selected voice language, independently of the UI language. */
export function getVoicePreviewText(language: string): string {
    const key = `settings:general.voicePreviewSamples.${language.toLowerCase().split('-')[0]}`;
    return i18n.t(i18n.exists(key) ? key : 'settings:general.voicePreviewSamples.en');
}
