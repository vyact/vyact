import i18n from 'i18next';

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

/** UI 표시용 PASTE 마커를 제거하고 붙여넣은 원문만 유지한다. */
export function unwrapPastedText(text: string): string {
  const pastePattern = /«PASTE:.*?»\n([\s\S]*?)«\/PASTE»/g;
  const pastedContents = Array.from(text.matchAll(pastePattern), match => (
    match[1].replaceAll('«\\/PASTE»', '«/PASTE»').trim()
  ));
  const typedContent = text.replace(pastePattern, '').trim();
  return [...pastedContents, typedContent].filter(Boolean).join('\n\n');
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
  return date.toLocaleTimeString(i18n.resolvedLanguage || i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the DOM copy path used by non-secure renderer contexts.
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  try {
    textArea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
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
