import type {ITtsProvider} from './ITtsProvider';
import {KokoroTtsProvider} from './KokoroTtsProvider';

/**
 * TTS 엔진: KokoroTtsProvider
 * - Kokoro 지원 언어 → 백엔드 Kokoro-82M 합성 (고음질)
 * - 미지원 언어 (한국어 등) → Web Speech API 폴백
 * - Kokoro 미설치 시 → 전체 Web Speech 폴백
 */
const provider: ITtsProvider = new KokoroTtsProvider();

export const ttsService = {
    preload: () => provider.preload?.() ?? Promise.resolve(),
    speak: (text: string) => provider.speak(text),
    stop: () => provider.stop(),
    isSpeaking: () => provider.isSpeaking(),
    isSupported: () => provider.isSupported(),
};
