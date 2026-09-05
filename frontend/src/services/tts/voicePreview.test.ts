import {beforeAll, expect, it} from 'vitest';
import i18n from 'i18next';
import settings from '../../i18n/locales/ko/settings.json';
import {getVoicePreviewText} from './voicePreview';

beforeAll(async () => { await i18n.init({lng: 'ko', resources: {ko: {settings}}}); });
it('matches the voice language even when only Korean UI resources are loaded', () => {
    expect(getVoicePreviewText('ja-JP')).toBe(settings.general.voicePreviewSamples.ja);
    expect(getVoicePreviewText('pt-BR')).toBe(settings.general.voicePreviewSamples.pt);
    expect(getVoicePreviewText('en-GB')).toBe(settings.general.voicePreviewSamples.en);
});
it('falls back to an available sample for an unsupported voice language', () => {
    expect(getVoicePreviewText('de-DE')).toBe(settings.general.voicePreviewSamples.en);
});
