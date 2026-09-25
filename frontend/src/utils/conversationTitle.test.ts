import {describe, expect, it} from 'vitest';
import {readableConversationTitle} from './conversationTitle';

describe('readableConversationTitle', () => {
    it('shows the filename for a code-first chat', () => {
        expect(readableConversationTitle('```python """ main.py ...')).toBe('main.py');
        expect(readableConversationTitle('```json {"manifest_ver...')).toBe('manifest.json');
    });

    it('keeps a concise code line when no filename exists', () => {
        expect(readableConversationTitle('``` print(1) print(2) ```')).toBe('print(1) print(2)');
    });

    it('preserves a normal or manually named title', () => {
        expect(readableConversationTitle('Spring Boot 설정')).toBe('Spring Boot 설정');
    });
});
