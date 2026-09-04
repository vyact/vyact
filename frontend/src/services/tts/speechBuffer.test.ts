import {describe, expect, it} from 'vitest';
import {splitSpeechBuffer} from './speechBuffer';

describe('streaming speech buffer', () => {
    it('retains incomplete sentences without splitting decimals', () => {
        expect(splitSpeechBuffer('The value is 3.14. Next')).toEqual({sentences: ['The value is 3.14. '], rest: 'Next'});
    });
    it('flushes the last sentence only at completion', () => {
        expect(splitSpeechBuffer('안녕하세요')).toEqual({sentences: [], rest: '안녕하세요'});
        expect(splitSpeechBuffer('안녕하세요', true)).toEqual({sentences: ['안녕하세요'], rest: ''});
    });
    it('preserves ordering across chunk boundaries', () => {
        const first = splitSpeechBuffer('First sentence. Sec');
        const second = splitSpeechBuffer(first.rest + 'ond sentence. ', true);
        expect([...first.sentences, ...second.sentences]).toEqual(['First sentence. ', 'Second sentence. ']);
    });
});
