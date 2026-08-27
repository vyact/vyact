import React, {useState, useRef, useEffect, useCallback} from 'react';
import {Mic, Square} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {loadTtsSettings} from '../../services/tts/ttsSettings';
import {
    VOICE_SYSTEM_PROMPTS, LANGUAGES, getLanguageDisplayName, SILENCE_THRESHOLD, SILENCE_DURATION_MS,
    ChatPhase, ChatEntry, VoiceChatModalProps, speakWithKokoroOrFallback, stopAllTts,
} from './voiceChat.types';

const VoiceChatTab: React.FC<{ onSend: VoiceChatModalProps['onSend']; onClose: () => void }> = ({onSend}) => {
    const {t, i18n} = useTranslation('main');
    const [phase, setPhase] = useState<ChatPhase>('setup');
    const [selectedLang, setSelectedLang] = useState('en-US');
    const [chatLog, setChatLog] = useState<ChatEntry[]>([]);
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [statusText, setStatusText] = useState('');

    const logEndRef = useRef<HTMLDivElement>(null);
    const isActiveRef = useRef(false);
    const isSpeakingRef = useRef(false);
    const isWaitingRef = useRef(false);
    const speakAbortRef = useRef<{cancelled: boolean}>({cancelled: false});
    const onSendRef = useRef(onSend);
    const selectedLangRef = useRef(selectedLang);
    const currentSystemPromptRef = useRef<string>('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animFrameRef = useRef<number | null>(null);
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
    }, []);

    const stopAll = useCallback((): void => {
        isActiveRef.current = false;
        isSpeakingRef.current = false;
        isWaitingRef.current = false;
        stopRecording();
        speakAbortRef.current.cancelled = true;
        stopAllTts();
        setIsListening(false);
        setIsSpeaking(false);
        setIsWaiting(false);
        setStatusText('');
    }, [stopRecording]);

    // 탭 전환 시 중단
    useEffect(() => {
        const handler = () => stopAll();
        window.addEventListener('voiceTabChange', handler);
        return () => window.removeEventListener('voiceTabChange', handler);
    }, [stopAll]);

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
        if (!isActiveRef.current || isSpeakingRef.current || isWaitingRef.current) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
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
                if (!isActiveRef.current || isSpeakingRef.current || isWaitingRef.current) return;
                const blob = new Blob(audioChunksRef.current, {type: mimeType});
                audioChunksRef.current = [];
                if (blob.size < 1000) {
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
                    formData.append('lang', selectedLangRef.current);
                    const res = await fetch('/api/stt', {method: 'POST', body: formData});
                    const data = await res.json();
                    const spoken = (data.text || '').trim();
                    if (!spoken) {
                        isWaitingRef.current = false;
                        setIsWaiting(false);
                        setTimeout(() => startListeningRef.current(), 300);
                        return;
                    }
                    setChatLog(prev => [...prev, {
                        role: 'user',
                        text: spoken,
                        timestamp: new Date().toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'})
                    }]);
                    setStatusText(t('voiceChat.waitingForResponse'));
                    const systemPrompt = currentSystemPromptRef.current || (VOICE_SYSTEM_PROMPTS[selectedLangRef.current] ?? VOICE_SYSTEM_PROMPTS['ko-KR']);
                    onSendRef.current(spoken, systemPrompt, true);
                } catch {
                    isWaitingRef.current = false;
                    setIsWaiting(false);
                    setStatusText(t('voiceChat.retrying'));
                    setTimeout(() => startListeningRef.current(), 1000);
                }
            };
            recorder.start();
            setIsListening(true);
            setStatusText(t('voiceChat.speakNow'));
            startSilenceDetection(analyser, () => {
                if (mediaRecorderRef.current?.state === 'recording') stopRecording();
            }, true);
        } catch {
            setStatusText(t('voiceChat.microphoneFailed'));
        }
    }, [stopRecording, t]);

    useEffect(() => {
        startListeningRef.current = startListening;
    }, [startListening]);

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

    const handleStart = async () => {
        setPhase('chatting');
        setChatLog([]);
        setStatusText(t('voiceChat.preparing'));
        isActiveRef.current = true;
        try {
            const res = await fetch('/api/system-prompts/current');
            const data = await res.json();
            currentSystemPromptRef.current = data?.content || '';
        } catch {
            currentSystemPromptRef.current = '';
        }
        setTimeout(() => startListeningRef.current(), 300);
    };

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
            speakAndListen(text);
        };
        window.addEventListener('voiceChatResponse', handler);
        return () => window.removeEventListener('voiceChatResponse', handler);
    }, [speakAndListen]);

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
                {chatLog.length === 0 && <div className="vc-chat-empty">{t('voiceChat.emptyConversation')}</div>}
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
