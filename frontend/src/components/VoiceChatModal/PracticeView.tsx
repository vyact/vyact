import React, {useState, useRef, useEffect} from 'react';
import {ArrowLeft, ChevronLeft, ChevronRight, Mic, Pencil, Play, RotateCcw, Square, Volume2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {loadTtsSettings} from '../../services/tts/ttsSettings';
import {
    SILENCE_THRESHOLD, SILENCE_DURATION_MS,
    PracticePhase, ScriptDoc, speakWithKokoroOrFallback, stopAllTts,
} from './voiceChat.types';

// ── 타이밍 상수 ───────────────────────────────────────────
const PLAY_ALL_AB_DELAY_MS = 800;   // 전체 재생: A→B 사이 딜레이
const PLAY_ALL_PAIR_DELAY_MS = 1000;  // 전체 재생: 쌍 간 딜레이
const CORRECT_PAUSE_MS = 400;   // 정답 후 B 재생 전 딜레이
const WRONG_BANNER_MS = 5000;  // 오답 배너 표시 지속시간 (새 오답 발생 시 갱신되어 다시 5초)
const RETRY_RECORD_DELAY_MS = 300;   // 오답 후 재녹음 시작 전 최소 딜레이(오디오 장치 리셋용, 인식 자체는 거의 즉시 재개)
const MIN_SPEECH_CONFIRM_MS = 200;   // 마이크 노이즈/클릭 오검출 방지 — 이 시간 이상 지속돼야 "말 시작"으로 확정
const AFTER_B_DELAY_MS = 300;   // B 재생 후 다음으로 넘어가기 전 딜레이
const BEFORE_B_RECORD_MS = 300;   // B모드: A 재생 후 녹음 시작 전 딜레이
const CORRECT_B_PAUSE_MS = 600;   // B모드 정답 후 딜레이

// ── 영어 숫자 단어 → 아라비아 숫자 정규화 ──────────────────────
// 스크립트 원문은 "7"/"27th"/"1997"처럼 숫자로 써있는데, STT는 발화 그대로
// "seven"/"twenty-seventh"/"nineteen ninety-seven"으로 인식하는 경우가 많아
// 문자열 비교가 항상 불일치로 나온다. 기수/서수/연도 읽기 방식까지 아라비아
// 숫자 표기로 통일해서 비교한다.
const ONES: Record<string, number> = {
    zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = {hundred: 100, thousand: 1000, million: 1000000};

// 서수 단어 → 대응 기수(cardinal) 값. 값 자체는 ONES/TENS/SCALE과 동일하게 취급하고
// "이 토큰이 서수였다"는 사실만 별도로 추적해서 최종 출력에 "st/nd/rd/th"를 붙인다.
const ORD_ONES: Record<string, number> = {
    zeroth: 0, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
    tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
    sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
};
const ORD_TENS: Record<string, number> = {
    twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90,
};
const ORD_SCALE: Record<string, number> = {hundredth: 100, thousandth: 1000, millionth: 1000000};

function ordinalSuffix(n: number): string {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return 'th';
    switch (n % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

type NumKind = { cat: 'ones' | 'tens' | 'scale'; val: number; ord: boolean };

function kindOf(tok: string): NumKind | null {
    if (tok in ONES) return {cat: 'ones', val: ONES[tok], ord: false};
    if (tok in TENS) return {cat: 'tens', val: TENS[tok], ord: false};
    if (tok in SCALE) return {cat: 'scale', val: SCALE[tok], ord: false};
    if (tok in ORD_ONES) return {cat: 'ones', val: ORD_ONES[tok], ord: true};
    if (tok in ORD_TENS) return {cat: 'tens', val: ORD_TENS[tok], ord: true};
    if (tok in ORD_SCALE) return {cat: 'scale', val: ORD_SCALE[tok], ord: true};
    return null;
}

type NumGroup = { value: number; end: number; isOrdinal: boolean };

// 토큰 배열의 start 위치에서 시작하는 "숫자 표현 하나"를 최대한 파싱한다.
// 문법 규칙: [tens [+ ones]] | [ones/teen]  (base)
//            base 뒤에 (scale ['and' + 하위 숫자표현])* 반복 가능
// base가 이미 소비된 상태에서 scale 없이 다시 tens/ones가 나오면 그건 "새로운 숫자"이므로
// 여기서 멈춘다 — 연도처럼 두 숫자를 이어 읽는 패턴을 구분해내는 핵심 지점이다.
function parseNumGroup(tokens: string[], start: number): NumGroup | null {
    let i = start;
    let value = 0;
    let consumedAny = false;
    let isOrdinal = false;
    let baseDone = false;
    let tensJustConsumed = false;

    while (i < tokens.length) {
        const info = kindOf(tokens[i]);
        if (!info) break;

        if (info.cat === 'tens') {
            if (baseDone) break; // 이미 base 완료 후 scale 없이 또 tens → 새 숫자 (twenty twenty 방지)
            value += info.val;
            consumedAny = true;
            baseDone = true; // tens는 한 번만 — 뒤에 ones 1개만 추가로 붙을 수 있음
            if (info.ord) { isOrdinal = true; i++; break; }
            i++;
            tensJustConsumed = true;
            continue;
        }
        if (info.cat === 'ones') {
            if (baseDone && !tensJustConsumed) break; // base 완료 후 scale 없이 또 ones → 새 숫자
            value += info.val;
            consumedAny = true;
            i++;
            baseDone = true;
            tensJustConsumed = false;
            if (info.ord) { isOrdinal = true; break; }
            continue;
        }
        // scale (hundred/thousand/million)
        value = (value || 1) * info.val;
        consumedAny = true;
        i++;
        baseDone = false; // scale 이후엔 새 base(나머지 자릿수)를 다시 받을 수 있음
        tensJustConsumed = false;
        if (info.ord) { isOrdinal = true; break; }
        if (tokens[i] === 'and') i++; // "one hundred and seven"
    }
    if (!consumedAny) return null;
    return {value, end: i, isOrdinal};
}

function formatNumGroup(g: NumGroup): string {
    return g.isOrdinal ? `${g.value}${ordinalSuffix(g.value)}` : String(g.value);
}

// 구간 내 scale(hundred/thousand 등) 토큰 사용 여부 — 연도 이어붙이기 판정에 사용
function usedScaleInRange(tokens: string[], s: number, e: number): boolean {
    for (let k = s; k < e; k++) {
        if (tokens[k] in SCALE || tokens[k] in ORD_SCALE) return true;
    }
    return false;
}

// 연도 읽기 패턴: scale 없이 끝난 "순수 2자리(10~99)" 숫자 그룹이 공백 하나만 두고
// 연속으로 2개 나오면(예: nineteen ninety-seven → 1997, twenty twenty-four → 2024)
// 두 숫자를 이어붙여 4자리로 합친다. 서수/scale이 낀 경우는 대상에서 제외한다.
function wordsToDigits(text: string): string {
    const tokens = text.split(' ');
    const out: string[] = [];
    let i = 0;
    while (i < tokens.length) {
        const g1 = parseNumGroup(tokens, i);
        if (!g1) { out.push(tokens[i]); i++; continue; }
        if (!g1.isOrdinal && g1.value >= 10 && g1.value <= 99 && !usedScaleInRange(tokens, i, g1.end)) {
            const g2 = parseNumGroup(tokens, g1.end);
            if (g2 && !g2.isOrdinal && g2.value >= 0 && g2.value <= 99 && !usedScaleInRange(tokens, g1.end, g2.end)) {
                out.push(String(g1.value * 100 + g2.value));
                i = g2.end;
                continue;
            }
        }
        out.push(formatNumGroup(g1));
        i = g1.end;
    }
    return out.join(' ');
}

const PracticeView: React.FC<{ script: ScriptDoc; onBack: () => void; onEdit: () => void }> = ({
                                                                                                   script,
                                                                                                   onBack,
                                                                                                   onEdit
}) => {
    const {t} = useTranslation('main');
    const pairs = script.pairs ?? [];
    const [currentIdx, setCurrentIdx] = useState(0);
    const [phase, setPhase] = useState<PracticePhase>('idle');
    const [isRunning, setIsRunning] = useState(false);
    const [roleMode, setRoleMode] = useState<'a' | 'b'>('a');
    const [passedSet, setPassedSet] = useState<Set<number>>(new Set());
    const [showKo, setShowKo] = useState(true);
    const [completed, setCompleted] = useState(false);
    const [isPlayingAll, setIsPlayingAll] = useState(false);
    // 오답 배너: phase/음성인식 흐름과 분리된 별도 상태. 배너가 떠 있는 동안에도
    // 곧바로 다음 녹음(listening)이 시작될 수 있고, 그 사이 또 틀리면 배너 내용과
    // 5초 타이머가 새로 갱신(연장)된다.
    const [wrongBanner, setWrongBannerState] = useState<string | null>(null);
    const wrongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isRunningRef = useRef(false);
    const isActiveRef = useRef(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animFrameRef = useRef<number | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const isPlayingAllRef = useRef(false);
    const speakAbortRef = useRef<{cancelled: boolean}>({cancelled: false});
    const lang = script.language ?? 'en-US';

    const stopRecording = () => {
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
    };

    // 오답 배너 표시(5초 지속) — 이미 배너가 떠 있으면 타이머를 새로 시작해서
    // 최신 오답으로 내용을 갱신한다 (5초 이내 또 틀리면 배너가 이어서 갱신됨).
    const showWrongBanner = (text: string) => {
        if (wrongTimerRef.current) clearTimeout(wrongTimerRef.current);
        setWrongBannerState(text);
        wrongTimerRef.current = setTimeout(() => setWrongBannerState(null), WRONG_BANNER_MS);
    };
    const clearWrongBanner = () => {
        if (wrongTimerRef.current) {
            clearTimeout(wrongTimerRef.current);
            wrongTimerRef.current = null;
        }
        setWrongBannerState(null);
    };

    // 실제로 말이 시작된 순간(무음 대기 중이 아니라 음성이 감지된 시점) 호출된다.
    // - 오답 배너가 떠 있었다면 즉시 정리
    // - phase를 곧바로 'checking'으로 올려서 "⏳ 인식 중..." 라벨이 말하는 동안 계속 보이게 함
    //   (말이 끝나고 STT 응답을 기다릴 때까지 자연스럽게 이어짐)
    const handleSpeechStart = () => {
        clearWrongBanner();
        setPhase('checking');
    };

    useEffect(() => () => {
        isActiveRef.current = false;
        isRunningRef.current = false;
        stopRecording();
        speakAbortRef.current.cancelled = true;
        stopAllTts();
        if (wrongTimerRef.current) clearTimeout(wrongTimerRef.current);
    }, []);

    useEffect(() => {
        if (!listRef.current) return;
        const item = listRef.current.children[currentIdx] as HTMLElement;
        if (item) item.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    }, [currentIdx]);

    const speakUtterance = async (text: string, phaseVal: 'playing_a' | 'playing_b'): Promise<void> => {
        setPhase(phaseVal);
        const settings = loadTtsSettings();
        const abortSignal = {cancelled: false};
        speakAbortRef.current = abortSignal;
        await speakWithKokoroOrFallback(text, lang, settings, abortSignal);
    };

    const recordOnce = (_pairIdx: number, onSpeechStart?: () => void): Promise<string> => {
        return (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({audio: true});
                return await new Promise<string>((resolve) => {
                streamRef.current = stream;
                const audioCtx = new AudioContext();
                const source = audioCtx.createMediaStreamSource(stream);
                const analyser = audioCtx.createAnalyser();
                analyser.fftSize = 2048;
                source.connect(analyser);
                analyserRef.current = analyser;
                const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
                const recorder = new MediaRecorder(stream, {mimeType});
                mediaRecorderRef.current = recorder;
                audioChunksRef.current = [];
                recorder.ondataavailable = e => {
                    if (e.data.size > 0) audioChunksRef.current.push(e.data);
                };
                recorder.onstop = async () => {
                    const blob = new Blob(audioChunksRef.current, {type: mimeType});
                    audioChunksRef.current = [];
                    if (blob.size < 500) {
                        resolve('');
                        return;
                    }
                    try {
                        setPhase('processing'); // STT 서버 응답 대기 중임을 표시 ("🔄 결과 확인 중...") — 말하는 중(checking)과 구분
                        const fd = new FormData();
                        fd.append('audio', blob, 'audio.webm');
                        fd.append('lang', lang);
                        const res = await fetch('/api/stt', {method: 'POST', body: fd});
                        const data = await res.json();
                        resolve((data.text ?? '').trim());
                    } catch {
                        resolve('');
                    }
                };
                recorder.start();
                setPhase('listening');
                const dataArr = new Uint8Array(analyser.fftSize);
                let silenceStart: number | null = null;
                let hasSpeech = false; // 말을 시작한 적 있는지 (디바운스 통과 후 확정된 상태)
                let speechCandidateStart: number | null = null; // 임계값 초과가 "막 시작된" 시각(아직 미확정)
                const tick = () => {
                    if (!isActiveRef.current || !isRunningRef.current) {
                        stopRecording();
                        resolve('__cancelled__');
                        return;
                    }
                    analyser.getByteTimeDomainData(dataArr);
                    let sum = 0;
                    for (let i = 0; i < dataArr.length; i++) {
                        const v = (dataArr[i] - 128) / 128;
                        sum += v * v;
                    }
                    const rms = Math.sqrt(sum / dataArr.length);
                    if (rms >= SILENCE_THRESHOLD) {
                        if (!hasSpeech) {
                            // 임계값을 넘은 지 MIN_SPEECH_CONFIRM_MS 이상 지속돼야 "진짜 말 시작"으로
                            // 확정한다 — 마이크 시작 시 순간 노이즈/클릭 한 프레임만으로 오검출되는 것 방지.
                            if (speechCandidateStart === null) speechCandidateStart = Date.now();
                            else if (Date.now() - speechCandidateStart >= MIN_SPEECH_CONFIRM_MS) {
                                hasSpeech = true; // 말 시작 확정
                                onSpeechStart?.(); // 최초 1회 알림 — 오답 배너 즉시 정리 + 인식중 표시
                            }
                        }
                        silenceStart = null;
                    } else {
                        speechCandidateStart = null; // 임계값 미만으로 돌아옴 → 짧은 노이즈였을 뿐, 후보 취소
                        if (hasSpeech) {
                            // 말을 시작한 후 무음 → 종료
                            if (!silenceStart) silenceStart = Date.now();
                            else if (Date.now() - silenceStart > SILENCE_DURATION_MS) {
                                stopRecording();
                                return;
                            }
                        }
                    }
                    // hasSpeech가 false면 계속 대기 (무한 기다림)
                    animFrameRef.current = requestAnimationFrame(tick);
                };
                animFrameRef.current = requestAnimationFrame(tick);
                });
            } catch {
                return '';
            }
        })();
    };

    const runLoop = async (startIdx: number, mode: 'a' | 'b') => {
        isActiveRef.current = true;
        isRunningRef.current = true;
        let idx = startIdx;
        // 다국어 정규화 후 비교
        const norm = (s: string) => {
            const cleaned = s
                .toLowerCase()
                .replace(/[-\u2013\u2014]/g, ' ')              // 하이픈/대시 → 공백
                .replace(/[.,!?\u00BF\u00A1;:]/g, '')          // 영어/스페인어 구두점
                .replace(/[\u2018\u2019\u201A\u201B\u201C\u201D'"]/g, '') // 따옴표 전부
                .replace(/[\u3002\uFF01\uFF1F\u3001\uFF0C\uFF1B\uFF1A\u30FB]/g, '') // 일중 구두점
                .replace(/[\u0E46\u0E2F]/g, '')                  // 태국어 특수
                .replace(/\s+/g, ' ')                             // 다중 공백
                .trim();
            // "seven" ↔ "7"처럼 숫자 단어/아라비아 숫자 표기 차이를 흡수
            return wordsToDigits(cleaned);
        };

        while (isRunningRef.current && idx < pairs.length) {
            setCurrentIdx(idx);
            const pair = pairs[idx];
            if (mode === 'a') {
                setPhase('listening');
                const spoken = await recordOnce(idx, handleSpeechStart);
                if (!isRunningRef.current || spoken === '__cancelled__') break;
                if (norm(spoken) === norm(pair.a)) {
                    clearWrongBanner();
                    setPhase('correct');
                    setPassedSet(prev => new Set([...prev, idx]));
                    await new Promise(r => setTimeout(r, CORRECT_PAUSE_MS));
                    if (!isRunningRef.current) break;
                    await speakUtterance(pair.b, 'playing_b');
                    if (!isRunningRef.current) break;
                    await new Promise(r => setTimeout(r, AFTER_B_DELAY_MS));
                    idx++;
                } else {
                    // 오답 배너는 5초간(또는 다음 오답이 나올 때까지) 독립적으로 표시되고,
                    // 음성 인식(듣기)은 배너와 무관하게 거의 바로 재개된다.
                    showWrongBanner(spoken);
                    await new Promise(r => setTimeout(r, RETRY_RECORD_DELAY_MS));
                    if (!isRunningRef.current) break;
                }
            } else {
                // TTS가 A 읽기 → 내가 B 말하기
                await speakUtterance(pair.a, 'playing_a');
                if (!isRunningRef.current) break;

                // B 재시도 루프: 맞을 때까지 B만 반복
                let bPassed = false;
                while (isRunningRef.current) {
                    await new Promise(r => setTimeout(r, BEFORE_B_RECORD_MS));
                    setPhase('listening');
                    const spoken = await recordOnce(idx, handleSpeechStart);
                    if (!isRunningRef.current || spoken === '__cancelled__') break;
                    if (norm(spoken) === norm(pair.b)) {
                        clearWrongBanner();
                        setPhase('correct');
                        setPassedSet(prev => new Set([...prev, idx]));
                        await new Promise(r => setTimeout(r, CORRECT_B_PAUSE_MS));
                        bPassed = true;
                        break;
                    } else {
                        showWrongBanner(spoken);
                        await new Promise(r => setTimeout(r, RETRY_RECORD_DELAY_MS));
                        if (!isRunningRef.current) break;
                        // A 재생 없이 바로 B 다시 시도
                    }
                }
                if (!isRunningRef.current) break;
                if (bPassed) idx++;
            }
        }
        isRunningRef.current = false;
        setIsRunning(false);
        if (idx >= pairs.length) {
            setCompleted(true);
        }
        setPhase('idle');
    };

    // 전체 대화 순서대로 재생
    const playAll = async () => {
        if (isPlayingAllRef.current) {
            speakAbortRef.current.cancelled = true;
            stopAllTts();
            isPlayingAllRef.current = false;
            setIsPlayingAll(false);
            setPhase('idle');
            return;
        }
        isPlayingAllRef.current = true;
        setIsPlayingAll(true);
        for (let i = 0; i < pairs.length; i++) {
            if (!isPlayingAllRef.current) break;
            const p = pairs[i];
            setCurrentIdx(i);
            await speakUtterance(p.a, 'playing_a');
            if (!isPlayingAllRef.current) break;
            await new Promise(r => setTimeout(r, PLAY_ALL_AB_DELAY_MS));
            await speakUtterance(p.b, 'playing_b');
            if (!isPlayingAllRef.current) break;
            await new Promise(r => setTimeout(r, PLAY_ALL_PAIR_DELAY_MS));
        }
        isPlayingAllRef.current = false;
        setIsPlayingAll(false);
        setPhase('idle');
    };

    const handleStart = () => {
        setIsRunning(true);
        clearWrongBanner();
        setCompleted(false);
        if (completed) {
            setCurrentIdx(0);
            setPassedSet(new Set());
        }
        runLoop(completed ? 0 : currentIdx, roleMode);
    };

    const handleStop = () => {
        isRunningRef.current = false;
        isActiveRef.current = false;
        isPlayingAllRef.current = false;
        stopRecording();
        speakAbortRef.current.cancelled = true;
        stopAllTts();
        setIsRunning(false);
        setIsPlayingAll(false);
        setPhase('idle');
        clearWrongBanner();
    };

    const handleRoleToggle = () => {
        if (isRunning) handleStop();
        setRoleMode(prev => prev === 'a' ? 'b' : 'a');
        setPassedSet(new Set());
        setPhase('idle');
        setCompleted(false);
        setCurrentIdx(0);
        clearWrongBanner();
    };

    const goTo = (idx: number) => {
        setCurrentIdx(idx);
        setPhase('idle');
        clearWrongBanner();
    };

    if (pairs.length === 0) return <div className="sp-empty">{t('voiceChat.noScriptPairs')}</div>;

    const phaseLabel = roleMode === 'a' ? {
        idle: t('voiceChat.practiceStart'),
        listening: t('voiceChat.sayASentence'),
        checking: t('voiceChat.listening'),
        processing: t('voiceChat.checkingResult'),
        correct: t('voiceChat.correct'),
        wrong: t('voiceChat.tryAgain'),
        playing_b: t('voiceChat.playing'),
        playing_a: t('voiceChat.playing'),
    }[phase] : {
        idle: t('voiceChat.practiceStart'),
        listening: t('voiceChat.sayBSentence'),
        checking: t('voiceChat.listening'),
        processing: t('voiceChat.checkingResult'),
        correct: t('voiceChat.correct'),
        wrong: t('voiceChat.tryAgain'),
        playing_b: t('voiceChat.playing'),
        playing_a: t('voiceChat.readingASentence'),
    }[phase];

    const myTalking = roleMode;

    return (
        <div className="sp-practice">
            <div className="sp-practice-nav">
                <button className="sp-back-btn" onClick={() => {
                    handleStop();
                    onBack();
                }}><ArrowLeft size={16}/>{t('voiceChat.backToList')}
                </button>
                <span className="sp-practice-title">{script.title}</span>
                <div className="sp-practice-actions">
                    <button className={`sp-play-all-btn${isPlayingAll ? ' playing' : ''}`} onClick={playAll}
                            disabled={isRunning} aria-label={t('voiceChat.playAll')}>
                        {isPlayingAll
                            ? <Square size={13} fill="currentColor"/>
                            : <Volume2 size={15}/>
                        }
                    </button>
                    <button className="sp-edit-btn" onClick={onEdit} aria-label={t('voiceChat.editScript')}><Pencil size={16}/></button>
                </div>
            </div>
            <div className="sp-role-bar">
                <span className="sp-role-label">{t('voiceChat.myRole')}</span>
                <button className={`sp-role-btn${roleMode === 'a' ? ' active' : ''}`}
                        onClick={() => !isRunning && !isPlayingAll && handleRoleToggle()} disabled={isRunning || isPlayingAll}>{t('voiceChat.speakAsA')}
                </button>
                <button className={`sp-role-btn${roleMode === 'b' ? ' active' : ''}`}
                        onClick={() => !isRunning && !isPlayingAll && handleRoleToggle()} disabled={isRunning || isPlayingAll}>{t('voiceChat.speakAsB')}
                </button>
                <div className="sp-ko-toggle" role="switch" tabIndex={0} aria-checked={showKo}
                     aria-label={t('voiceChat.showTranslations')} onClick={() => setShowKo(v => !v)}
                     onKeyDown={event => {
                         if (event.key === 'Enter' || event.key === ' ') {
                             event.preventDefault();
                             setShowKo(value => !value);
                         }
                     }}>
                    <div className={`sp-ko-switch${showKo ? ' on' : ''}`}/>
                    <span className="sp-ko-label">{t('voiceChat.translation')}</span>
                </div>
            </div>
            <div className="sp-chat-list" ref={listRef}>
                {pairs.map((p, i) => {
                    const isCurrent = i === currentIdx;
                    const isPassed = passedSet.has(i);
                    return (
                        <div key={p.id ?? i}
                             className={`sp-chat-pair${isCurrent ? ' current' : ''}${isPassed && !isCurrent ? ' past' : ''}`}
                             onClick={() => {
                                 if (!isRunning) goTo(i);
                             }}>
                            <div className="sp-chat-row sp-chat-row-a">
                                <div className={['sp-chat-bubble sp-chat-a',
                                    myTalking === 'a' && isCurrent ? 'my-turn' : '',
                                    isCurrent && phase === 'playing_a' ? 'speaking' : '',
                                    myTalking === 'a' && isCurrent && phase === 'correct' ? 'correct' : '',
                                    myTalking === 'a' && isCurrent && !!wrongBanner ? 'wrong' : '',
                                    myTalking === 'a' && isPassed ? 'passed' : '',
                                    myTalking === 'a' && isCurrent && (phase === 'listening' || phase === 'checking' || phase === 'processing') ? 'pulsing' : '',
                                ].filter(Boolean).join(' ')}>
                                    <div className="sp-bubble-row">
                                        <button className="sp-play-btn" onClick={e => {
                                            e.stopPropagation();
                                            speakUtterance(p.a, 'playing_a').then(() => setPhase(prev => prev === 'playing_a' || prev === 'playing_b' ? 'idle' : prev));
                                        }} aria-label={t('voiceChat.play')}><Play size={11} fill="currentColor"/>
                                        </button>
                                        <div className="sp-chat-text">{p.a}</div>
                                    </div>
                                    {showKo && <div className="sp-chat-ko">{p.a_ko}</div>}
                                </div>
                            </div>
                            <div className="sp-chat-row sp-chat-row-b">
                                <div className={['sp-chat-bubble sp-chat-b',
                                    myTalking === 'b' && isCurrent ? 'my-turn' : '',
                                    isCurrent && phase === 'playing_b' ? 'speaking' : '',
                                    myTalking === 'b' && isCurrent && phase === 'correct' ? 'correct' : '',
                                    myTalking === 'b' && isCurrent && !!wrongBanner ? 'wrong' : '',
                                    myTalking === 'b' && isPassed ? 'passed' : '',
                                    myTalking === 'b' && isCurrent && (phase === 'listening' || phase === 'checking' || phase === 'processing') ? 'pulsing' : '',
                                ].filter(Boolean).join(' ')}>
                                    <div className="sp-bubble-row">
                                        <button className="sp-play-btn" onClick={e => {
                                            e.stopPropagation();
                                            speakUtterance(p.b, 'playing_b').then(() => setPhase(prev => prev === 'playing_a' || prev === 'playing_b' ? 'idle' : prev));
                                        }} aria-label={t('voiceChat.play')}><Play size={11} fill="currentColor"/>
                                        </button>
                                        <div className="sp-chat-text">{p.b}</div>
                                    </div>
                                    {showKo && <div className="sp-chat-ko">{p.b_ko}</div>}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            {completed ? (
                <div className="sp-completed-banner">
                    {t('voiceChat.completedAll')}
                    <button className="sp-restart-btn" onClick={() => {
                        setCompleted(false);
                        setPassedSet(new Set());
                        setCurrentIdx(0);
                    }}><RotateCcw size={14}/>{t('voiceChat.restart')}</button>
                </div>
            ) : (
                <div className={`sp-stt-result${wrongBanner ? ' wrong' : ''}`}
                     style={{fontSize: 15, fontWeight: 500}}>
                    {wrongBanner ? `“${wrongBanner}”` : phaseLabel ?? ''}
                </div>
            )}
            <div className="sp-controls">
                <button className="sp-nav-btn" onClick={() => {
                    if (isRunning) handleStop();
                    goTo(Math.max(0, currentIdx - 1));
                }} disabled={isPlayingAll} aria-label={t('voiceChat.previous')}><ChevronLeft size={20}/>
                </button>
                {isRunning ? (
                    <button className="sp-mic-btn listening" onClick={handleStop} disabled={isPlayingAll}>
                        <Square size={18} fill="currentColor"/>
                    </button>
                ) : (
                    <button className="sp-mic-btn" onClick={handleStart} disabled={isPlayingAll}>
                        <Mic size={20}/>
                    </button>
                )}
                <button className="sp-nav-btn" onClick={() => {
                    if (isRunning) handleStop();
                    goTo(Math.min(pairs.length - 1, currentIdx + 1));
                }} disabled={isPlayingAll} aria-label={t('voiceChat.next')}><ChevronRight size={20}/>
                </button>
            </div>
        </div>
    );
};

export default PracticeView;
