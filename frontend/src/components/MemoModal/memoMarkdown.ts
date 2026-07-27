/**
 * memoMarkdown.ts
 * renderMarkdown을 기반으로 메모 전용으로 포팅.
 * - KaTeX 제거
 * - 코드블럭은 Tiptap codeBlock 노드로 별도 반환
 */

export interface MemoSegment {
    type: 'html' | 'codeBlock' | 'taskList';
    content: string;
    lang?: string;
    tasks?: Array<{ checked: boolean; text: string }>;
}

const inlineMarkdown = (text: string): string => {
    return text
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
        .replace(/_([^_\n]+?)_/g, '<em>$1</em>')
        .replace(/~~(.+?)~~/g, '<del style="opacity:0.6;">$1</del>')
        .replace(/`([^`]+)`/g, (_, code) =>
            `<code style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:4px;font-size:0.88em;font-family:monospace;color:var(--text);">${code}</code>`
        )
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;">$1</a>'
        );
};

export const parseMemoMarkdown = (text: string): MemoSegment[] => {
    const segments: MemoSegment[] = [];
    const lines = text.split('\n');
    let i = 0;
    let htmlLines: string[] = [];

    const flushHtml = () => {
        if (!htmlLines.length) return;
        const html = renderHtmlLines(htmlLines);
        if (html.trim()) segments.push({ type: 'html', content: html });
        htmlLines = [];
    };

    while (i < lines.length) {
        const line = lines[i];
        // 체크박스 리스트
        const checkMatch = line.match(/^([ ]*)[*-] \[(x| )\] (.+)$/i);
        if (checkMatch) {
            flushHtml();
            const tasks: Array<{ checked: boolean; text: string }> = [];
            while (i < lines.length) {
                const m = lines[i].match(/^([ ]*)[*-] \[(x| )\] (.+)$/i);
                if (!m) break;
                tasks.push({ checked: m[2].toLowerCase() === 'x', text: m[3].trim() });
                i++;
            }
            segments.push({ type: 'taskList', content: '', tasks });
            continue;
        }
        // 코드블럭 시작
        if (line.trimStart().startsWith('```')) {
            flushHtml();
            const lang = line.trimStart().slice(3).trim();
            i++;
            const codeLines: string[] = [];
            while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // 닫는 ``` 스킵
            segments.push({ type: 'codeBlock', lang, content: codeLines.join('\n') });
        } else {
            htmlLines.push(line);
            i++;
        }
    }
    flushHtml();
    return segments;
};

const renderHtmlLines = (lines: string[]): string => {
    const escaped = lines.map(l =>
        l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    );

    const result: string[] = [];
    let tableRows: string[] = [];
    let isInsideTable = false;

    const flushTable = () => {
        result.push(
            `<div style="overflow-x:auto;margin:16px 0;border-radius:8px;max-width:100%;">` +
            `<table style="width:100%;border-collapse:collapse;background:var(--surface);border:none;">` +
            `<tbody>${tableRows.join('')}</tbody></table></div>`
        );
        tableRows = [];
        isInsideTable = false;
    };

    const renderCell = (cell: string) => {
        return inlineMarkdown(cell.trim());
    };

    for (const line of escaped) {
        const trimmed = line.trim();
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            isInsideTable = true;
            if (trimmed.match(/^\|?\s?[:\- ]+\s?\|/)) continue;
            const cells = trimmed.split('|').filter((_, idx, arr) => idx !== 0 && idx !== arr.length - 1);
            const isHeader = tableRows.length === 0;
            const cellTag = isHeader ? 'th' : 'td';
            const rowHtml = `<tr>${cells.map(cell => {
                const base = `border:1px solid var(--border);padding:8px 12px;background:${isHeader ? 'var(--surface2,rgba(255,255,255,0.06))' : 'transparent'};text-align:${isHeader ? 'center' : 'left'};font-size:14px;vertical-align:top;word-break:break-word;`;
                return `<${cellTag} style="${base}">${renderCell(cell)}</${cellTag}>`;
            }).join('')}</tr>`;
            tableRows.push(rowHtml);
        } else {
            if (isInsideTable) flushTable();
            result.push(line);
        }
    }
    if (isInsideTable) flushTable();

    // blockquote 합치기
    const bqMerged: string[] = [];
    let bqLines: string[] = [];
    const flushBq = () => {
        if (!bqLines.length) return;
        const inner = bqLines.map(l => l + '<br/>').join('').replace(/(<br\/>)+$/, '');
        bqMerged.push(
            `<blockquote style="border-left:3px solid var(--accent);padding:8px 14px;margin:10px 0;` +
            `color:var(--muted);background:rgba(255,255,255,0.04);border-radius:0 6px 6px 0;` +
            `font-style:italic;">${inner}</blockquote>`
        );
        bqLines = [];
    };
    for (const line of result) {
        const m = line.match(/^&gt; ?(.*)/);
        if (m) { bqLines.push(m[1]); } else { flushBq(); bqMerged.push(line); }
    }
    flushBq();

    // ── 리스트 전처리 ──
    // ChatGPT 등에서 복사한 마크다운은 번호 항목 사이에 빈 줄이 있고, 항목의
    // 이어지는 설명이 들여쓰기된 다음 줄에 오며, 번호가 전부 "1." 인 경우가 있다.
    // 이대로면 리스트가 조각나거나 번호가 1로 리셋된다. → 빈 줄 제거로 항목을
    // 연속시키고, 들여쓰기 연속줄을 앞 항목에 <br>로 병합하고, 번호를 순차 재부여.
    const preprocessLists = (text: string): string => {
        const rows = text.split('\n');
        const out: string[] = [];
        let counter = 0;
        let inOrdered = false;
        const olRe = /^(\d+)\. +(.+)$/;
        const contRe = /^\s+(\S.*)$/;
        for (let i = 0; i < rows.length; i++) {
            const line = rows[i];
            const m = line.match(olRe);
            if (m) {
                counter += 1;
                inOrdered = true;
                out.push(`${counter}. ${m[2]}`);
                continue;
            }
            if (inOrdered && line.trim() === '') {
                let j = i + 1;
                while (j < rows.length && rows[j].trim() === '') j++;
                if (j < rows.length && olRe.test(rows[j].trim())) continue;
                inOrdered = false;
                out.push(line);
                continue;
            }
            const c = inOrdered ? line.match(contRe) : null;
            if (c && out.length > 0) {
                out[out.length - 1] += `<br>${c[1]}`;
                continue;
            }
            if (line.trim() !== '' && !olRe.test(line)) inOrdered = false;
            out.push(line);
        }
        return out.join('\n');
    };

    let html = preprocessLists(bqMerged.join('\n'))
        .replace(/^(?:---|[*]{3}|___)$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0;"/>')
        .replace(/^#### (.+)$/gm, (_, t) => `<h4 style="font-size:0.95em;font-weight:700;margin:10px 0;">${inlineMarkdown(t)}</h4>`)
        .replace(/^### (.+)$/gm,  (_, t) => `<h3 style="font-size:1.05em;font-weight:700;margin:12px 0;">${inlineMarkdown(t)}</h3>`)
        .replace(/^## (.+)$/gm,   (_, t) => `<h2 style="font-size:1.15em;font-weight:700;margin:14px 0;">${inlineMarkdown(t)}</h2>`)
        .replace(/^# (.+)$/gm,    (_, t) => `<h1 style="font-size:1.25em;font-weight:700;margin:16px 0;">${inlineMarkdown(t)}</h1>`)
        .replace(/^([ ]*)[*-] \[x\] (.+)$/gim, (_, indent, text) => {
            const depth = Math.floor(indent.length / 2);
            return `<li data-ul style="margin:4px 0;margin-left:${depth * 16}px;list-style:none;display:flex;align-items:center;gap:6px;"><input type="checkbox" checked disabled style="width:14px;height:14px;accent-color:var(--accent);flex-shrink:0;"> <span style="text-decoration:line-through;opacity:0.6;">${inlineMarkdown(text.trim())}</span></li>`;
        })
        .replace(/^([ ]*)[*-] \[ \] (.+)$/gim, (_, indent, text) => {
            const depth = Math.floor(indent.length / 2);
            return `<li data-ul style="margin:4px 0;margin-left:${depth * 16}px;list-style:none;display:flex;align-items:center;gap:6px;"><input type="checkbox" disabled style="width:14px;height:14px;accent-color:var(--accent);flex-shrink:0;"> <span>${inlineMarkdown(text.trim())}</span></li>`;
        })
        .replace(/^([ ]*)([*-]) (.+)$/gm, (_, indent, _b, content) => {
            const depth = Math.floor(indent.length / 2);
            return `<li data-ul style="margin:4px 0;margin-left:${depth * 16}px;list-style-type:${depth > 0 ? 'circle' : 'disc'};">${inlineMarkdown(content.trim())}</li>`;
        })
        .replace(/(<li data-ul[^>]*>.*?<\/li>(?:\s*\n)*)+/g, m =>
            `<ul style="margin:6px 0;padding-left:22px;">${m.replace(/ data-ul/g, '').replace(/\n/g, '')}</ul>`
        )
        .replace(/^([ ]*)\d+\. (.+)$/gm, (_, indent, content) =>
            `<li data-ol style="margin:4px 0;margin-left:${Math.floor(indent.length / 2) * 16}px;">${inlineMarkdown(content.trim())}</li>`
        )
        .replace(/(<li data-ol[^>]*>.*?<\/li>(?:\s*\n)*)+/g, m =>
            `<ol style="margin:6px 0;padding-left:22px;">${m.replace(/ data-ol/g, '').replace(/\n/g, '')}</ol>`
        );

    // inline (헤딩/리스트 아닌 줄만)
    html = html.split('\n').map(line => {
        const l = line.trim();
        if (/^<(h[1-4]|div|table|tbody|tr|td|th|ul|ol|li|hr|br|blockquote)/i.test(l)) return line;
        if (l === '') return '';
        return inlineMarkdown(l) + '<br/>';
    }).join('')
        .replace(/<\/(h[1-4]|ul|ol|li|hr|blockquote)><br\/>/g, '</$1>');

    return html;
};
