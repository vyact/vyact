import {chartSnapshotPng, MAX_CHAT_IMAGE_DIMENSION} from './chartSnapshot';

const CARD_SELECTOR = '.stock-global-card, .stock-market-index-card';
const PANEL_PADDING = 8;
const PANEL_GAP = 8;

function drawCard(context: CanvasRenderingContext2D, card: HTMLElement) {
    const bounds = card.getBoundingClientRect();
    const surface = card.querySelector<HTMLElement>('.stock-market-index') ?? card;
    const style = getComputedStyle(surface);
    context.save();
    context.translate(bounds.left, bounds.top);
    context.beginPath();
    context.roundRect(.5, .5, bounds.width - 1, bounds.height - 1, parseFloat(style.borderRadius) || 0);
    context.fillStyle = style.backgroundColor === 'rgba(0, 0, 0, 0)'
        ? style.getPropertyValue('--bg-secondary').trim()
        : style.backgroundColor;
    context.fill();
    context.strokeStyle = style.borderColor;
    context.stroke();
    context.clip();

    const textNodes = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    context.textBaseline = 'middle';
    for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
        const text = node.textContent?.trim();
        if (!text || !node.parentElement) continue;
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const label = getComputedStyle(node.parentElement);
        context.fillStyle = label.color;
        context.font = `${label.fontWeight} ${label.fontSize} ${label.fontFamily}`;
        context.direction = label.direction === 'rtl' ? 'rtl' : 'ltr';
        context.textAlign = 'left';
        const x = rect.left - bounds.left;
        const width = Math.min(rect.width, bounds.width - x - 4);
        if (width > 0) context.fillText(text, x, rect.top - bounds.top + rect.height / 2, width);
    }

    for (const sparkline of card.querySelectorAll<SVGSVGElement>('svg.stock-sparkline')) {
        const points = sparkline.querySelector('polyline')?.points;
        const rect = sparkline.getBoundingClientRect();
        const viewBox = sparkline.viewBox.baseVal;
        if (!points?.numberOfItems || !rect.width || !rect.height || !viewBox.width || !viewBox.height) continue;
        context.save();
        const sparklineStyle = getComputedStyle(sparkline);
        context.translate(rect.left - bounds.left, rect.top - bounds.top);
        context.scale(rect.width / viewBox.width, rect.height / viewBox.height);
        context.strokeStyle = sparklineStyle.color;
        context.globalAlpha = Number(sparklineStyle.opacity);
        context.lineWidth = 1.8;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        for (let index = 0; index < points.numberOfItems; index++) {
            const point = points.getItem(index);
            context.lineTo(point.x, point.y);
        }
        context.stroke();
        context.restore();
    }
    context.restore();
}

export async function captureMarketSummary(content: HTMLElement): Promise<Blob | null> {
    const indicators = content.querySelector<HTMLElement>('.stock-global-grid');
    const indices = content.querySelector<HTMLElement>('.stock-market-indices');
    if (!indicators || !indices) return null;
    const sections = [indicators, indices].map(section => ({
        bounds: section.getBoundingClientRect(),
        cards: [...section.querySelectorAll<HTMLElement>(CARD_SELECTOR)],
    }));
    if (sections.some(({bounds, cards}) => !bounds.width || !bounds.height || !cards.length)) return null;

    const width = Math.max(...sections.map(({bounds}) => bounds.width)) + PANEL_PADDING * 2;
    const height = sections.reduce((total, {bounds}) => total + bounds.height, PANEL_PADDING * 2 + PANEL_GAP);
    const scale = Math.min(window.devicePixelRatio || 1, MAX_CHAT_IMAGE_DIMENSION / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.scale(canvas.width / width, canvas.height / height);
    context.fillStyle = getComputedStyle(content).getPropertyValue('--bg').trim();
    context.fillRect(0, 0, width, height);
    let top = PANEL_PADDING;
    for (const {bounds, cards} of sections) {
        context.save();
        context.translate(PANEL_PADDING - bounds.left, top - bounds.top);
        for (const card of cards) drawCard(context, card);
        context.restore();
        top += bounds.height + PANEL_GAP;
    }
    return chartSnapshotPng(canvas, MAX_CHAT_IMAGE_DIMENSION);
}
