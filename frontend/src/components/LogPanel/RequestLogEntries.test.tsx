import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import RequestLogEntries, {parseRequestLogs} from './RequestLogEntries';

describe('request log entries', () => {
    it('keeps malformed and partial lines visible alongside valid records', () => {
        const entries = parseRequestLogs('partial\n{"request_id":"one","user_prompt":"hello"}\n{"unfinished":');
        expect(entries).toHaveLength(3);
        expect(entries[1].summary).toBe('hello');
        expect(entries[2].value).toBe('{"unfinished":');
    });
    it('preserves record identity after earlier entries leave the buffer', () => {
        const first = '{"request_id":"first","timestamp":"1"}';
        const second = '{"request_id":"second","timestamp":"2"}';
        expect(parseRequestLogs(`${first}\n${second}`)[1].key).toBe(parseRequestLogs(second)[0].key);
    });
    it('renders one collapsed row and serializes objects below depth two as text', () => {
        const content = JSON.stringify({user_prompt: '<script>hello</script>', stats: {nested: {deep: 1}}});
        const html = renderToStaticMarkup(<RequestLogEntries content={content} onInspect={() => {}}/>);
        expect(html.match(/<details/g)).toHaveLength(1);
        expect(html).not.toContain(' open=');
        expect(html).toContain('{&quot;deep&quot;:1}');
        expect(html).not.toContain('<script>');
    });
});
