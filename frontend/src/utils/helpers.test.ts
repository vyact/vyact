import { describe, expect, it } from 'vitest';

import { cleanNewsText, escapeHtml, nl2br } from './helpers';

describe('text helpers', () => {
  it('escapes HTML-sensitive characters', () => {
    expect(escapeHtml('<script>"&</script>')).toBe('&lt;script&gt;&quot;&amp;&lt;/script&gt;');
  });

  it('converts newlines to HTML line breaks', () => {
    expect(nl2br('first\nsecond')).toBe('first<br>second');
  });

  it('removes common news attribution noise', () => {
    expect(cleanNewsText('[속보] 홍길동 기자 = 반갑습니다. 다음 소식입니다.')).toBe(
      '반갑습니다.\n\n다음 소식입니다.',
    );
  });
});
