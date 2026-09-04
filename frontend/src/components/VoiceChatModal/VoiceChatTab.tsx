import CustomSelect from '../CustomSelect/CustomSelect';
import {useStreamingReadAloud} from './useStreamingReadAloud';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import React, {useState, useRef, useEffect, useCallback} from 'react';
import {ArrowUp, Mic, Square} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {loadTtsSettings, updateTtsCache, TTS_SETTINGS_CHANGED, TTS_RATE_OPTIONS, normalizeTtsRate} from '../../services/tts/ttsSettings';
import {api} from '../../services/api';
import {
    VOICE_SYSTEM_PROMPTS, LANGUAGES, getLanguageDisplayName, SILENCE_THRESHOLD, SILENCE_DURATION_MS,
    ChatPhase, ChatEntry, VoiceChatModalProps, speakWithKokoroOrFallback, stopAllTts,
} from './voiceChat.types';


interface VoiceChatTabProps {
    onSend: VoiceChatModalProps['onSend'];
    onClose: () => void;
    mode?: 'practice' | 'assistant';
    variant?: 'panel' | 'inline';
    inputValue?: string;
    deferListening?: boolean;
}

const VoiceChatTab: React.FC<VoiceChatTabProps> = ({
    onSend, onClose, mode = 'practice', variant = 'panel', inputValue = '', deferListening = false,
}) => {
    const {t, i18n} = useTranslation('main');
    const isAssistantMode = mode === 'assistant';
    const [phase, setPhase] = useState<ChatPhase>(isAssistantMode ? 'chatting' : 'setup');
    const [selectedLang, setSelectedLang] = useState(isAssistantMode ? (i18n.resolvedLanguage || i18n.language) : 'en-US');
    const [chatLog, setChatLog] = useState<ChatEntry[]>([]);
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [isPreparing, setIsPreparing] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [audioLevel, setAudioLevel] = useState(0);
    const [autoRead, setAutoRead] = useState(false);
    const [autoReadRate, setAutoReadRate] = useState(() => loadTtsSettings().rate);
    const [autoReadReady, setAutoReadReady] = useState(false);
    const [savingAutoRead, setSavingAutoRead] = useState(false);
    const readAloud = useStreamingReadAloud(isAssistantMode && autoRead, selectedLang, autoReadRate);
    const deferListeningRef = useRef(deferListening);
    deferListeningRef.current = deferListening;

    useEffect(() => {
        if (!isAssistantMode) return;
        let active = true;
        fetch('/api/settings/voice-auto-read').then(async response => {
            if (!response.ok) throw new Error('Settings unavailable');
            const data = await response.json();
            if (active) {
                setAutoRead(data.enabled === true);
                setAutoReadRate(normalizeTtsRate(data.rate ?? 1));
                updateTtsCache({...loadTtsSettings(), rate: data.rate ?? 1});
            }
        }).catch(() => {}).finally(() => { if (active) setAutoReadReady(true); });
        return () => { active = false; };
    }, [isAssistantMode]);

    useEffect(() => {
        const syncRate = () => setAutoReadRate(loadTtsSettings().rate);
        window.addEventListener(TTS_SETTINGS_CHANGED, syncRate);
        return () => window.removeEventListener(TTS_SETTINGS_CHANGED, syncRate);
    }, []);

    const saveAutoRead = async (next: boolean, rate: number) => {
        const previousEnabled = autoRead;
        const previousRate = autoReadRate;
        setAutoReadRate(rate);
        setAutoRead(next);
        if (!next) readAloud.cancel();
        setSavingAutoRead(true);
        try {
            const response = await fetch('/api/settings/voice-auto-read', {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({enabled: next, rate}),
            });
            if (!response.ok) throw new Error('Save failed');
            updateTtsCache({...loadTtsSettings(), rate});
        } catch {
            setAutoRead(previousEnabled);
            setAutoReadRate(previousRate);
            toast.warning(t('voiceChat.autoReadSaveFailed'));
        } finally { setSavingAutoRead(false); }
    };

    const logEndRef = useRef<HTMLDivElement>(null);
    const isActiveRef = useRef(false);
    const isSpeakingRef = useRef(false);
    const isWaitingRef = useRef(false);
    const speakAbortRef = useRef<{cancelled: boolean}>({cancelled: false});
    const onSendRef = useRef(onSend);
    const selectedLangRef = useRef(selectedLang);
    const currentSystemPromptRef = useRef<string>('');
    const startingListeningRef = useRef(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animFrameRef = useRef<number | null>(null);
    const startListeningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const submitRequestedRef = useRef(false);
    const inputValueRef = useRef(inputValue);
    const startListeningRef = useRef<() => void>(() => {
    });
    const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

    useEffect(() => {
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) voicesRef.current = voices;
        };
        loadVoices();
        window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
        return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    }, []);

    useEffect(() => {
        onSendRef.current = onSend;
    }, [onSend]);

    useEffect(() => {
        inputValueRef.current = inputValue;
    }, [inputValue]);

    useEffect(() => {
        selectedLangRef.current = selectedLang;
    }, [selectedLang]);
    useEffect(() => {
        logEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [chatLog]);

    const stopRecording = useCallback((): void => {
        if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        analyserRef.current = null;
        setAudioLevel(0);
    }, []);

    const stopAll = useCallback((): void => {
        isActiveRef.current = false;
        isSpeakingRef.current = false;
        isWaitingRef.current = false;
        stopRecording();
        readAloud.cancel();
        speakAbortRef.current.cancelled = true;
        stopAllTts();
        setIsListening(false);
        setIsSpeaking(false);
        setIsWaiting(false);
        setIsPreparing(false);
        setStatusText('');
    }, [stopRecording, readAloud.cancel]);

    // 탭 전환 시 중단
    useEffect(() => {
        const handler = () => stopAll();
        window.addEventListener('voiceTabChange', handler);
        return () => window.removeEventListener('voiceTabChange', handler);
    }, [stopAll]);

    useEffect(() => () => {
        isActiveRef.current = false;
        speakAbortRef.current.cancelled = true;
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (startListeningTimerRef.current) clearTimeout(startListeningTimerRef.current);
        if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
        streamRef.current?.getTracks().forEach(track => track.stop());
        stopAllTts();
    }, []);

    const startSilenceDetection = (analyser: AnalyserNode, onSilence: () => void, waitForSpeech = false) => {
        const data = new Uint8Array(analyser.fftSize);
        let silenceStart: number | null = null;
        let hasSpeech = !waitForSpeech; // waitForSpeech=true면 말 시작 전 무음 무시
        const tick = () => {
            if (!isActiveRef.current) return;
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                const v = (data[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            setAudioLevel(Math.min(1, rms / 0.18));
            if (rms >= SILENCE_THRESHOLD) {
                hasSpeech = true;
                silenceStart = null;
            } else if (hasSpeech) {
                if (silenceStart === null) silenceStart = Date.now();
                else if (Date.now() - silenceStart > SILENCE_DURATION_MS) {
                    onSilence();
                    return;
                }
            }
            animFrameRef.current = requestAnimationFrame(tick);
        };
        animFrameRef.current = requestAnimationFrame(tick);
    };

    const startListening = useCallback(async () => {
        if (!isActiveRef.current || isSpeakingRef.current || isWaitingRef.current || deferListeningRef.current) return;
        if (startingListeningRef.current || mediaRecorderRef.current?.state === 'recording') return;
        startingListeningRef.current = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            if (!isActiveRef.current || isSpeakingRef.current || isWaitingRef.current || deferListeningRef.current) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            streamRef.current = stream;
            const audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            analyserRef.current = analyser;
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : 'audio/webm';
            const recorder = new MediaRecorder(stream, {mimeType});
            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
                if (!isActiveRef.current || isSpeakingRef.current || isWaitingRef.current || deferListeningRef.current) return;
                const submitRequested = submitRequestedRef.current;
                submitRequestedRef.current = false;
                const blob = new Blob(audioChunksRef.current, {type: mimeType});
                audioChunksRef.current = [];
                if (blob.size < 1000) {
                    if (submitRequested && inputValueRef.current.trim()) {
                        isWaitingRef.current = true;
                        setIsWaiting(true);
                        setStatusText(t('voiceChat.waitingForResponse'));
                        onSendRef.current('', undefined, false);
                        return;
                    }
                    setTimeout(() => startListeningRef.current(), 300);
                    return;
                }
                setIsListening(false);
                isWaitingRef.current = true;
                setIsWaiting(true);
                setStatusText(t('voiceChat.recognizing'));
                try {
                    const formData = new FormData();
                    const ext = mimeType.includes('ogg') ? '.ogg' : '.webm';
                    formData.append('audio', blob, `audio${ext}`);
                    formData.append('lang', isAssistantMode ? 'auto' : selectedLangRef.current);
                    const res = await fetch('/api/stt', {method: 'POST', body: formData});
                    const data = await res.json();
                    const spoken = (data.text || '').trim();
                    if (!spoken) {
                        if (submitRequested && inputValueRef.current.trim()) {
                            setStatusText(t('voiceChat.waitingForResponse'));
                            onSendRef.current('', undefined, false);
                            return;
                        }
                        isWaitingRef.current = false;
                        setIsWaiting(false);
                        setTimeout(() => startListeningRef.current(), 300);
                        return;
                    }
                    if (isAssistantMode && typeof data.lang === 'string' && data.lang) {
                        selectedLangRef.current = data.lang;
                        setSelectedLang(data.lang);
                    }
                    setChatLog(prev => [...prev, {
                        role: 'user',
                        text: spoken,
                        timestamp: new Date().toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'})
                    }]);
                    setStatusText(t('voiceChat.waitingForResponse'));
                    if (isAssistantMode) {
                        onSendRef.current(spoken, undefined, false);
                    } else {
                        const systemPrompt = currentSystemPromptRef.current || (VOICE_SYSTEM_PROMPTS[selectedLangRef.current] ?? VOICE_SYSTEM_PROMPTS['ko-KR']);
                        onSendRef.current(spoken, systemPrompt, true);
                    }
                } catch {
                    isWaitingRef.current = false;
                    setIsWaiting(false);
                    setStatusText(t('voiceChat.retrying'));
                    setTimeout(() => startListeningRef.current(), 1000);
                }
            };
            recorder.start();
            setIsPreparing(false);
            setIsListening(true);
            setStatusText(t('voiceChat.speakNow'));
            startSilenceDetection(analyser, () => {
                if (mediaRecorderRef.current?.state === 'recording') stopRecording();
            }, true);
        } catch {
            setIsPreparing(false);
            setStatusText(t('voiceChat.microphoneFailed'));
        } finally { startingListeningRef.current = false; }
    }, [isAssistantMode, stopRecording, t]);

    useEffect(() => {
        startListeningRef.current = startListening;
    }, [startListening]);

    useEffect(() => {
        if (!isAssistantMode || !isActiveRef.current) return;
        isSpeakingRef.current = readAloud.speaking;
        setIsSpeaking(readAloud.speaking);
        if (deferListening || readAloud.speaking) {
            isWaitingRef.current = true;
            setIsWaiting(true);
            stopRecording();
            setIsListening(false);
            setStatusText(t(readAloud.speaking ? 'voiceChat.readingResponse' : 'voiceChat.waitingForResponse'));
        } else {
            isWaitingRef.current = false;
            setIsWaiting(false);
            const timer = setTimeout(() => startListeningRef.current(), 300);
            return () => clearTimeout(timer);
        }
    }, [deferListening, isAssistantMode, readAloud.speaking, stopRecording, t]);

    const speakAndListen = useCallback((text: string) => {
        if (!isActiveRef.current) return;
        isSpeakingRef.current = true;
        isWaitingRef.current = false;
        setIsSpeaking(true);
        setStatusText(t('voiceChat.readingResponse'));
        const settings = loadTtsSettings();
        const lang = selectedLangRef.current;

        const abortSignal = {cancelled: false};
        speakAbortRef.current = abortSignal;

        speakWithKokoroOrFallback(text, lang, settings, abortSignal).then(() => {
            if (!isActiveRef.current) return;
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            setTimeout(() => startListeningRef.current(), 300);
        });
    }, [t]);

    const handleStart = useCallback(async () => {
        setPhase('chatting');
        setChatLog([]);
        setIsPreparing(true);
        setStatusText(t('voiceChat.preparing'));
        isActiveRef.current = true;
        if (!isAssistantMode) {
            try {
                const res = await fetch('/api/system-prompts/current');
                const data = await res.json();
                currentSystemPromptRef.current = data?.content || '';
            } catch {
                currentSystemPromptRef.current = '';
            }
        }
        const systemPrompt = currentSystemPromptRef.current
            || (VOICE_SYSTEM_PROMPTS[selectedLangRef.current] ?? VOICE_SYSTEM_PROMPTS['ko-KR']);
        if (!isAssistantMode) {
            try {
                await api.warmVoiceChat(systemPrompt);
            } catch {
                // Prefix warm-up is an optimization; voice chat should still start if it fails.
            }
        }
        if (startListeningTimerRef.current) clearTimeout(startListeningTimerRef.current);
        startListeningTimerRef.current = setTimeout(() => {
            startListeningTimerRef.current = null;
            startListeningRef.current();
        }, 300);
    }, [isAssistantMode, t]);

    useEffect(() => {
        if (!isAssistantMode || isActiveRef.current) return;
        if (deferListening) {
            setIsPreparing(true);
            setStatusText(t('voiceChat.waitingForResponse'));
            return;
        }
        void handleStart();
    }, [deferListening, handleStart, isAssistantMode, t]);

    useEffect(() => {
        const handler = (event: Event) => {
            if (!isActiveRef.current) return;
            const text = (event as CustomEvent<{text?: unknown}>).detail?.text;
            if (typeof text !== 'string' || !text) return;
            setChatLog(prev => [...prev, {
                role: 'assistant',
                text,
                timestamp: new Date().toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'})
            }]);
            isWaitingRef.current = false;
            setIsWaiting(false);
            if (!isAssistantMode) {
                speakAndListen(text);
            }
        };
        window.addEventListener('voiceChatResponse', handler);
        return () => window.removeEventListener('voiceChatResponse', handler);
    }, [isAssistantMode, speakAndListen, autoRead]);

    if (variant === 'inline') {
        const submitImmediately = () => {
            if (isListening && mediaRecorderRef.current?.state === 'recording') {
                submitRequestedRef.current = true;
                stopRecording();
                return;
            }
            if (inputValueRef.current.trim()) {
                isWaitingRef.current = true;
                setIsWaiting(true);
                setStatusText(t('voiceChat.waitingForResponse'));
                onSendRef.current('', undefined, false);
            }
        };
        return (
            <div className="voice-assistant-inline">
                <div className="voice-assistant-inline__status" role="status" aria-live="polite">
                    <span className={`voice-assistant-inline__status-dot${isListening ? ' is-listening' : ''}`} aria-hidden="true"/>
                    <span>{statusText || t('voiceChat.preparing')}</span>
                </div>
                <div className="voice-assistant-inline__controls">
                    <button type="button" className={`voice-auto-read-switch${autoRead ? ' is-on' : ''}`}
                            role="switch" aria-checked={autoRead} disabled={!autoReadReady || savingAutoRead}
                            onClick={() => void saveAutoRead(!autoRead, autoReadRate)}>
                        <span>{t('voiceChat.autoRead')}</span><i aria-hidden="true"/>
                    </button>
                    <CustomSelect className="voice-auto-read-rate" dropdownClassName="voice-auto-read-rate-menu"
                        placeholder={t('voiceChat.speedMultiplier', {rate: autoReadRate})} ariaLabel={t('voiceChat.autoReadSpeed')}
                        options={TTS_RATE_OPTIONS.map(rate => ({value: String(rate), label: t('voiceChat.speedMultiplier', {rate})}))}
                        value={String(autoReadRate)} onChange={value => void saveAutoRead(autoRead, Number(value))}
                        disabled={!autoReadReady || savingAutoRead} searchable={false} portal/>
                    <div className={`voice-assistant-inline__waveform${isListening ? ' is-listening' : ''}`}
                         aria-hidden="true">
                        {Array.from({length: 18}, (_, index) => {
                            const shape = 0.35 + ((index * 7) % 11) / 16;
                            const height = 3 + Math.round(audioLevel * shape * 19);
                            return <span key={index} style={{height: `${height}px`}}/>;
                        })}
                    </div>
                    <button type="button" className="voice-assistant-inline__button"
                            onClick={() => { stopAll(); onClose(); }}
                            aria-label={t('voiceChat.end')}>
                        <Square size={12} fill="currentColor"/>
                    </button>
                    <button type="button" className="voice-assistant-inline__button voice-assistant-inline__button--send"
                            onClick={submitImmediately} disabled={deferListening || (!isListening && !inputValue.trim())}
                            aria-label={t('chatInput.send')}>
                        <ArrowUp size={18}/>
                    </button>
                </div>
            </div>
        );
    }

    if (phase === 'setup') return (
        <div className="vc-setup">
            <div className="vc-section-label">{t('voiceChat.languageSelect')}</div>
            <div className="vc-lang-grid">
                {LANGUAGES.map(lang => (
                    <button key={lang.code} className={`vc-lang-btn${selectedLang === lang.code ? ' selected' : ''}`}
                            onClick={() => setSelectedLang(lang.code)}>
                        <span className="vc-lang-flag">{lang.flag}</span>
                        <span className="vc-lang-label">{getLanguageDisplayName(lang.code, i18n.language)}</span>
                    </button>
                ))}
            </div>
            <p className="vc-hint">{t('voiceChat.ttsHint')}</p>
            <button className="vc-start-btn" onClick={handleStart}>
                <Mic size={18} aria-hidden/>
                {t('voiceChat.start')}
            </button>
        </div>
    );

    return (
        <>
            <div className="vc-status">
                <div
                    className={`vc-status-dot${isListening ? ' listening' : isSpeaking ? ' speaking' : isWaiting ? ' waiting' : ''}`}/>
                <span>{statusText || t('voiceChat.waiting')}</span>
            </div>
            <div className="vc-chat-log">
                {chatLog.length === 0 && (
                    <div className="vc-chat-empty">
                        {t(isPreparing ? 'voiceChat.preparingConversation' : 'voiceChat.emptyConversation')}
                    </div>
                )}
                {chatLog.map((entry, i) => (
                    <div key={i} className={`vc-chat-entry ${entry.role}`}>
                        <div className="vc-chat-bubble">{entry.text}</div>
                        <div className="vc-chat-time">{entry.timestamp}</div>
                    </div>
                ))}
                <div ref={logEndRef}/>
            </div>
            <div className="vc-footer">
                <button className="vc-stop-btn" onClick={() => {
                    stopAll();
                    setPhase('setup');
                    setChatLog([]);
                }}>
                    <Square size={15} fill="currentColor" aria-hidden/>
                    {t('voiceChat.end')}
                </button>
            </div>
        </>
    );
};

export default VoiceChatTab;
