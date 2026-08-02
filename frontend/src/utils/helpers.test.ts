import { describe, expect, it } from 'vitest';

import { cleanNewsText, escapeHtml, nl2br, unwrapPastedText } from './helpers';

describe('text helpers', () => {
  it('escapes HTML-sensitive characters', () => {
    expect(escapeHtml('<script>"&</script>')).toBe('&lt;script&gt;&quot;&amp;&lt;/script&gt;');
  });

  it('converts newlines to HTML line breaks', () => {
    expect(nl2br('first\nsecond')).toBe('first<br>second');
  });

  it('removes PASTE markers while preserving the original pasted text', () => {
    const content = [
      '«PASTE:Alfonso Peccatiello, founder of...»',
      'Alfonso Peccatiello argues that markets can keep applying pressure.',
      '',
      '«/PASTE»',
    ].join('\n');

    expect(unwrapPastedText(content)).toBe(
      'Alfonso Peccatiello argues that markets can keep applying pressure.',
    );
  });

  it('copies pasted text before the typed text to match the visual order', () => {
    const content = '분석해줘\n\n«PASTE:문단»\nOriginal paragraph.\n«/PASTE»';

    expect(unwrapPastedText(content)).toBe('Original paragraph.\n\n분석해줘');
  });

  it('keeps multiple pasted texts in chip order before the typed text', () => {
    const content = [
      '이것도!',
      '',
      '«PASTE:첫 문단»',
      'First paragraph.',
      '«/PASTE»',
      '',
      '«PASTE:둘째 문단»',
      'Second paragraph.',
      '«/PASTE»',
    ].join('\n');

    expect(unwrapPastedText(content)).toBe(
      'First paragraph.\n\nSecond paragraph.\n\n이것도!',
    );
  });

  it('removes common news attribution noise', () => {
    expect(cleanNewsText('[속보] 홍길동 기자 = 반갑습니다. 다음 소식입니다.')).toBe(
      '반갑습니다.\n\n다음 소식입니다.',
    );
  });
});
