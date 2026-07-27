export function escapeHtml(text: string): string {
  return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
}

export function nl2br(text: string): string {
  return text.replace(/\n/g, '<br>');
}

export function generateUUID(): string {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function formatTime(date: Date = new Date()): string {
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 뉴스 기사 텍스트 정제
 * - 브라켓 노이즈, 저작권 표시, 기자명, 연속 공백 제거
 * - 마침표/느낌표/물음표 뒤 문단 분리
 */
export function cleanNewsText(text: string): string {
  return text
      .replace(/\[([^\]]{0,30})\]/g, '')
      .replace(/[©ⓒ].{0,50}(무단|재배포|전재).*/g, '')
      .replace(/[가-힣]{2,4}\s*기자\s*[=:]/g, '')
      .replace(/\([가-힣a-zA-Z\s]{2,10}=연합뉴스\)/g, '')
      .replace(/\([가-힣a-zA-Z\s]{2,10}=뉴시스\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/([.!?])\s+/g, '$1\n\n')
      .trim();
}