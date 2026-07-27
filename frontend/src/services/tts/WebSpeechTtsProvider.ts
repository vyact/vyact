import type {ITtsProvider} from './ITtsProvider';
import {loadTtsSettings} from './ttsSettings';

const MAX_TTS_SEGMENT_LENGTH = 240;

/**
 * 언어별 음성 전략:
 * - 한국어(ko)  → 유나 고정
 * - 영어(en)    → 설정의 enVoiceURI (기본 Samantha)
 * - 기타 언어   → 해당 언어 로컬 음성 자동 선택
 *
 * speak() 전략:
 * - 문장 단위로 주언어 판정
 * - 한 문장 안에 외래어/영단어가 섞여도 주언어(ko/th/vi 등)로 통일 → 자연스러운 발음
 * - 문장 자체가 다른 언어로 바뀔 때만 utterance 분리
 * - 같은 언어 연속 문장은 합쳐서 utterance 최소화
 */
export class WebSpeechTtsProvider implements ITtsProvider {

    private cachedVoices: SpeechSynthesisVoice[] | null = null;
    private playbackId = 0;
    private pending = false;

    isSupported(): boolean {
        return typeof window !== 'undefined' && 'speechSynthesis' in window;
    }

    async preload(): Promise<void> {
        if (!this.isSupported()) return;
        await this.getVoicesAsync();
    }

    async speak(text: string): Promise<void> {
        if (!this.isSupported()) return;

        this.stop();
        const playbackId = ++this.playbackId;

        const cleaned = this.cleanText(text);
        if (!cleaned.trim()) return;

        this.pending = true;

        const settings = loadTtsSettings();

        // 🔥 핵심: voices 안전하게 가져오기
        const voices = await this.getVoicesAsync();
        if (playbackId !== this.playbackId) return;

        const segments = this.splitToSegments(cleaned);
        if (segments.length === 0) {
            this.pending = false;
            return;
        }

        const utterances = segments.map(({text: seg, lang}) => {
            const u = new SpeechSynthesisUtterance(seg);
            u.lang = lang;
            u.rate = lang.startsWith('ko')
                ? Math.max(settings.rate, 1.3)
                : settings.rate;
            u.volume = settings.volume;
            u.voice = this.pickVoice(lang, voices, settings.enVoiceURI);
            return u;
        });

        // 순차 재생
        utterances.forEach((u, i) => {
            if (i < utterances.length - 1) {
                u.onend = () => {
                    if (playbackId === this.playbackId) window.speechSynthesis.speak(utterances[i + 1]);
                };
            } else {
                u.onend = () => {
                    if (playbackId === this.playbackId) this.pending = false;
                };
            }
            u.onerror = () => {
                if (playbackId === this.playbackId) this.pending = false;
            };
        });

        if (playbackId === this.playbackId) window.speechSynthesis.speak(utterances[0]);
    }

    stop(): void {
        if (!this.isSupported()) return;
        this.playbackId += 1;
        this.pending = false;
        window.speechSynthesis.cancel();
    }

    isSpeaking(): boolean {
        if (!this.isSupported()) return false;
        return this.pending || window.speechSynthesis.speaking;
    }

    /**
     * 🔥 voices 안전하게 가져오기 (핵심)
     */
    private getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
        if (this.cachedVoices) return Promise.resolve(this.cachedVoices);

        return new Promise((resolve) => {
            const voices = window.speechSynthesis.getVoices();

            if (voices.length > 0) {
                this.cachedVoices = voices;
                resolve(voices);
                return;
            }

            const handler = () => {
                const loadedVoices = window.speechSynthesis.getVoices();
                if (loadedVoices.length > 0) {
                    this.cachedVoices = loadedVoices;
                    resolve(loadedVoices);
                    window.speechSynthesis.removeEventListener('voiceschanged', handler);
                }
            };

            window.speechSynthesis.addEventListener('voiceschanged', handler);
        });
    }

    splitToSegments(text: string): { text: string; lang: string }[] {
        const raw = text
            .split(/(?<=[.!?。！？\n])\s+/)
            .map(s => s.trim())
            .filter(Boolean);

        const tagged = raw.map(sentence => ({
            text: sentence,
            lang: this.detectLang(sentence),
        }));

        const segments: { text: string; lang: string }[] = [];

        const appendSegment = (text: string, lang: string) => {
            const last = segments[segments.length - 1];
            if (last && last.lang === lang && last.text.length + text.length + 1 <= MAX_TTS_SEGMENT_LENGTH) {
                last.text += ` ${text}`;
                return;
            }
            segments.push({text, lang});
        };

        for (const item of tagged) {
            let remaining = item.text;
            while (remaining.length > MAX_TTS_SEGMENT_LENGTH) {
                const lastSpace = remaining.lastIndexOf(' ', MAX_TTS_SEGMENT_LENGTH);
                const boundary = lastSpace > 0 ? lastSpace : MAX_TTS_SEGMENT_LENGTH;
                appendSegment(remaining.slice(0, boundary).trim(), item.lang);
                remaining = remaining.slice(boundary).trim();
            }
            if (remaining) appendSegment(remaining, item.lang);
        }

        return segments;
    }

    /**
     * 문장의 주언어 판정
     */
    detectLang(text: string): string {
        const s = text.replace(/\s/g, '');
        if (!s.length) return 'en-US';

        const ko = (text.match(/[\uAC00-\uD7A3]/g) ?? []).length;
        const ja = (text.match(/[\u3040-\u30FF]/g) ?? []).length;
        const zh = (text.match(/[\u4E00-\u9FFF]/g) ?? []).length;
        const th = (text.match(/[\u0E00-\u0E7F]/g) ?? []).length;
        const vi = (text.match(/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/gi) ?? []).length;
        const es = (text.match(/[ñáéíóúü¿¡]/gi) ?? []).length;
        const fr = (text.match(/[àâæçéèêëîïôœùûüÿ]/gi) ?? []).length;
        const pt = (text.match(/[ãõçáâàéêíóôú]/gi) ?? []).length;
        const it = (text.match(/[àèéìíîòóù]/gi) ?? []).length;
        const hi = (text.match(/[\u0900-\u097F]/g) ?? []).length;
        const en = (text.match(/[a-zA-Z]/g) ?? []).length;

        const scores: [string, number][] = [
            ['ko-KR', ko],
            ['ja-JP', ja],
            ['zh-CN', zh],
            ['th-TH', th],
            ['vi-VN', vi],
            ['hi-IN', hi],
            ['es-ES', es],
            ['fr-FR', fr],
            ['pt-PT', pt],
            ['it-IT', it],
            ['en-US', en],
        ];

        const [topLang, topScore] = scores.reduce((a, b) => b[1] > a[1] ? b : a);

        if (topScore / s.length >= 0.15) return topLang;

        return 'en-US';
    }

    /**
     * 언어별 음성 선택
     */
    pickVoice(
        lang: string,
        voices: SpeechSynthesisVoice[],
        enVoiceURI: string
    ): SpeechSynthesisVoice | null {
        const prefix = lang.split('-')[0];

        if (prefix === 'ko') {
            return (
                voices.find(v => v.name === '유나') ??
                voices.find(v => v.lang === 'ko-KR' && v.localService) ??
                voices.find(v => v.lang.startsWith('ko') && v.localService) ??
                null
            );
        }

        if (prefix === 'en') {
            if (enVoiceURI) {
                const selected = voices.find(v => v.voiceURI === enVoiceURI);
                if (selected) return selected;
            }

            return (
                voices.find(v => v.name === 'Samantha') ??
                voices.find(v => v.name === 'Tom') ??
                voices.find(v => v.lang === 'en-US' && v.localService) ??
                voices.find(v => v.lang.startsWith('en') && v.localService) ??
                null
            );
        }

        return (
            voices.find(v => v.lang === lang && v.localService) ??
            voices.find(v => v.lang.startsWith(prefix) && v.localService) ??
            voices.find(v => v.lang === lang) ??
            null
        );
    }

    private cleanText(text: string): string {
        return text
            // 마크다운 이미지/링크
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            // 마크다운 테이블
            .replace(/\|[-:\s]+\|[-:\s|]+/g, '')
            .replace(/\|/g, ' ')
            // 코드블록
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]*`/g, '')
            // 마크다운 헤더/볼드/이탤릭
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
            // URL
            .replace(/https?:\/\/\S+/g, '')
            // 이모지 (유니코드 이모지 범위)
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27FF}\u{2B00}-\u{2BFF}]/gu, '')
            .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
            // 특수 기호 (▶ ► ◀ ✓ ★ → 등)
            .replace(/[▶►◀◄▲▼△▽◆◇○●□■※→←↑↓↔⇒⇔✓✗✔✘★☆♦♠♣♥]/g, '')
            // 원형 번호 ①②③
            .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
            // 공백 정리
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }
}
