import {getKokoroAvailability} from '../../services/tts/kokoroStatus';

// ── 공통 상수 ─────────────────────────────────────────────
// 음성 대화일때 선택된 시스템 프롬프트가 있으면 그것을 적용하고 없으면 아래의 값을 사용함.
export const VOICE_SYSTEM_PROMPTS: Record<string, string> = {
    'ko-KR': '당신은 친근한 대화 상대입니다. 반드시 한국어로만 답변하세요. 음성 대화이므로 답변은 2~3문장으로 간결하게 해주세요. 마크다운, 번호 목록, 특수기호는 사용하지 마세요.',
    'en-US': 'You are a friendly conversational assistant. Always respond in English only. Keep responses to 2-3 sentences as this is a voice conversation. Do not use markdown, numbered lists, or special symbols.',
    'en-GB': 'You are a friendly conversational assistant. Always respond in English only. Keep responses to 2-3 sentences as this is a voice conversation. Do not use markdown, numbered lists, or special symbols.',
    'ja-JP': 'あなたは親切な会話相手です。必ず日本語だけで答えてください。音声会話なので、2〜3文で簡潔に答えてください。マークダウンや番号リスト、特殊記号は使わないでください。',
    'zh-CN': '你是一个友好的对话助手。请只用中文回答。这是语音对话，请用2-3句话简洁回答。不要使用markdown、编号列表或特殊符号。',
    'th-TH': 'คุณเป็นผู้ช่วยสนทนาที่เป็นมิตร ตอบเป็นภาษาไทยเท่านั้น การสนทนานี้เป็นการสนทนาด้วยเสียง กรุณาตอบสั้นๆ 2-3 ประโยค ไม่ต้องใช้ markdown หรือสัญลักษณ์พิเศษ',
    'vi-VN': 'Bạn là một trợ lý trò chuyện thân thiện. Chỉ trả lời bằng tiếng Việt. Đây là cuộc trò chuyện bằng giọng nói, hãy trả lời ngắn gọn 2-3 câu. Không dùng markdown hay ký hiệu đặc biệt.',
    'es-ES': 'Eres un asistente de conversación amigable. Responde solo en español. Esta es una conversación de voz, responde en 2-3 oraciones. No uses markdown, listas numeradas ni símbolos especiales.',
};

export const LANGUAGES = [
    {code: 'ko-KR', fallbackLabel: '한국어', flag: '🇰🇷'},
    {code: 'en-US', fallbackLabel: 'English (US)', flag: '🇺🇸'},
    {code: 'en-GB', fallbackLabel: 'English (UK)', flag: '🇬🇧'},
    {code: 'ja-JP', fallbackLabel: '日本語', flag: '🇯🇵'},
    {code: 'zh-CN', fallbackLabel: '中文', flag: '🇨🇳'},
    {code: 'th-TH', fallbackLabel: 'ภาษาไทย', flag: '🇹🇭'},
    {code: 'vi-VN', fallbackLabel: 'Tiếng Việt', flag: '🇻🇳'},
    {code: 'es-ES', fallbackLabel: 'Español', flag: '🇪🇸'},
];

/** Returns the practice language name in the UI's currently configured language. */
export function getLanguageDisplayName(languageCode: string, displayLocale: string): string {
    const language = LANGUAGES.find(({code}) => code === languageCode);
    const locale = displayLocale.split('-')[0];

    try {
        return new Intl.DisplayNames([locale], {type: 'language'}).of(languageCode)
            ?? language?.fallbackLabel
            ?? languageCode;
    } catch {
        return language?.fallbackLabel ?? languageCode;
    }
}

// 값 ↑ → 더 쉽게 침묵으로 판단 (말 중간에 끊길 수 있음)
// 값 ↓ → 덜 민감 (반응 느리지만 자연스러움)
export const SILENCE_THRESHOLD = 0.05;
export const SILENCE_DURATION_MS = 1000;

// 언어별 프롬프트 (A해석/B해석은 항상 한국어로)
const makePrompt = (lang: string) =>
    `다음 형식으로만 출력해주세요 (설명, 번호, 줄바꿈 없이 한 줄로, 반드시 10쌍 이상):
A문장::A한국어해석::B문장::B한국어해석||A문장::A한국어해석::B문장::B한국어해석
A문장과 B문장은 반드시 ${lang}로 작성하고, 해석은 한국어로 작성해주세요.

주제: `;

export const PROMPT_TEMPLATES: Record<string, string> = {
    'ko-KR': makePrompt('한국어'),
    'en-US': makePrompt('영어(미국식)'),
    'en-GB': makePrompt('영어(영국식)'),
    'ja-JP': makePrompt('일본어'),
    'zh-CN': makePrompt('중국어(간체)'),
    'th-TH': makePrompt('태국어'),
    'vi-VN': makePrompt('베트남어'),
    'es-ES': makePrompt('스페인어'),
};

// clipboard 복사 - 앱/웹 모두 동작하는 fallback 방식
export function copyToClipboard(text: string): void {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

// clipboard 읽기 - 앱/웹 모두 동작하는 fallback 방식
export async function readFromClipboard(): Promise<string> {
    if (navigator.clipboard?.readText) {
        try {
            return await navigator.clipboard.readText();
        } catch {
            // Clipboard access is unavailable in some embedded browser contexts.
        }
    }
    // fallback: execCommand paste (일부 환경에서만 동작)
    return new Promise((resolve) => {
        const el = document.createElement('textarea');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.focus();
        document.execCommand('paste');
        const val = el.value;
        document.body.removeChild(el);
        resolve(val);
    });
}

function fallbackCopy(text: string): void {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
}

export function getPromptTemplate(langCode: string): string {
    return PROMPT_TEMPLATES[langCode] ?? PROMPT_TEMPLATES['en-US'];
}

// 기본값 (목록 화면용 - 언어 미선택 상태)
export const PROMPT_TEMPLATE = PROMPT_TEMPLATES['en-US'];

// ── 타입 ──────────────────────────────────────────────────
export type ModalTab = 'chat' | 'script';
export type ChatPhase = 'setup' | 'chatting';
export type ScriptView = 'lang' | 'list' | 'practice' | 'edit' | 'new';
export type PracticePhase = 'idle' | 'listening' | 'checking' | 'processing' | 'wrong' | 'correct' | 'playing_b' | 'playing_a';

export interface ChatEntry {
    role: 'user' | 'assistant';
    text: string;
    timestamp: string;
}

export interface ScriptPair {
    id: string;
    a: string;
    a_ko: string;
    b: string;
    b_ko: string;
}

export interface ScriptDoc {
    id: string;
    title: string;
    language: string;
    pairs?: ScriptPair[];
    raw?: string;
    created_at?: string;
}

export interface VoiceChatModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSend: (message: string, systemPrompt: string | undefined, voiceMode: boolean) => void;
}

// ── 공통 유틸 ─────────────────────────────────────────────
export function mkId() {
    return Math.random().toString(36).slice(2, 8);
}

export function parseRawScript(raw: string): ScriptPair[] {
    return raw.split('||').map(s => s.trim()).filter(Boolean).map(chunk => {
        const parts = chunk.split('::');
        return {
            id: mkId(),
            a: parts[0]?.trim() ?? '',
            a_ko: parts[1]?.trim() ?? '',
            b: parts[2]?.trim() ?? '',
            b_ko: parts[3]?.trim() ?? '',
        };
    }).filter(p => p.a && p.b);
}

export function getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            resolve(voices);
            return;
        }
        const handler = () => {
            const loaded = window.speechSynthesis.getVoices();
            if (loaded.length > 0) {
                resolve(loaded);
                window.speechSynthesis.removeEventListener('voiceschanged', handler);
            }
        };
        window.speechSynthesis.addEventListener('voiceschanged', handler);
    });
}

export function pickVoice(lang: string, voices: SpeechSynthesisVoice[], enVoiceURI: string): SpeechSynthesisVoice | null {
    const prefix = lang.split('-')[0];
    if (prefix === 'ko') {
        return voices.find(v => v.name === '유나')
            ?? voices.find(v => v.lang === 'ko-KR' && v.localService)
            ?? voices.find(v => v.lang.startsWith('ko') && v.localService)
            ?? null;
    }
    if (prefix === 'en') {
        if (enVoiceURI) {
            const sel = voices.find(v => v.voiceURI === enVoiceURI);
            if (sel) return sel;
        }
        return voices.find(v => v.name === 'Samantha')
            ?? voices.find(v => v.name === 'Tom')
            ?? voices.find(v => v.lang === 'en-US' && v.localService)
            ?? voices.find(v => v.lang.startsWith('en') && v.localService)
            ?? null;
    }
    return voices.find(v => v.lang === lang && v.localService)
        ?? voices.find(v => v.lang.startsWith(prefix) && v.localService)
        ?? voices.find(v => v.lang === lang)
        ?? null;
}

// ── Kokoro TTS 헬퍼 ──────────────────────────────

const KOKORO_SUPPORTED_PREFIXES = new Set(['en', 'es', 'fr', 'hi', 'it', 'ja', 'pt', 'zh']);

let _kokoroAudioCtx: AudioContext | null = null;

export async function isKokoroAvailable(): Promise<boolean> {
    return getKokoroAvailability();
}

/**
 * Kokoro 또는 Web Speech로 텍스트를 읽고, 완료 시 resolve.
 * - Kokoro 지원 언어 → 백엔드 API
 * - 미지원 언어(ko 등) → Web Speech
 */
export async function speakWithKokoroOrFallback(
    text: string,
    lang: string,
    settings: { rate: number; volume: number; enVoiceURI: string; kokoroVoice: string },
    abortSignal?: { cancelled: boolean },
): Promise<void> {
    const prefix = lang.split('-')[0];
    const kokoro = await isKokoroAvailable();

    if (kokoro && KOKORO_SUPPORTED_PREFIXES.has(prefix)) {
        try {
            const res = await fetch('/api/tts/kokoro/synthesize', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    text,
                    lang,
                    voice: settings.kokoroVoice || '',
                    speed: settings.rate,
                }),
            });
            if (!res.ok) throw new Error(`Kokoro ${res.status}`);
            if (abortSignal?.cancelled) return;

            const buf = await res.arrayBuffer();
            if (!_kokoroAudioCtx) _kokoroAudioCtx = new AudioContext();
            const audioBuffer = await _kokoroAudioCtx.decodeAudioData(buf);
            const source = _kokoroAudioCtx.createBufferSource();
            source.buffer = audioBuffer;
            const gain = _kokoroAudioCtx.createGain();
            gain.gain.value = settings.volume;
            source.connect(gain);
            gain.connect(_kokoroAudioCtx.destination);

            return new Promise<void>((resolve) => {
                source.onended = () => resolve();
                source.start();

                // abort 지원
                if (abortSignal) {
                    const check = setInterval(() => {
                        if (abortSignal.cancelled) {
                            clearInterval(check);
                            try { source.stop(); } catch { /* */ }
                            resolve();
                        }
                    }, 100);
                    source.onended = () => { clearInterval(check); resolve(); };
                }
            });
        } catch {
            // Kokoro 실패 → Web Speech 폴백
        }
    }

    // Web Speech 폴백
    const voices = await getVoicesAsync();
    return new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        u.rate = lang.startsWith('ko') ? Math.max(1.2, settings.rate) : settings.rate;
        u.volume = settings.volume;
        u.voice = pickVoice(lang, voices, settings.enVoiceURI);
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
    });
}

/** Kokoro + Web Speech 모두 중지 */
export function stopAllTts(): void {
    window.speechSynthesis.cancel();
    // AudioContext source는 개별 관리 — abortSignal로 중단
}
