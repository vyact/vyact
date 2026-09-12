import {describe, expect, it} from 'vitest';
import {parseTextLogs} from './TextLogEntries';

describe('text log rows', () => {
    it('parses Vyact and model metadata separately', () => {
        const rows = parseTextLogs('[2026-09-12T22:18:22] ERROR services.llm: Failed\n2026-09-12 22:18:23,123 - omlx.engine - INFO - Ready');
        expect(rows[0]).toMatchObject({level: 'ERROR', source: 'services.llm', message: 'Failed'});
        expect(rows[1]).toMatchObject({level: 'INFO', source: 'omlx.engine', message: 'Ready'});
    });
    it('preserves traceback indentation and unknown runtime output', () => {
        const rows = parseTextLogs('[2026-09-12T22:18:22] ERROR app: Failed\nTraceback (most recent call last):\n  File "app.py", line 1\nValueError: bad\nllama_init: ready');
        expect(rows).toHaveLength(2);
        expect(rows[0].message).toContain('\n  File "app.py", line 1\nValueError: bad');
        expect(rows[1].message).toBe('llama_init: ready');
    });
});
