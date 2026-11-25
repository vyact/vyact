import {chatSnapshotPng, MAX_CHAT_IMAGE_DIMENSION} from './chartSnapshot';

const PADDING = 12;
const TITLE_HEIGHT = 28;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

function drawCellText(context: CanvasRenderingContext2D, cell: HTMLTableCellElement, bounds: DOMRect) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim() || !node.parentElement) continue;
        const style = getComputedStyle(node.parentElement);
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        context.fillStyle = style.color;
        context.textAlign = 'left';
        context.direction = style.direction === 'rtl' ? 'rtl' : 'ltr';
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const text = node.textContent.trim();
        if (range.getClientRects().length > 1) {
            const cellBounds = cell.getBoundingClientRect();
            const padding = parseFloat(getComputedStyle(cell).paddingLeft);
            context.fillText(text, cellBounds.left - bounds.left + padding,
                cellBounds.top - bounds.top + cellBounds.height / 2, cellBounds.width - padding * 2);
        } else {
            context.fillText(text, rect.left - bounds.left, rect.top - bounds.top + rect.height / 2, rect.width);
        }
    }
}

export async function captureFinancialStatement(statement: HTMLElement): Promise<Blob | null> {
    const table = statement.querySelector('table');
    const title = statement.querySelector('h3');
    if (!table || !title) return null;

    table.dataset.capturing = '';
    try {
        const bounds = table.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return null;
        const width = bounds.width + PADDING * 2;
        const height = bounds.height + TITLE_HEIGHT + PADDING * 2;
        const scale = Math.min(window.devicePixelRatio || 1, MAX_CHAT_IMAGE_DIMENSION / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const context = canvas.getContext('2d');
        if (!context) return null;

        const theme = getComputedStyle(statement);
        context.scale(canvas.width / width, canvas.height / height);
        context.fillStyle = theme.getPropertyValue('--bg').trim();
        context.fillRect(0, 0, width, height);
        context.textBaseline = 'middle';
        context.fillStyle = getComputedStyle(title).color;
        context.font = `600 14px ${getComputedStyle(title).fontFamily}`;
        const symbol = statement.closest<HTMLElement>('.stock-financials')?.dataset.symbol;
        const caption = symbol ? `${symbol} · ${title.textContent}` : title.textContent ?? '';
        context.fillText(caption, PADDING, PADDING + TITLE_HEIGHT / 2, bounds.width);
        context.translate(PADDING, PADDING + TITLE_HEIGHT);
        for (const row of table.rows) {
            for (const cell of row.cells) {
                const rect = cell.getBoundingClientRect();
                const style = getComputedStyle(cell);
                const x = rect.left - bounds.left;
                const y = rect.top - bounds.top;
                const background = style.backgroundColor === TRANSPARENT
                    ? getComputedStyle(row.parentElement!).backgroundColor
                    : style.backgroundColor;
                if (background !== TRANSPARENT) {
                    context.fillStyle = background;
                    context.fillRect(x, y, rect.width, rect.height);
                }
                if (parseFloat(style.borderBottomWidth) > 0) {
                    context.fillStyle = style.borderBottomColor;
                    context.fillRect(x, y + rect.height - 1, rect.width, 1);
                }
                drawCellText(context, cell, bounds);
            }
        }
        return chatSnapshotPng(canvas);
    } finally {
        delete table.dataset.capturing;
    }
}
