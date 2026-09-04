import {splitSpeechBuffer} from '../../services/tts/speechBuffer';
import {useCallback, useEffect, useRef, useState} from 'react';
import {loadTtsSettings} from '../../services/tts/ttsSettings';
import {speakWithKokoroOrFallback, stopAllTts} from './voiceChat.types';

export function useStreamingReadAloud(enabled: boolean, language: string) {
    const [speaking, setSpeaking] = useState(false);
    const state = useRef({buffer: '', queue: [] as string[], running: false, streamed: false, code: false, followups: false, abort: {cancelled: false}});
    const languageRef = useRef(language);
    languageRef.current = language;
    const cancel = useCallback(() => {
        state.current.abort.cancelled = true;
        state.current = {buffer: '', queue: [], running: false, streamed: false, code: false, followups: false, abort: {cancelled: false}};
        stopAllTts();
        setSpeaking(false);
    }, []);
    useEffect(() => {
        if (!enabled) { cancel(); return; }
        const enqueue = (text: string, final: boolean) => {
            const current = state.current;
            current.buffer += text;
            const split = splitSpeechBuffer(current.buffer, final);
            current.buffer = split.rest;
            for (let sentence of split.sentences) {
                if (current.followups) continue;
                const followupsStart = sentence.indexOf('<followups');
                if (followupsStart >= 0) {
                    current.followups = true;
                    sentence = sentence.slice(0, followupsStart);
                }
                // Do not read fenced code, including fences split across stream events.
                const parts = sentence.split('```');
                let readable = '';
                parts.forEach((part, index) => {
                    if (index) current.code = !current.code;
                    if (!current.code) readable += part;
                });
                readable = readable.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
                    .replace(/https?:\/\/\S+/g, '').replace(/[*_#`|]/g, '').trim();
                if (readable) current.queue.push(readable);
            }
            if (current.running || !current.queue.length) return;
            current.running = true;
            setSpeaking(true);
            void (async () => {
                try {
                    while (current.queue.length && !current.abort.cancelled) {
                        await speakWithKokoroOrFallback(current.queue.shift()!, languageRef.current, loadTtsSettings(), current.abort);
                    }
                } catch {
                    current.queue = [];
                } finally {
                    if (state.current === current) { current.running = false; setSpeaking(false); }
                }
            })();
        };
        const start = () => cancel();
        const chunk = (event: Event) => {
            state.current.streamed = true;
            enqueue((event as CustomEvent<string>).detail, false);
        };
        const done = (event: Event) => {
            const text = (event as CustomEvent<{text: string}>).detail.text;
            enqueue(state.current.streamed ? '' : text, true);
        };
        const end = () => enqueue('', true);
        window.addEventListener('voiceReadStart', start);
        window.addEventListener('voiceReadChunk', chunk);
        window.addEventListener('voiceChatResponse', done);
        window.addEventListener('voiceReadEnd', end);
        window.addEventListener('voiceReadCancel', cancel);
        return () => {
            window.removeEventListener('voiceReadStart', start);
            window.removeEventListener('voiceReadChunk', chunk);
            window.removeEventListener('voiceChatResponse', done);
            window.removeEventListener('voiceReadEnd', end);
            window.removeEventListener('voiceReadCancel', cancel);
            cancel();
        };
    }, [enabled, cancel]);
    return {speaking, cancel};
}
