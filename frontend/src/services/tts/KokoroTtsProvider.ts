import type { ITtsProvider } from './ITtsProvider';
import { WebSpeechTtsProvider } from './WebSpeechTtsProvider';
import { loadTtsSettings } from './ttsSettings';
import { ensureJapaneseTtsDictionary, JapaneseTtsDictionaryCancelledError } from './japaneseTtsDictionary';

/**
 * Kokoro TTS Provider
 *
 * - Kokoro 지원 언어 (en, es, fr, hi, it, ja, pt, zh) → 백엔드 Kokoro API 호출
 * - 미지원 언어 (ko, th, vi 등) → WebSpeechTtsProvider 위임
 * - Kokoro 서버 불가 시 전체 Web Speech 폴백
 */

const KOKORO_SUPPORTED_PREFIXES = new Set([
    'en', 'es', 'fr', 'hi', 'it', 'ja', 'pt', 'zh',
]);

export class KokoroTtsProvider implements ITtsProvider {
    private webSpeechFallback = new WebSpeechTtsProvider();
    private audioCtx: AudioContext | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    private speaking = false;
    private kokoroAvailable: boolean | null = null; // null = 미확인
    private playbackId = 0;

    isSupported(): boolean {
        return true; // Kokoro 또는 Web Speech 중 하나는 사용 가능
    }

    async preload(): Promise<void> {
        await Promise.all([
            this.kokoroAvailable === null ? this.checkKokoroAvailability() : Promise.resolve(),
            this.webSpeechFallback.preload(),
        ]);
    }

    async speak(text: string): Promise<void> {
        this.stop();
        const playbackId = ++this.playbackId;

        const cleaned = this.webSpeechFallback['cleanText'](text);
        if (!cleaned.trim()) return;

        const segments = this.webSpeechFallback.splitToSegments(cleaned);
        if (segments.length === 0) return;

        // 클릭 직후부터 재생 중으로 처리해 대기 중인 합성 요청의 중복 실행을 막는다.
        this.speaking = true;

        const needsKokoro = segments.some(segment =>
            KOKORO_SUPPORTED_PREFIXES.has(segment.lang.split('-')[0]),
        );

        // Kokoro 지원 언어가 없다면 상태 API를 기다리지 않고 Web Speech를 바로 사용한다.
        if (needsKokoro && this.kokoroAvailable === null) {
            await this.checkKokoroAvailability();
        }
        if (playbackId !== this.playbackId) return;

        // Kokoro 불가 → 전체 Web Speech
        if (!needsKokoro || !this.kokoroAvailable) {
            this.speaking = false;
            return this.webSpeechFallback.speak(text);
        }

        // Web Speech 폴백도 재생 중 상태로 관리해야 다음 문단을 계속 읽는다.
        // 그렇지 않으면 한국어처럼 Kokoro 미지원 언어는 첫 문단 종료 뒤
        // `!this.speaking` 조건에 걸려 이후 세그먼트가 중단된다.
        // 세그먼트별 순차 재생
        for (let index = 0; index < segments.length; index += 1) {
            if (!this.speaking || playbackId !== this.playbackId) break; // stop() 호출됨

            const seg = segments[index];

            const prefix = seg.lang.split('-')[0];

            if (KOKORO_SUPPORTED_PREFIXES.has(prefix)) {
                try {
                    await this.speakWithKokoro(seg.text, seg.lang, playbackId);
                } catch (e) {
                    if (e instanceof JapaneseTtsDictionaryCancelledError) break;
                    console.warn('Kokoro 합성 실패, Web Speech 폴백:', e);
                    await this.speakWithWebSpeech(seg.text, seg.lang, playbackId);
                }
            } else {
                await this.speakWithWebSpeech(seg.text, seg.lang, playbackId);
            }
        }

        if (playbackId === this.playbackId) this.speaking = false;
    }

    stop(): void {
        this.playbackId += 1;
        this.speaking = false;

        // Kokoro 오디오 중단
        if (this.currentSource) {
            try { this.currentSource.stop(); } catch { /* ignore */ }
            this.currentSource = null;
        }

        // Web Speech 중단
        this.webSpeechFallback.stop();
    }

    isSpeaking(): boolean {
        return this.speaking || this.webSpeechFallback.isSpeaking();
    }

    // ── Private ──────────────────────────────────

    private async checkKokoroAvailability(): Promise<void> {
        try {
            const res = await fetch('/api/tts/kokoro/status');
            const data = await res.json();
            this.kokoroAvailable = data.available === true;
        } catch {
            this.kokoroAvailable = false;
        }
    }

    private async speakWithKokoro(text: string, lang: string, playbackId: number): Promise<void> {
        this.speaking = true;
        if (lang.startsWith('ja') && !await ensureJapaneseTtsDictionary()) {
            throw new JapaneseTtsDictionaryCancelledError();
        }
        if (playbackId !== this.playbackId) return;
        const settings = loadTtsSettings();

        const res = await fetch('/api/tts/kokoro/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                lang,
                voice: settings.kokoroVoice || '',
                speed: settings.rate,
            }),
        });

        if (!res.ok) {
            throw new Error(`Kokoro API ${res.status}`);
        }

        const arrayBuffer = await res.arrayBuffer();
        if (playbackId !== this.playbackId) return;

        if (!this.audioCtx) {
            this.audioCtx = new AudioContext();
        }

        const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
        if (playbackId !== this.playbackId) return;
        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        // 볼륨 조절
        const gainNode = this.audioCtx.createGain();
        gainNode.gain.value = settings.volume;
        source.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        this.currentSource = source;

        return new Promise<void>((resolve) => {
            source.onended = () => {
                if (this.currentSource === source) this.currentSource = null;
                resolve();
            };
            if (playbackId === this.playbackId) source.start();
            else resolve();
        });
    }

    private speakWithWebSpeech(text: string, lang: string, playbackId: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const settings = loadTtsSettings();
            const u = new SpeechSynthesisUtterance(text);
            u.lang = lang;
            u.rate = lang.startsWith('ko')
                ? Math.max(settings.rate, 1.3)
                : settings.rate;
            u.volume = settings.volume;

            // 기존 WebSpeechTtsProvider의 voice 선택 로직 재사용
            this.webSpeechFallback['getVoicesAsync']().then((voices: SpeechSynthesisVoice[]) => {
                if (playbackId !== this.playbackId) {
                    resolve();
                    return;
                }
                u.voice = this.webSpeechFallback.pickVoice(lang, voices, settings.enVoiceURI);
                u.onend = () => resolve();
                u.onerror = () => resolve();
                window.speechSynthesis.speak(u);
            });
        });
    }
}
