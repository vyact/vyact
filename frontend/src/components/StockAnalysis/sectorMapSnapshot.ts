import {MAX_CHAT_IMAGE_DIMENSION} from './chartSnapshot';

function drawLabel(context: CanvasRenderingContext2D, label: HTMLElement, x: number, y: number, width: number) {
    const style = getComputedStyle(label);
    context.fillStyle = style.color;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = label.textContent ?? '';
    if (context.measureText(text).width <= width) {
        context.fillText(text, x, y);
        return;
    }
    const characters = Array.from(text);
    while (characters.length && context.measureText(`${characters.join('')}…`).width > width) characters.pop();
    if (characters.length) context.fillText(`${characters.join('')}…`, x, y);
}

export function captureSectorMap(surface: HTMLDivElement): HTMLCanvasElement | null {
    const tiles = surface.querySelector('.stock-sector-map-tiles');
    const bounds = tiles?.getBoundingClientRect();
    if (!tiles || !bounds?.width || !bounds.height || !tiles.childElementCount) return null;

    const scale = Math.min(window.devicePixelRatio || 1, MAX_CHAT_IMAGE_DIMENSION / Math.max(bounds.width, bounds.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bounds.width * scale));
    canvas.height = Math.max(1, Math.round(bounds.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.scale(canvas.width / bounds.width, canvas.height / bounds.height);
    context.fillStyle = getComputedStyle(surface).backgroundColor;
    context.fillRect(0, 0, bounds.width, bounds.height);
    context.textBaseline = 'middle';
    // Headers are stacked above tiles in the live map.
    for (const selector of ['.stock-sector-map-tile', '.stock-sector-map-group, .stock-sector-map-industry']) {
        for (const tile of tiles.querySelectorAll<HTMLElement>(selector)) {
            const rect = tile.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            const x = rect.left - bounds.left;
            const y = rect.top - bounds.top;
            const style = getComputedStyle(tile);
            context.save();
            context.beginPath();
            context.roundRect(x, y, rect.width, rect.height, parseFloat(style.borderRadius) || 0);
            context.fillStyle = style.backgroundColor;
            context.fill();
            context.clip();
            if (tile.childElementCount) {
                context.textAlign = 'center';
                for (const label of tile.querySelectorAll<HTMLElement>('strong, span')) {
                    const labelRect = label.getBoundingClientRect();
                    drawLabel(context, label, x + rect.width / 2,
                        labelRect.top - bounds.top + labelRect.height / 2, labelRect.width);
                }
            } else if (tile.textContent) {
                context.textAlign = 'left';
                const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0);
                drawLabel(context, tile, x + padding, y + rect.height / 2, rect.width - padding * 2);
            }
            context.restore();
        }
    }
    return canvas;
}
