export const TTS_RATE_OPTIONS = [1, 1.2, 1.5, 1.8, 2];
export const normalizeTtsRate = (rate: number): number => TTS_RATE_OPTIONS.reduce(
    (closest, candidate) => Math.abs(candidate - rate) < Math.abs(closest - rate) ? candidate : closest, 1,
);

export interface TtsSettings {
    rate: number;
    volume: number;
    enVoiceURI: string;  // 영어 음성 선택 (한국어는 유나 고정, 기타 언어는 자동)
    kokoroVoice: string; // Kokoro voice 이름 (빈 문자열 = 언어별 기본값)
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
    rate: 1.0,
    volume: 1.0,
    enVoiceURI: '',  // 빈 문자열 = Samantha 기본
    kokoroVoice: 'af_heart',  // 기본 voice (Kokoro 활성 시)
};

export const TTS_SETTINGS_CHANGED = 'ttsSettingsChanged';

let _cache: TtsSettings = {...DEFAULT_TTS_SETTINGS};

export async function fetchTtsSettings(): Promise<TtsSettings> {
    try {
        const res = await fetch('/api/settings/tts');
        const data = await res.json();
        _cache = {
            rate: normalizeTtsRate(data.rate ?? 1.0),
            volume: data.volume ?? 1.0,
            enVoiceURI: data.enVoiceURI ?? '',
            kokoroVoice: data.kokoroVoice || 'af_heart',
        };
    } catch {
        // Keep the last known settings when the backend is unavailable.
    }
    return {..._cache};
}

export function loadTtsSettings(): TtsSettings {
    return {..._cache};
}

export function updateTtsCache(settings: TtsSettings): void {
    _cache = {...settings, rate: normalizeTtsRate(settings.rate)};
    window.dispatchEvent(new Event(TTS_SETTINGS_CHANGED));
}
