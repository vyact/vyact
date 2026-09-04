import {afterEach, expect, it, vi} from 'vitest';
import {WebSpeechTtsProvider} from './WebSpeechTtsProvider';
import {getVoicesAsync, speakWithKokoroOrFallback} from '../../components/VoiceChatModal/voiceChat.types';
vi.mock('./kokoroStatus', () => ({getKokoroAvailability: vi.fn(() => new Promise(() => {}))}));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('detects Korean independently of UI language', () => {
    expect(new WebSpeechTtsProvider().splitToSegments('어떤 프로젝트인지 알려주시면 바로 답변하겠습니다.')[0].lang).toBe('ko-KR');
});
it('bypasses Kokoro for Korean and resumes speech', async () => {
    const synthesis = {getVoices: () => [{name: '유나', lang: 'ko-KR', localService: true}], cancel: vi.fn(), resume: vi.fn(), speak: vi.fn((u: SpeechSynthesisUtterance) => u.onend?.({} as SpeechSynthesisEvent))};
    vi.stubGlobal('window', {speechSynthesis: synthesis});
    vi.stubGlobal('SpeechSynthesisUtterance', class {text: string; constructor(text: string) {this.text = text;}});
    await speakWithKokoroOrFallback('안녕하세요.', 'ko-KR', {rate: 1.25, volume: 1, enVoiceURI: '', kokoroVoice: ''});
    expect(synthesis.resume).toHaveBeenCalled();
    expect(synthesis.speak).toHaveBeenCalledOnce();
});
it('bounds voice discovery when no event arrives', async () => {
    vi.useFakeTimers();
    const remove = vi.fn();
    vi.stubGlobal('window', {speechSynthesis: {getVoices: () => [], addEventListener: vi.fn(), removeEventListener: remove}});
    const result = getVoicesAsync();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toEqual([]);
    expect(remove).toHaveBeenCalled();
});
