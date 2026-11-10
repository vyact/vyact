import type {SectorStock} from '../../services/stockAnalysis';

export function previewSortModifier(event: {metaKey: boolean; ctrlKey: boolean}, platform: string): boolean {
    return /mac/i.test(platform) ? event.metaKey : event.ctrlKey;
}

export function sortPreviewStocks(stocks: SectorStock[], byChange: boolean, limit: number): SectorStock[] {
    const visible = [...stocks].sort((a, b) => b.weight - a.weight).slice(0, limit);
    if (!byChange) return visible;
    return visible.sort((a, b) => {
        if (a.change == null) return b.change == null ? 0 : 1;
        if (b.change == null) return -1;
        return b.change - a.change;
    });
}
