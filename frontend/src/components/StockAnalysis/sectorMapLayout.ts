import type {HierarchyRectangularNode} from 'd3-hierarchy';
import type {MarketSector, SectorStock} from '../../services/stockAnalysis';

export const UNCLASSIFIED_INDUSTRY = '__unclassified__';
export const MIN_INDUSTRY_CAP_SHARE = 0.01;
export const MIN_INDUSTRY_AREA = 16000;
export const SECTOR_FALLBACK_STOCK_LIMIT = 15;
export const SECTOR_HEADER_HEIGHT = 24;
export const INDUSTRY_HEADER_HEIGHT = 24;
const DEFAULT_VIEWPORT = {width: 1600, height: 900};
export interface IndustryGroup {name: string; sector: MarketSector; stocks: SectorStock[]}
export interface MapNode {
    sector?: MarketSector;
    industry?: IndustryGroup;
    remainder?: boolean;
    stock?: SectorStock;
    weight?: number;
    children?: MapNode[];
}

export function stockIndustry(stock: SectorStock): string {
    return stock.industry?.trim() || UNCLASSIFIED_INDUSTRY;
}

function stockNodes(entries: SectorStock[]): MapNode[] {
    return entries.map(stock => ({stock, weight: stock.weight}));
}

function sectorNode(sector: MarketSector, entries: SectorStock[], remainder = false): MapNode {
    const weight = entries.reduce((total, stock) => total + stock.weight, 0);
    const quoted = entries.filter(stock => stock.change != null);
    const quotedWeight = quoted.reduce((total, stock) => total + stock.weight, 0);
    return {sector: {...sector, stocks: entries, stockCount: entries.length, weight,
        change: quotedWeight ? quoted.reduce((total, stock) => total + stock.weight * stock.change!, 0) / quotedWeight : null},
    remainder, children: stockNodes(entries)};
}

function displayGroups(sector: MarketSector, withIndustries: boolean, totalWeight: number, area: number): MapNode[] {
    const largest = (entries: SectorStock[]) => [...entries].sort((a, b) => b.weight - a.weight).slice(0, SECTOR_FALLBACK_STOCK_LIMIT);
    if (!withIndustries) return [sectorNode(sector, sector.stocks)];
    if (!totalWeight || !sector.stocks.some(stock => stock.industry?.trim())) return [sectorNode(sector, largest(sector.stocks))];
    const groups = new Map<string, SectorStock[]>();
    for (const stock of sector.stocks) {
        const name = stockIndustry(stock);
        const entries = groups.get(name) ?? [];
        entries.push(stock);
        groups.set(name, entries);
    }
    const result: MapNode[] = [];
    const remaining: SectorStock[] = [];
    for (const [name, entries] of groups) {
        const share = entries.reduce((total, stock) => total + stock.weight, 0) / totalWeight;
        if (name !== UNCLASSIFIED_INDUSTRY && share >= MIN_INDUSTRY_CAP_SHARE && share * area >= MIN_INDUSTRY_AREA) {
            result.push({industry: {name, sector, stocks: entries}, children: stockNodes(entries)});
        } else remaining.push(...entries);
    }
    if (!result.length) return [sectorNode(sector, largest(sector.stocks))];
    if (remaining.length) result.push(sectorNode(sector, largest(remaining), true));
    return result;
}

export function buildSectorMapTree(sectors: MarketSector[], selected: MarketSector | undefined, withIndustries: boolean,
    viewport = DEFAULT_VIEWPORT): MapNode {
    const sector = selected && sectors.find(item => item.name === selected.name);
    const visible = sector ? [sector] : sectors;
    const totalWeight = visible.reduce((sum, item) => sum + item.stocks.reduce((total, stock) => total + stock.weight, 0), 0);
    const children = visible.flatMap(item => displayGroups(item, withIndustries, totalWeight, viewport.width * viewport.height));
    // A sector that has not been split already has its name in the page heading when zoomed.
    return {children: sector && children.length === 1 && children[0].sector && !children[0].remainder
        ? children[0].children : children};
}

export function mapHeaderHeight(node: HierarchyRectangularNode<MapNode>): number {
    if (node.data.sector) return node.y1 - node.y0 >= 34 ? SECTOR_HEADER_HEIGHT : 0;
    if (node.data.industry) return node.x1 - node.x0 >= 28 && node.y1 - node.y0 >= INDUSTRY_HEADER_HEIGHT + 8 ? INDUSTRY_HEADER_HEIGHT : 0;
    return 0;
}
