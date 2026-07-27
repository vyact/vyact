/** HTML을 직접 조립하는 렌더러에서 실행 URL을 차단한다. */
export const isSafeUrl = (url: string, allowImageData = false): boolean => {
    const normalized = url.trim().replace(/&amp;/g, '&').toLowerCase();
    return /^(https?:\/\/|\/(?!\/)|\.\/|\.\.\/)/.test(normalized)
        || (allowImageData && /^data:image\/(?:png|gif|jpe?g|webp);base64,/.test(normalized));
};

/** 이스케이프된 GFM 표 행을 셀로 분리한다. escaped pipe와 inline code의 pipe를 보존한다. */
export const splitTableCells = (line: string): string[] => {
    const cells: string[] = [];
    let cell = '';
    let inCode = false;
    for (let i = 1; i < line.length - 1; i++) {
        const char = line[i];
        if (char === '`') inCode = !inCode;
        if (char === '\\' && line[i + 1] === '|') {
            cell += '|';
            i++;
        } else if (char === '|' && !inCode) {
            cells.push(cell);
            cell = '';
        } else {
            cell += char;
        }
    }
    cells.push(cell);
    return cells;
};
