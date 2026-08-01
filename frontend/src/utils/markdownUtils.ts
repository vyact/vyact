import katex from 'katex';
import type {CodeFile} from '../components/CodeFileViewer/CodeFileViewer';
import {isSafeUrl, splitTableCells} from './markdown/safety';
import type {ContentPart, FollowupsResult, RenderGroup, StreamSafeResult} from './markdown/types';

export type {ContentPart, FollowupsResult, MessageProps, RenderGroup, StreamSafeResult} from './markdown/types';

// 코드블록 사이 텍스트가 "구분자" 역할인지 판별
// --- , ### 사용 예시, 헤딩 등이 있으면 새 그룹으로 분리
// contentParts를 순회해서 코드블록을 렌더링 그룹으로 변환

// 텍스트에서 코드블록 바로 앞의 파일명 힌트를 추출
// 예: "`ProviderSettingsModal.tsx`" 또는 "**ProviderSettingsModal.tsx**" 등
// 텍스트에서 파일명 힌트 추출 — 코드블록 바로 위 줄 우선
// 경로 포함(src/components/Button/Button.tsx)도 처리, 마지막 세그먼트만 반환
const FILE_EXT_RE = /(?:^|[\s`*_'"])([^\s`*_'"\x2f\\]+\.(?:tsx?|jsx?|css|scss|py|java|go|rs|html|json|md|yaml|yml|sh|sql))(?:[\s`*_'"]|$)/i;

// 언어별 확장자 매핑
const LANG_TO_EXT: Record<string, string> = {
    tsx: 'tsx', ts: 'ts', jsx: 'jsx', js: 'js',
    css: 'css', scss: 'scss', sass: 'scss',
    python: 'py', py: 'py',
    java: 'java',
    go: 'go', golang: 'go',
    rust: 'rs', rs: 'rs',
    html: 'html', htm: 'html',
    json: 'json',
    markdown: 'md', md: 'md',
    yaml: 'yml', yml: 'yml',
    bash: 'sh', sh: 'sh', shell: 'sh',
    sql: 'sql', kotlin: 'kt', swift: 'swift', cpp: 'cpp', c: 'c',
};

const MARKDOWN_PROTECTED_TOKEN_PREFIX = `${String.fromCharCode(0)}P`;
const MARKDOWN_PROTECTED_TOKEN_SUFFIX = String.fromCharCode(0);

export const formatTimestamp = (timestamp: string): string => {
    if (!timestamp) return '';
    try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return '';
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));
        if (hours < 24 && date.getDate() === now.getDate()) {
            return date.toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit', hour12: false});
        }
        return date.toLocaleString('ko-KR', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    } catch {
        return '';
    }
};

export const linkify = (html: string): string => {
    const urlRegex = /(?<!['"=])(https?:\/\/[^\s<>"'）】)]+)/g;
    return html.replace(urlRegex, (url) => {
        const trailingPunct = url.match(/[.,!?；；）)]+$/);
        const cleanUrl = trailingPunct ? url.slice(0, -trailingPunct[0].length) : url;
        const trailing = trailingPunct ? trailingPunct[0] : '';
        if (!isSafeUrl(cleanUrl)) return `${cleanUrl}${trailing}`;
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;word-break:break-all;">${cleanUrl}</a>${trailing}`;
    });
};


// 코드 내용에서 주요 식별자 추출해 파일명 추측
const guessNameFromCode = (code: string, lang: string): string => {
    const ext = LANG_TO_EXT[lang.toLowerCase()] ?? lang.toLowerCase();
    const lines = code.split('\n').slice(0, 30);
    let name = '';

    // React 컴포넌트: const Button: React.FC / function Modal(
    const reactComp = code.match(/(?:const|function)\s+([A-Z][A-Za-z0-9]+)\s*(?::|=|\()/);
    if (reactComp) name = reactComp[1];

    // Java/Kotlin 클래스
    if (!name) {
        const javaClass = code.match(/(?:public\s+)?(?:class|interface|enum)\s+([A-Z][A-Za-z0-9]+)/);
        if (javaClass) name = javaClass[1];
    }

    // Python 클래스/함수
    if (!name) {
        const pyDef = lines.join('\n').match(/(?:class|def)\s+([A-Za-z][A-Za-z0-9_]+)/);
        if (pyDef) name = pyDef[1];
    }

    // Go 함수
    if (!name) {
        const goFunc = code.match(/func\s+([A-Za-z][A-Za-z0-9]+)/);
        if (goFunc) name = goFunc[1];
    }

    // Rust struct/fn
    if (!name) {
        const rustDef = code.match(/(?:struct|fn|impl)\s+([A-Za-z][A-Za-z0-9]+)/);
        if (rustDef) name = rustDef[1];
    }

    if (name) return `${name}.${ext}`;
    return `file.${ext}`;
};

const extractFilenameHint = (text: string, lang: string, code: string = ''): string => {
    const lines = text.split('\n');
    // 마지막 6줄을 역순으로 탐색 — 코드블록에 가장 가까운 줄 우선
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
        const line = lines[i];
        const m = line.match(FILE_EXT_RE);
        if (m) {
            // 경로에서 마지막 파일명 세그먼트만 반환
            return m[1].trim().split('/').pop()!.split('\\').pop()!;
        }
    }
    // 힌트 없으면 코드 내용으로 추측
    if (code) return guessNameFromCode(code, lang);
    return `file.${LANG_TO_EXT[lang.toLowerCase()] ?? lang.toLowerCase()}`;
};

export const groupContentParts = (parts: ContentPart[]): RenderGroup[] => {
    const groups: RenderGroup[] = [];
    let i = 0;
    while (i < parts.length) {
        const part = parts[i];
        if (part.type === 'project') {
            groups.push({type: 'project', value: part.value});
            i++;
        } else if (part.type === 'code') {
            // 직전 텍스트에서 파일명 추출
            const prevText = groups.length > 0 && groups[groups.length - 1].type === 'text'
                ? (groups[groups.length - 1].value ?? '') : '';
            const name = extractFilenameHint(prevText, part.lang ?? 'txt', part.value);

            // 다음 코드블록이 바로 이어지고 같은 언어면 묶기
            const codeFiles: CodeFile[] = [{name, lang: part.lang ?? 'txt', code: part.value}];
            let j = i + 1;
            while (j < parts.length && parts[j].type === 'code' && parts[j].lang === part.lang) {
                const nextName = extractFilenameHint('', parts[j].lang ?? 'txt', parts[j].value);
                codeFiles.push({name: nextName, lang: parts[j].lang ?? 'txt', code: parts[j].value});
                j++;
            }

            if (codeFiles.length >= 1) {
                groups.push({type: 'codefiles', files: codeFiles});
            } else {
                groups.push({type: 'code', value: part.value, lang: part.lang});
            }
            i = j;
        } else {
            groups.push({type: 'text', value: part.value, lang: part.lang});
            i++;
        }
    }
    return groups;
};

// ── 스트리밍 중 "안전한 경계" 계산 ──────────────────────────────────────────
// 토큰이 계속 흘러들어오는 도중에는 아직 닫히지 않은 구조 블록(코드블록/프로젝트)이
// 있을 수 있다. 그 미완성 블록을 그대로 parseContent/renderMarkdown 에 넘기면
// 절반만 파싱돼 깨진 코드뷰어/파일트리가 렌더된다.
//
// 정책: 미완성 구조 블록은 "닫힐 때까지 렌더링 보류".
//   - safe   : 지금 렌더해도 안전한(=모든 구조가 닫힌) 앞부분
//   - pending: 아직 닫히지 않은 블록 종류 (null | 'code' | 'project')
// 호출부(Message.tsx)는 스트리밍 중이면 safe 만 기존 렌더러로 그리고,
// pending 이 있으면 그 아래 플레이스홀더 한 줄을 붙인다.
// 스트림이 끝나면 블록이 반드시 닫히므로 pending 은 null 로 수렴 → 기존 완성 렌더와 동일.

export const splitStreamSafe = (buffer: string): StreamSafeResult => {
    // -1) 내부 요약 숨김 태그(<conv_summary>, <project_summary>): 백엔드가 저장 전용으로 쓰는
    //     태그라 스트리밍 중에도 절대 화면에 보이면 안 됨. followups와 마찬가지로 항상 응답
    //     맨 끝(followups보다도 앞)에 오므로, 열리는 순간부터 그 이후는 전부 잘라낸다.
    const csIdx = buffer.search(/<conv_summary\b|<project_summary\b|<project_memory\b/i);
    if (csIdx !== -1) {
        const head = buffer.slice(0, csIdx);
        const headResult = splitStreamSafe(head);
        if (headResult.pending) return headResult;  // 앞부분에 미완성 블록 → 그 상태 우선
        // 내부 요약은 사용자에게 보여줄 작업 단계가 아니다. 태그가 열리는 즉시 숨기고
        // 별도 진행 문구도 렌더하지 않는다.
        return { safe: headResult.safe, pending: null };
    }

    // 0) followups 블록: <followups> 가 열리면 그 이후는 스트리밍 노출하지 않고 보류.
    //    (닫히든 안 닫히든 항상 응답 맨 끝이므로 안전하게 잘라낸다)
    //    앞부분에 미완성 코드/표가 있을 수 있으므로, 잘라낸 앞부분을 다시 검사한다.
    //    앞부분이 모두 안전하면 pending='followups'로 "후속 질문 준비 중" 표시.
    const fuIdx = buffer.indexOf('<followups');
    if (fuIdx !== -1) {
        const head = buffer.slice(0, fuIdx);
        const headResult = splitStreamSafe(head);
        if (headResult.pending) return headResult;  // 앞부분에 미완성 블록 → 그 상태 우선
        return { safe: headResult.safe, pending: 'followups' };
    }

    // 1) 프로젝트 블록: ```vyproject / ```xml:vyproject 가 열렸는데 </vyproject> 가 아직 없으면 보류
    //    펜스 없이 <vyproject name="..."> 태그만 바로 온 경우도 동일하게 처리 (모델이 펜스 생략 가능)
    const projMarkerRe = /```\s*(?:xml:)?vyproject/i;
    const bareProjTagRe = /<vyproject\s+name=/i;
    const projMatch = projMarkerRe.exec(buffer);
    const bareProjMatch = bareProjTagRe.exec(buffer);
    const useBareProj = bareProjMatch && (!projMatch || bareProjMatch.index < projMatch.index);
    const effectiveProjIdx = useBareProj ? bareProjMatch!.index : (projMatch ? projMatch.index : -1);
    if (effectiveProjIdx !== -1) {
        const afterMarker = buffer.slice(effectiveProjIdx);
        // </vyproject> 직후 바로 새 <file path="...">가 이어지면 LLM이 </file> 대신
        // 실수로 쓴 조기 종료 태그이므로 아직 "안 닫힌" 것으로 취급한다
        // (extractProjectBlocks의 최종 파싱과 동일한 판정 기준을 스트리밍 중에도 적용).
        let reallyClosed = false;
        let searchPos = 0;
        while (true) {
            const relIdx = afterMarker.indexOf('</vyproject>', searchPos);
            if (relIdx === -1) break;
            const after = afterMarker.slice(relIdx + '</vyproject>'.length);
            if (/^\s*<file\s+path=/i.test(after)) {
                searchPos = relIdx + '</vyproject>'.length;
                continue;
            }
            reallyClosed = true;
            break;
        }
        if (!reallyClosed) {
            return {safe: buffer.slice(0, effectiveProjIdx), pending: 'project'};
        }
    }

    // 2) 코드블록 펜스(```/~~~) 홀짝 체크 — 홀수면 마지막 여는 펜스가 아직 안 닫힘
    //    (project 블록은 위에서 이미 걸러졌으므로 여기 도달하면 일반 코드블록)
    let fenceCount = 0;
    let searchIdx = 0;
    let lastFenceIdx = -1;
    for (const fence of ['```', '~~~']) {
        fenceCount = 0;
        searchIdx = 0;
        lastFenceIdx = -1;
        while (true) {
            const idx = buffer.indexOf(fence, searchIdx);
            if (idx === -1) break;
            fenceCount++;
            lastFenceIdx = idx;
            searchIdx = idx + fence.length;
        }
        if (fenceCount % 2 === 1 && lastFenceIdx !== -1) {
            return {safe: buffer.slice(0, lastFenceIdx), pending: 'code'};
        }
    }

    // 3) 미완성 테이블 보류
    //    테이블은 행마다 파싱하면 렌더 높이가 계속 바뀌어 스크롤이 요동친다.
    //    코드블록과 동일하게, 테이블이 "확실히 끝났다"는 신호가 나오기 전까지
    //    테이블 블록 전체를 보류하고 "표 생성 중" 플레이스홀더로 대체한다.
    //
    //    끝 신호: 테이블 마지막 행 다음에 테이블이 아닌 줄(빈 줄 포함)이 최소 1줄 존재.
    //    즉 버퍼의 "마지막 비어있지 않은 줄"이 테이블 행이면 → 아직 진행 중으로 간주해 보류.
    //    (개행으로 끝나든 아니든 무관. 스트리밍은 '| … |\n' 형태로도 들어오므로
    //     개행 유무로 판단하면 매 행마다 렌더돼 버린다.)
    {
        const bLines = buffer.split('\n');
        // 완결된 표 행: | … | (양끝 파이프)
        const isTableLine = (l: string) => {
            const t = l.trim();
            return t.startsWith('|') && t.endsWith('|') && t.length >= 2;
        };
        // 작성 중인 표 행: 파이프로 시작하기만 하면 됨(끝 파이프는 아직 없을 수 있음).
        // LLM이 셀을 한 글자씩 타이핑하는 동안 '| **Tuple**' 처럼 끝 파이프가
        // 없는 중간 상태가 나오는데, 이때도 표 진행 중으로 봐야 매 순간 렌더되지 않는다.
        const isPartialTableLine = (l: string) => {
            const t = l.trim();
            return t.startsWith('|') && t.length >= 1;
        };

        // 마지막 비어있지 않은 줄
        let lastNonEmpty = bLines.length - 1;
        while (lastNonEmpty >= 0 && bLines[lastNonEmpty].trim() === '') lastNonEmpty--;

        // 마지막 줄이 (완결이든 작성 중이든) 표 행이면 → 진행 중인 표로 간주해 보류
        if (lastNonEmpty >= 0 && isPartialTableLine(bLines[lastNonEmpty])) {
            // 표 블록 시작점을 역으로 탐색 (완결/작성 중 행 모두 포함)
            let start = lastNonEmpty;
            while (start > 0 &&
            (isTableLine(bLines[start - 1]) || isPartialTableLine(bLines[start - 1]))) {
                start--;
            }
            if (start > 0) {
                const safe = bLines.slice(0, start).join('\n');
                return {safe, pending: 'table'};
            }
            return {safe: '', pending: 'table'};
        }
    }

    // 4) 모든 구조가 닫혀 있음 → 전체 안전
    return {safe: buffer, pending: null};
};

// 응답 말미의 <followups>…</followups> 블록을 분리한다.
// 반환: { body: 블록을 제거한 본문, followups: 파싱된 질문 목록 }

export const parseFollowups = (text: string): FollowupsResult => {
    if (!text) return { body: text || '', followups: [] };

    // <conv_summary>/<project_summary>는 백엔드가 저장용으로만 쓰는 숨김 태그 —
    // 스트리밍 중 화면에 잠깐 보일 수 있으니 최종 렌더 시 여기서 제거한다.
    // (백엔드도 히스토리 저장 전 별도로 제거하지만, 실시간 스트리밍 화면 표시는 이 파싱이 담당)
    const stripHiddenTag = (t: string, tag: string) =>
        t.replace(new RegExp(`<${tag}\\s*>[\\s\\S]*?(?:<\\/${tag}\\s*>|$)`, 'i'), '').trimEnd();
    text = stripHiddenTag(text, 'conv_summary');
    text = stripHiddenTag(text, 'project_summary');
    text = stripHiddenTag(text, 'project_memory');

    // 닫힘 태그가 있으면 그 안을, 없으면(스트림 잘림 등) 여는 태그 이후 끝까지를 대상으로.
    const openRe = /<followups\s*>/i;
    const m = openRe.exec(text);
    if (!m) return { body: text, followups: [] };

    const start = m.index;
    const afterOpen = text.slice(m.index + m[0].length);
    const closeRe = /<\/followups\s*>/i;
    const closeM = closeRe.exec(afterOpen);
    const inner = closeM ? afterOpen.slice(0, closeM.index) : afterOpen;

    const followups = inner
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => l.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
        .filter(l => l.length > 0);

    const body = text.slice(0, start).trimEnd();
    return { body, followups };
};

export const parseContent = (text: string): ContentPart[] => {
    const parts: ContentPart[] = [];

    // xml:vyproject 블록 추출
    // 정상: ```xml:vyproject ... </vyproject> ``` 형식 (</vyproject> 이후 ``` 닫힘까지 소비)
    // 폴백: 펜스 없이 <vyproject name="..."> 태그만 바로 온 경우도 인식
    //       (gemma처럼 작은 로컬 모델은 긴 응답 끝에서 ```vyproject 펜스를 종종 빼먹는다 —
    //        태그 자체(<project name=.../>~</vyproject>)가 이미 충분히 명확한 신호라 이걸로도 파싱 가능하게 함)
    const extractProjectBlocks = (text: string): Array<{ start: number; end: number; content: string }> => {
        const results: Array<{ start: number; end: number; content: string }> = [];
        const markerRe = /```\s*(?:xml:)?vyproject/i;  // ```vyproject 또는 ```xml:vyproject 모두 허용
        const bareTagRe = /<vyproject\s+name=/i;         // 펜스 없이 바로 온 경우 폴백
        let searchFrom = 0;
        while (true) {
            const remaining = text.slice(searchFrom);
            const markerMatch = markerRe.exec(remaining);
            const bareMatch = bareTagRe.exec(remaining);

            // 펜스 마커와 폴백 태그 중 더 먼저 나오는 쪽을 채택. 펜스 마커가 있으면
            // 그 바로 뒤에 <vyproject 태그가 오는 게 정상이므로(중복 매치), 그 경우는 펜스 쪽을 우선.
            const useBare = bareMatch && (!markerMatch || bareMatch.index < markerMatch.index);

            let blockStart: number;
            let contentFrom: number;
            if (!useBare && markerMatch) {
                blockStart = searchFrom + markerMatch.index;
                const markerEnd = blockStart + markerMatch[0].length;
                const nl = text.indexOf('\n', markerEnd);
                if (nl === -1) break;
                contentFrom = nl;  // 이후 slice(contentFrom+1, ...)로 마커 줄 스킵
            } else if (useBare && bareMatch) {
                blockStart = searchFrom + bareMatch.index;
                contentFrom = blockStart - 1;  // slice(contentFrom+1, ...) 했을 때 태그 시작부터 포함되도록
            } else {
                break;
            }
            const markerEnd = useBare ? blockStart : contentFrom;  // 폴백일 땐 아래서 안 씀

            // </vyproject> 로 끝 탐색. 없으면 마지막 </file> 이후 ``` 까지로 폴백
            let contentEnd: number;
            let blockEnd: number;
            const closeTag = '</vyproject>';
            // LLM이 파일 도중 </file> 대신 실수로 </vyproject>를 써서 블록을 조기 종료시키는
            // 경우가 있다 — 그 직후(공백 무시) 바로 새 <file path="...">가 이어지면 잘못
            // 삽입된 것으로 보고 건너뛰어 다음 </vyproject>를 계속 찾는다. (파일이 중간에
            // 잘려서 project 블록 밖으로 새어나가는 것 방지)
            let closeIdx = -1;
            {
                let searchPos = contentFrom;
                while (true) {
                    const idx = text.indexOf(closeTag, searchPos);
                    if (idx === -1) { closeIdx = -1; break; }
                    const after = text.slice(idx + closeTag.length);
                    if (/^\s*<file\s+path=/i.test(after)) {
                        searchPos = idx + closeTag.length;
                        continue;
                    }
                    closeIdx = idx;
                    break;
                }
            }
            if (closeIdx !== -1) {
                contentEnd = closeIdx + closeTag.length;
                const afterClose = text.slice(contentEnd);
                const fenceMatch = afterClose.match(/^[\s\n]*```/);
                blockEnd = fenceMatch ? contentEnd + fenceMatch[0].length : contentEnd;
            } else {
                // LLM이 </vyproject> 생략한 경우
                // 1순위: 닫는 ``` 위치
                // 2순위: 마지막 </file> 이후 텍스트 끝 (``` 도 없는 경우)
                const searchAfter = useBare ? blockStart : markerEnd;
                const fenceIdx = text.indexOf('\n```', searchAfter);
                const lastFileTag = '</file>';
                const lastFileIdx = text.lastIndexOf(lastFileTag, text.length);
                if (fenceIdx !== -1) {
                    contentEnd = fenceIdx;
                    blockEnd = fenceIdx + 4; // \n``` 소비
                } else if (lastFileIdx !== -1 && lastFileIdx > searchAfter) {
                    contentEnd = lastFileIdx + lastFileTag.length;
                    blockEnd = contentEnd;
                } else {
                    // 아무것도 없으면 텍스트 끝까지
                    contentEnd = text.length;
                    blockEnd = text.length;
                }
            }

            const content = text.slice(contentFrom + 1, contentEnd);
            results.push({ start: blockStart, end: blockEnd, content });
            searchFrom = blockEnd;
        }
        return results;
    };

    const projectBlocks = extractProjectBlocks(text);

    // projectBlock 범위를 마스킹 → codeBlockRegex가 내부 ``` 에 반응하지 않도록
    // xml:project, json:vyproject 모두 제외
    const codeBlockRegex = /```((?!(?:xml:)?vyproject|json:vyproject)[\w:]*)\n?([\s\S]*?)```|~~~([\w:]*)\n?([\s\S]*?)~~~|\{code\}([\s\S]*?)\{code\}/g;
    let lastIndex = 0;

    // text를 순서대로 순회하며 project블록과 일반 코드블록 병합
    const allBlocks: Array<{
        start: number;
        end: number;
        type: 'project' | 'code' | 'text';
        content: string;
        lang?: string
    }> = [];

    for (const pb of projectBlocks) {
        allBlocks.push({start: pb.start, end: pb.end, type: 'project', content: pb.content});
    }

    // projectBlock 범위를 공백으로 마스킹 → codeBlockRegex가 블록 내부 백틱에 반응하지 않도록
    let maskedText = text;
    for (const pb of projectBlocks) {
        maskedText = maskedText.slice(0, pb.start) + ' '.repeat(pb.end - pb.start) + maskedText.slice(pb.end);
    }

    let match;
    while ((match = codeBlockRegex.exec(maskedText)) !== null) {
        const codeContent = match[2] ?? match[4] ?? match[5];
        const lang = match[1] || match[3] || 'code';
        allBlocks.push({start: match.index, end: codeBlockRegex.lastIndex, type: 'code', content: codeContent, lang});
    }

    // start 기준 정렬
    allBlocks.sort((a, b) => a.start - b.start);

    lastIndex = 0;
    for (const block of allBlocks) {
        if (block.start > lastIndex) {
            const textVal = text.slice(lastIndex, block.start).trim();
            if (textVal) parts.push({type: 'text', value: textVal});
        }
        if (block.type === 'project') {
            parts.push({type: 'project', value: block.content, lang: 'json'});
        } else {
            parts.push({type: 'code', value: block.content, lang: block.lang});
        }
        lastIndex = block.end;
    }
    if (lastIndex < text.length) {
        const remaining = text.slice(lastIndex).trim();
        if (remaining) parts.push({type: 'text', value: remaining});
    }
    return parts;
};


const renderKatex = (formula: string, displayMode: boolean): string => {
    try {
        return katex.renderToString(formula, {displayMode, throwOnError: false, output: 'html'});
    } catch {
        return formula;
    }
};

export const renderMarkdown = (text: string): string => {
    // parseContent가 분리 못 한 xml:vyproject/json:vyproject 블록을 통째로 제거
    // (블록 내부 백틱이 인라인 백틱 regex를 파괴하는 것 방지)
    text = text
        .replace(/```\s*(?:(?:xml:)?vyproject|json:vyproject)[\s\S]*?```/gi, '')
        .replace(/<vyproject\b[\s\S]*?<\/vyproject>/gi, '');
    const mathPlaceholders: string[] = [];
    // gemma 등 일부 LLM이 이모지를 <0xF0><0x9F>... hex 시퀀스로 출력하는 경우 복원
    let preprocessed = text.replace(/(<0x[0-9A-Fa-f]{2}>)+/g, (match) => {
        try {
            const bytes = [...match.matchAll(/<0x([0-9A-Fa-f]{2})>/g)].map(m => parseInt(m[1], 16));
            return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
        } catch {
            return match;
        }
    });

    // 인라인 코드 안의 '$'는 셸 변수/명령 치환일 수 있으므로 KaTeX보다 먼저 보호한다.
    // 백틱까지 함께 보관했다가 수식 파싱 후 복원하면 기존 인라인 코드 렌더링을 그대로 탄다.
    const inlineCodeMarkdownTokens: string[] = [];
    preprocessed = preprocessed.replace(/(?<!`)`([^`\n]+)`(?!`)/g, (markdownCode) => {
        const idx = inlineCodeMarkdownTokens.length;
        inlineCodeMarkdownTokens.push(markdownCode);
        return `XINLINECODEMARKDOWN${idx}X`;
    });

    preprocessed = preprocessed.replace(/\$\$([^$]+?)\$\$/gs, (_, formula) => {
        const idx = mathPlaceholders.length;
        mathPlaceholders.push(`<div style="overflow-x:auto;margin:10px 0;text-align:center;">${renderKatex(formula.trim(), true)}</div>`);
        return `XKATEXBLOCK${idx}X`;
    });

    preprocessed = preprocessed.replace(/\$([^$\n]+?)\$/g, (match, formula) => {
        if (/\\[a-zA-Z]/.test(formula)) {
            const idx = mathPlaceholders.length;
            mathPlaceholders.push(renderKatex(formula.trim(), false));
            return `XKATEXINLINE${idx}X`;
        }
        if (/^[\d,.\s]+$/.test(formula)) return match;
        if (/[억만천원달러%（）\uFF00-\uFFEF]/.test(formula)) return match;
        if (/[\uAC00-\uD7A3\uF900-\uFAFF]/.test(formula) && !/[a-zA-Z\\]/.test(formula)) return match;
        const idx = mathPlaceholders.length;
        mathPlaceholders.push(renderKatex(formula.trim(), false));
        return `XKATEXINLINE${idx}X`;
    });

    preprocessed = preprocessed.replace(/XINLINECODEMARKDOWN(\d+)X/g, (_, i) =>
        inlineCodeMarkdownTokens[Number(i)] || ''
    );

    // ── 코드블록(```)을 먼저 추출하여 플레이스홀더로 보호
    const codeBlockTokens: string[] = [];
    preprocessed = preprocessed.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
        const escapedCode = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const html = `<pre style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:14px 16px;margin:10px 0;overflow-x:auto;font-size:0.88em;line-height:1.5;"><code style="font-family:'SF Mono',Menlo,Consolas,monospace;color:var(--code-color);">${escapedCode}</code></pre>`;
        codeBlockTokens.push(html);
        return ` CODEBLOCK${codeBlockTokens.length - 1} `;
    });

    const escaped = preprocessed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const lines = escaped.split('\n');
    const result: string[] = [];
    let tableRows: string[] = [];
    let tableHeaders: string[] = [];
    let tableAligns: string[] = [];  // 컬럼별 정렬 ('left'|'center'|'right'|'')
    let isInsideTable = false;

    const isTableRow = (value: string) => {
        const trimmed = value.trim();
        return trimmed.startsWith('|') && trimmed.endsWith('|') && splitTableCells(trimmed).length >= 2;
    };
    const isTableSeparator = (value: string) => {
        const cells = splitTableCells(value.trim());
        return cells.length > 0 && cells.every(cell => /^\s*:?-+:?\s*$/.test(cell));
    };

    const SHOP_COL_STYLES: Record<string, string> = {
        '순서': 'width:50px; min-width:0; text-align:center; white-space:nowrap;',
        '이미지': 'width:70px; min-width:0; text-align:center;',
        '제품명': 'width:250px; min-width:0; max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;',
        '사이트': 'width:80px; min-width:0; white-space:nowrap;',
        '가격': 'width:80px; min-width:0;',
        '배송': 'width:90px; min-width:0;',
        '리뷰수': 'width:70px; min-width:0;',
    };

    const flushTable = () => {
        const isShopTable = tableHeaders.includes('제품명') || tableHeaders.includes('이미지');
        // 쇼핑 테이블: 콘텐츠 폭(가로 스크롤 허용). 일반 테이블: 고정 레이아웃으로
        // 컬럼 폭을 강제 배분해 긴 코드/URL 셀이 표를 넘치게 하지 않는다.
        const tableStyle = isShopTable
            ? 'width:max-content; min-width:100%; table-layout:auto;'
            : 'width:100%; table-layout:fixed;';
        // 일반 테이블은 첫 두 컬럼을 좁게 고정하고 마지막(설명) 컬럼이 나머지를 차지.
        let colgroup = '';
        if (!isShopTable && tableHeaders.length >= 2) {
            const n = tableHeaders.length;
            const cols: string[] = [];
            for (let c = 0; c < n; c++) {
                // 마지막 컬럼은 나머지 폭을 자동으로 차지(비워둠), 앞 컬럼들은 비율 고정
                if (c === n - 1) cols.push('<col/>');
                else cols.push(`<col style="width:${n === 2 ? 30 : n === 3 ? 22 : 18}%;"/>`);
            }
            colgroup = `<colgroup>${cols.join('')}</colgroup>`;
        }
        result.push(`<div style="overflow-x:auto; margin:16px 0; border-radius:8px; max-width:100%;"><table style="${tableStyle} border-collapse:collapse; background:var(--surface); border:none;">${colgroup}<tbody>${tableRows.join('')}</tbody></table></div>`);
        tableRows = [];
        tableHeaders = [];
        tableAligns = [];
        isInsideTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // GFM 표는 헤더 다음의 구분선이 있어야 한다. 그렇지 않은 '| 문장 |'은 일반 텍스트다.
        const startsTable = isTableRow(trimmedLine) && isTableSeparator(lines[i + 1] || '');
        if (isInsideTable ? isTableRow(trimmedLine) : startsTable) {
            isInsideTable = true;
            // 구분선 행: |:---:|:---|---:|---| → 정렬 파싱 후 스킵
            // (셀이 모두 :, -, 공백 으로만 이뤄진 행)
            const sepCells = splitTableCells(trimmedLine);
            const isSeparator = isTableSeparator(trimmedLine);
            if (isSeparator) {
                tableAligns = sepCells.map(c => {
                    const t = c.trim();
                    const left = t.startsWith(':');
                    const right = t.endsWith(':');
                    if (left && right) return 'center';
                    if (right) return 'right';
                    if (left) return 'left';
                    return '';  // 지정 없음
                });
                continue;
            }

            const cells = splitTableCells(trimmedLine);

            const isHeader = tableRows.length === 0;
            const cellTag = isHeader ? 'th' : 'td';

            if (isHeader) {
                tableHeaders = cells.map(c => c.trim());
            }
            const colOrder: string[] = tableHeaders;
            const isShopTable = tableHeaders.includes('제품명') || tableHeaders.includes('이미지');

            const renderCell = (cell: string) => {
                const trimmed = cell.trim();
                // 이미지/링크 마크다운은 unescaped 상태로 처리 후 다시 escape
                const withImg = trimmed.replace(
                    /!\[([^\]]*)\]\(([^)]+)\)/g,
                    (_, alt, src) => isSafeUrl(src, true)
                        ? `<img src="${src}" alt="${alt}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;display:block;cursor:pointer;" />`
                        : alt
                );
                const linked = withImg.replace(
                    /\[([^\]]+)\]\(([^)]+)\)/g,
                    (_, linkText, href) => isSafeUrl(href)
                        ? `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;">${linkText}</a>`
                        : linkText
                );
                // backtick 인라인 코드: 이미 escape된 상태이므로 그대로 출력
                const withCode = linked.replace(/`([^`]+)`/g, (_, code) =>
                    `<code style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);padding:1px 5px;border-radius:5px;font-size:0.86em;font-family:'SF Mono',Menlo,Consolas,monospace;color:var(--code-color);white-space:nowrap;">${code}</code>`
                );
                return withCode
                    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>')
                    // escape된 리터럴 <br>, &nbsp; 복원 (LLM이 셀 줄바꿈/공백용으로 넣음)
                    .replace(/&lt;br\s*\/?&gt;/gi, '<br/>')
                    .replace(/&amp;nbsp;/gi, '&nbsp;');
            };

            const rowHtml = `<tr>${cells.map((cell, ci) => {
                const colName = colOrder[ci] || '';
                const colStyle = isShopTable ? (SHOP_COL_STYLES[colName] || '') : '';
                // 구분선에서 파싱한 정렬이 있으면 우선. 없으면 헤더=center, 본문=left 기본.
                const parsedAlign = tableAligns[ci];
                const align = parsedAlign || (isHeader ? 'center' : 'left');
                const baseStyle = `border:1px solid var(--border); padding:10px; background:${isHeader ? 'var(--surface2)' : 'transparent'}; text-align:${align}; font-size:14px; vertical-align:top; word-break:break-word; overflow-wrap:break-word;`;
                let cellContent = cell;
                if (!isHeader && colName === '리뷰수') {
                    const nums = cell.trim().replace(/[^0-9,]/g, '');
                    cellContent = nums || cell;
                }
                return `<${cellTag} style="${baseStyle}${colStyle}">${renderCell(cellContent)}</${cellTag}>`;
            }).join('')}</tr>`;

            tableRows.push(rowHtml);
        } else {
            if (isInsideTable) flushTable();
            result.push(line);
        }
    }
    if (isInsideTable) flushTable();

    // ── 연속 blockquote 줄 합치기
    const bqMerged: string[] = [];
    {
        let bqLines: string[] = [];
        const flushBq = () => {
            if (!bqLines.length) return;
            const inner = bqLines
                .map(l => l + '<br/>')
                .join('')
                .replace(/(<br\/>)+$/, '');
            bqMerged.push(
                `<blockquote style="border-left:3px solid var(--accent);padding:8px 14px;margin:10px 0;` +
                `color:var(--muted);background:rgba(255,255,255,0.04);border-radius:0 6px 6px 0;` +
                `font-style:italic;">${inner}</blockquote>`
            );
            bqLines = [];
        };
        for (const line of result) {
            const m = line.match(/^&gt; ?(.*)/);
            if (m) {
                bqLines.push(m[1]);
            } else {
                flushBq();
                bqMerged.push(line);
            }
        }
        flushBq();
    }

    let html = bqMerged.join('\n')
            .replace(/^(?:---|[*]{3}|___)$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:20px 0;"/>')
            .replace(/^#### (.+)$/gm, '<h4 style="font-size:0.95em;font-weight:700;margin:10px 0;">$1</h4>')
            .replace(/^### (.+)$/gm, '<h3 style="font-size:1.05em;font-weight:700;margin:12px 0;">$1</h3>')
            .replace(/^## (.+)$/gm, '<h2 style="font-size:1.15em;font-weight:700;margin:14px 0;">$1</h2>')
            .replace(/^# (.+)$/gm, '<h1 style="font-size:1.25em;font-weight:700;margin:16px 0;">$1</h1>')
            // ── ul (bullet)
            // ── 리스트: <li> 생성을 먼저 모두 끝낸 뒤에 wrap한다.
            //    (wrap 정규식이 <li> 뒤 개행을 소비하면, 다음 줄의 ^기반 항목 매칭이
            //     깨져 번호 항목이 <li>로 변환되지 않는 문제가 있어 순서를 분리한다.)
            // ol 항목 (원본 숫자를 value로 보존 → 하위 불릿이 껴서 <ol>이 조각나도 번호 유지)
            .replace(/^([ ]*)(\d+)\. +(.+)$/gm, (_, indent, num, content) => {
                const ml = Math.floor(indent.length / 2) * 16;
                return `<li data-ol value="${num}" style="margin:9px 0;list-style-position:outside;margin-left:${ml}px;list-style-type:decimal;">${content.trim()}</li>`;
            })
            // task list: 사용자 입력과 LLM 응답 모두에서 자주 쓰이는 GFM 체크리스트
            .replace(/^([ ]*)[*-] \[([ xX])\] (.+)$/gm, (_, indent, checked, content) => {
                const ml = Math.floor(indent.length / 2) * 16;
                const done = checked.toLowerCase() === 'x';
                return `<li data-ul style="margin:9px 0;margin-left:${ml}px;list-style:none;display:flex;gap:7px;align-items:flex-start;"><input type="checkbox" disabled ${done ? 'checked' : ''} style="margin-top:4px;accent-color:var(--accent);"/><span${done ? ' style="text-decoration:line-through;opacity:.65;"' : ''}>${content.trim()}</span></li>`;
            })
            // ul 항목
            .replace(/^([ ]*)([*-]) (.+)$/gm, (_, indent, _b, content) => {
                const depth = Math.floor(indent.length / 2);
                const ml = depth * 16;
                const marker = depth > 0 ? 'circle' : 'disc';
                return `<li data-ul style="margin:9px 0;list-style-position:outside;margin-left:${ml}px;list-style-type:${marker};">${content.trim()}</li>`;
            })
            // 연속된 같은 종류 <li>를 <ul>/<ol>로 감싼다.
            .replace(/(<li data-ul[^>]*>.*?<\/li>\n?)+/g, m =>
                `<ul style="margin:10px 0;padding-left:22px;">${m.replace(/ data-ul/g, '').replace(/\n/g, '')}</ul>`
            )
            .replace(/(<li data-ol[^>]*>.*?<\/li>\n?)+/g, m =>
                `<ol style="margin:10px 0;padding-left:22px;">${m.replace(/ data-ol/g, '').replace(/\n/g, '')}</ol>`
            )
        // ── inline
        // 링크/이미지/인라인코드를 먼저 플레이스홀더로 빼서 보호한다.
        // (URL 안의 _ 나 * 가 em/strong 치환에 걸려 깨지는 것 방지)
    ;

    // inline 처리: 보호 → 스타일 치환 → 복원
    {
        const protectedTokens: string[] = [];
        const protect = (h: string): string => {
            protectedTokens.push(h);
            return `${MARKDOWN_PROTECTED_TOKEN_PREFIX}${protectedTokens.length - 1}${MARKDOWN_PROTECTED_TOKEN_SUFFIX}`;
        };
        html = html
            // 이미지
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) =>
                isSafeUrl(src, true)
                    ? protect(`<img src="${src}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:8px 0;display:block;cursor:pointer;" />`)
                    : alt
            )
            // 링크
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, linkText, href) =>
                isSafeUrl(href)
                    ? protect(`<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;">${linkText}</a>`)
                    : linkText)
            // 인라인 코드
            .replace(/`([^`]+)`/g, (_m, code) =>
                protect(`<code style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);padding:1.5px 6px;border-radius:5px;font-size:0.86em;font-family:'SF Mono',Menlo,Consolas,monospace;color:var(--code-color);white-space:normal;overflow-wrap: anywhere;">${code}</code>`)
            );

        html = html
            .replace(/[*]{3}(.+?)[*]{3}/g, '<strong><em>$1</em></strong>')
            .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
            .replace(/[*]{2}(.+?)[*]{2}/g, '<strong>$1</strong>')
            .replace(/__(.+?)__/g, '<strong>$1</strong>')
            .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
            // 언더스코어 이탤릭은 단어 내부(intra-word)엔 적용 안 함(GFM 표준).
            // → URL/식별자의 _ 가 <em> 으로 깨지지 않는다.
            .replace(/(^|[^0-9A-Za-z가-힣])_([^_\n]+?)_(?=[^0-9A-Za-z가-힣]|$)/g, '$1<em>$2</em>')
            .replace(/~~(.+?)~~/g, '<del style="opacity:0.6;">$1</del>');

        // 복원
        const protectedTokenPattern = new RegExp(
            `${MARKDOWN_PROTECTED_TOKEN_PREFIX}(\\d+)${MARKDOWN_PROTECTED_TOKEN_SUFFIX}`,
            'g',
        );
        html = html.replace(protectedTokenPattern, (_m, i) => protectedTokens[Number(i)] || '');
    }
    let finalHtml = html.split('\n').map(line => {
        const l = line.trim();
        if (/^<(h[1-4]|div|table|tbody|tr|td|th|ul|ol|li|hr|br|blockquote)/i.test(l)) return line;
        return l === '' ? '<div class="para-break"></div>' : line + '<br/>';
    }).join('')
        .replace(/<\/(h[1-4]|ul|ol|li|hr|blockquote)><br\/>/g, '</$1>')
        .replace(/(<div class="para-break"><\/div>){2,}/g, '<div class="para-break"></div>')
        .replace(/(<br\/>)+$/g, '');

    finalHtml = finalHtml
        .replace(/XKATEXBLOCK(\d+)X/g, (_, i) => mathPlaceholders[Number(i)] || '')
        .replace(/XKATEXINLINE(\d+)X/g, (_, i) => mathPlaceholders[Number(i)] || '')
        .replace(/CODEBLOCK(\d+)/g, (_, i) => codeBlockTokens[Number(i)] || '')
    ;

    return finalHtml;
};
