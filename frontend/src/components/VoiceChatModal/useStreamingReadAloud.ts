import {WebSpeechTtsProvider} from '../../services/tts/WebSpeechTtsProvider';
import {setAutoReadMessage} from '../../services/tts/autoReadState';
import {splitSpeechBuffer} from '../../services/tts/speechBuffer';
import {useCallback, useEffect, useRef, useState} from 'react';
import {loadTtsSettings} from '../../services/tts/ttsSettings';
import {speakWithKokoroOrFallback, stopAllTts} from './voiceChat.types';

const speechSegmenter = new WebSpeechTtsProvider();

export function useStreamingReadAloud(enabled: boolean, language: string, rate = 1) {
    const [speaking, setSpeaking] = useState(false);
    const state = useRef({buffer: '', queue: [] as string[], running: false, streamed: false, code: false, followups: false, abort: {cancelled: false}});
    const messageIdRef = useRef<string | null>(null);
    const stoppedRef = useRef(false);
    const rateRef = useRef(rate);
    rateRef.current = rate;
    const languageRef = useRef(language);
    languageRef.current = language;
    const cancel = useCallback(() => {
        state.current.abort.cancelled = true;
        state.current = {buffer: '', queue: [], running: false, streamed: false, code: false, followups: false, abort: {cancelled: false}};
        setAutoReadMessage(null);
        stopAllTts();
        setSpeaking(false);
    }, []);
    useEffect(() => {
        if (!enabled) { cancel(); return; }
        const enqueue = (text: string, final: boolean) => {
            if (stoppedRef.current) return;
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
            setAutoReadMessage(messageIdRef.current);
            void (async () => {
                try {
                    while (current.queue.length && !current.abort.cancelled) {
                        const segments = speechSegmenter.splitToSegments(current.queue.shift()!);
                        for (const segment of segments) {
                            if (current.abort.cancelled) break;
                            await speakWithKokoroOrFallback(segment.text, segment.lang || languageRef.current,
                                {...loadTtsSettings(), rate: rateRef.current}, current.abort, true);
                        }
                    }
                } catch {
                    current.queue = [];
                } finally {
                    if (state.current === current) { current.running = false; setSpeaking(false); setAutoReadMessage(null); }
                }
            })();
        };
        const start = (event: Event) => {
            cancel();
            stoppedRef.current = false;
            messageIdRef.current = (event as CustomEvent<{messageId: string}>).detail.messageId;
        };
        const stopResponse = () => { stoppedRef.current = true; cancel(); };
        const chunk = (event: Event) => {
            state.current.streamed = true;
            enqueue((event as CustomEvent<string>).detail, false);
        };
        const done = (event: Event) => {
            const text = (event as CustomEvent<{text: string}>).detail.text;
            enqueue(state.current.streamed ? '' : text, true);
        };
        const end = () => enqueue('', true);
        window.addEventListener('voiceReadStopResponse', stopResponse);
        window.addEventListener('voiceReadStart', start);
        window.addEventListener('voiceReadChunk', chunk);
        window.addEventListener('voiceChatResponse', done);
        window.addEventListener('voiceReadEnd', end);
        window.addEventListener('voiceReadCancel', cancel);
        return () => {
            window.removeEventListener('voiceReadStopResponse', stopResponse);
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
