/**
 * TTS 프로바이더 인터페이스
 * 나중에 edge-tts, OpenAI TTS 등으로 교체 시 이 인터페이스만 구현하면 됩니다.
 */
export interface ITtsProvider {
  /** 텍스트를 읽어줍니다. */
  speak(text: string): void;
  /** 현재 읽기를 중단합니다. */
  stop(): void;
  /** 현재 읽고 있는지 여부 */
  isSpeaking(): boolean;
  /** 지원 여부 확인 */
  isSupported(): boolean;
  /** 앱 시작 시 필요한 음성 엔진 정보를 미리 준비한다. */
  preload?(): Promise<void>;
}
