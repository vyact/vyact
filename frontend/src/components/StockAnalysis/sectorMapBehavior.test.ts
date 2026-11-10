import {describe, expect, it} from 'vitest';
import {hierarchy, treemap} from 'd3-hierarchy';
import type {MarketSector, SectorStock} from '../../services/stockAnalysis';
import {buildSectorMapTree, type MapNode, mapHeaderHeight} from './sectorMapLayout';
import {previewSortModifier, sortPreviewStocks} from './sectorPreviewSort';
import {sectorPreviewLeft, sectorPreviewTop} from './useSectorPreviewPosition';

const sector: MarketSector = {name: 'Technology', weight: 100, change: 1, stocks: [
    {symbol: 'NVDA', name: 'NVIDIA', industry: 'Semiconductors', weight: 50, price: 100, change: 1},
    {symbol: 'AMD', name: 'AMD', industry: 'Semiconductors', weight: 20, price: 100, change: 1},
    {symbol: 'SNDK', name: 'Sandisk', industry: 'Storage', weight: 25, price: 100, change: 1},
    {symbol: 'UNKNOWN', name: 'Unknown', weight: 5, price: null, change: null},
]};

describe('market-cap and screen-area grouping', () => {
    it('keeps large industries separate and retains every stock in a sector remainder', () => {
        const root = hierarchy(buildSectorMapTree([sector], undefined, true)).sum(node => node.weight ?? 0);
        expect(root.value).toBe(100);
        expect(root.children!.filter(node => node.data.industry).map(node => node.data.industry!.name)).toEqual(['Semiconductors', 'Storage']);
        const rest = root.children!.find(node => node.data.remainder)!;
        expect(rest.data.sector!.stocks.map(stock => stock.symbol)).toEqual(['UNKNOWN']);
        expect(rest.value).toBe(5);
        expect(rest.data.sector!.change).toBeNull();
        expect(root.leaves().map(node => node.data.stock?.symbol)).toEqual(['NVDA', 'AMD', 'SNDK', 'UNKNOWN']);
    });
    it('merges many tiny industries within their original sector, without dropping stocks', () => {
        const tiny = Array.from({length: 10}, (_, index) => ({...sector.stocks[0], symbol: `T${index}`, industry: `Small${index}`, weight: 5}));
        const large = {...sector, stocks: [{...sector.stocks[0], weight: 700}, {...sector.stocks[2], weight: 250}, ...tiny]};
        const root = hierarchy(buildSectorMapTree([large], undefined, true)).sum(node => node.weight ?? 0);
        expect(root.children).toHaveLength(3);
        expect(root.children!.find(node => node.data.remainder)!.data.sector!.stocks).toHaveLength(10);
        expect(root.value).toBe(1000);
        expect(root.leaves()).toHaveLength(12);
    });
    it('uses fewer industry groups on smaller screens', () => {
        const classified = {...sector, stocks: sector.stocks.map(stock => stock.symbol === 'UNKNOWN' ? {...stock, industry: 'Small industry'} : stock)};
        const wide = buildSectorMapTree([classified], undefined, true, {width: 1600, height: 900});
        const narrow = buildSectorMapTree([classified], undefined, true, {width: 400, height: 200});
        expect(wide.children!.filter(node => node.industry)).toHaveLength(3);
        expect(narrow.children!.filter(node => node.industry)).toHaveLength(2);
        expect(narrow.children!.find(node => node.remainder)!.sector!.stocks[0].symbol).toBe('UNKNOWN');
    });
    it('keeps small sectors together, then exposes more industries when zoomed', () => {
        const small = {...sector, name: 'Small sector', stocks: sector.stocks.map(stock => ({...stock, weight: stock.weight / 100}))};
        const full = buildSectorMapTree([sector, small], undefined, true);
        expect(full.children!.find(node => node.sector?.name === 'Small sector')!.children).toHaveLength(4);
        const zoomed = buildSectorMapTree([sector, small], small, true);
        expect(zoomed.children!.filter(node => node.industry)).toHaveLength(2);
    });
    it('does not use the previous stock-count threshold', () => {
        const groups = (stockCount: number) => buildSectorMapTree([{...sector, stockCount}], undefined, true).children!
            .map(node => ({industry: node.industry?.name, remainder: node.remainder, symbols: node.children!.map(child => child.stock!.symbol)}));
        expect(groups(1)).toEqual(groups(1000));
    });
    it('keeps user groups and maps without industry data flat', () => {
        expect(buildSectorMapTree([sector], undefined, false).children![0].children![0].stock?.symbol).toBe('NVDA');
        const unknown = {...sector, stocks: sector.stocks.map(stock => ({...stock, industry: undefined}))};
        expect(buildSectorMapTree([unknown], undefined, true).children![0].children![0].stock?.symbol).toBe('NVDA');
    });
    it('keeps each stock inside its group and below the visible group header', () => {
        const root = hierarchy<MapNode>(buildSectorMapTree([sector], undefined, true)).sum(node => node.weight ?? 0);
        const layout = treemap<MapNode>().size([1000, 600]).paddingInner(2).paddingTop(mapHeaderHeight)(root);
        for (const leaf of layout.leaves()) {
            expect(leaf.y0).toBeGreaterThanOrEqual(leaf.parent!.y0 + mapHeaderHeight(leaf.parent!));
            expect(leaf.x0).toBeGreaterThanOrEqual(leaf.parent!.x0);
            expect(leaf.x1).toBeLessThanOrEqual(leaf.parent!.x1);
        }
    });
});

it('shows only the 15 largest stocks from small industries under the original sector name', () => {
    const smallStocks = Array.from({length: 25}, (_, index) => ({...sector.stocks[0], symbol: `T${index}`, industry: `Small${index}`, weight: index + 1}));
    const mixed = {...sector, stocks: [{...sector.stocks[0], weight: 10000}, ...smallStocks]};
    const tree = buildSectorMapTree([mixed], undefined, true);
    const grouped = tree.children!.find(node => node.remainder)!;
    expect(grouped.sector!.name).toBe('Technology');
    expect(grouped.sector!.stocks.map(stock => stock.symbol)).toEqual(Array.from({length: 15}, (_, index) => `T${24 - index}`));
});

it('also limits a wholly unsplit small sector to its 15 largest stocks', () => {
    const small = {...sector, name: 'Small', stocks: Array.from({length: 25}, (_, index) => ({...sector.stocks[0], symbol: `S${index}`, industry: `Industry${index}`, weight: index + 1}))};
    const large = {...sector, stocks: [{...sector.stocks[0], weight: 1000000}]};
    const tree = buildSectorMapTree([large, small], undefined, true);
    const group = tree.children!.find(node => node.sector?.name === 'Small')!;
    expect(group.children).toHaveLength(15);
    expect(group.children![0].stock!.symbol).toBe('S24');
});

const stocks: SectorStock[] = [
    {symbol: 'LARGE', name: 'Large', weight: 100, price: 100, change: -2},
    {symbol: 'GAIN', name: 'Gain', weight: 80, price: 100, change: 3},
    {symbol: 'ZERO', name: 'Zero', weight: 60, price: 100, change: 0},
    {symbol: 'MISSING', name: 'Missing', weight: 40, price: null, change: null},
    {symbol: 'SMALL', name: 'Small', weight: 1, price: 100, change: 20},
];

describe('modifier-held preview sorting', () => {
    it('uses Command on Mac and Ctrl on Windows/Linux', () => {
        expect(previewSortModifier({metaKey: true, ctrlKey: false}, 'MacIntel')).toBe(true);
        expect(previewSortModifier({metaKey: false, ctrlKey: true}, 'MacIntel')).toBe(false);
        for (const platform of ['Win32', 'Linux x86_64']) {
            expect(previewSortModifier({metaKey: false, ctrlKey: true}, platform)).toBe(true);
            expect(previewSortModifier({metaKey: true, ctrlKey: false}, platform)).toBe(false);
        }
    });
    it('sorts the displayed stocks by descending signed change and puts missing quotes last', () => {
        expect(sortPreviewStocks(stocks, true, 4).map(stock => stock.symbol)).toEqual(['GAIN', 'ZERO', 'LARGE', 'MISSING']);
        expect(stocks[0].symbol).toBe('LARGE');
    });
    it('returns to market-cap order when the modifier is released', () => {
        expect(sortPreviewStocks(stocks, false, 4).map(stock => stock.symbol)).toEqual(['LARGE', 'GAIN', 'ZERO', 'MISSING']);
    });
    it('keeps equal changes in market-cap order', () => {
        expect(sortPreviewStocks(stocks.map(stock => ({...stock, change: 1})), true, 4).map(stock => stock.symbol))
            .toEqual(['LARGE', 'GAIN', 'ZERO', 'MISSING']);
    });
});

describe('sector preview horizontal tracking', () => {
    it('appears to the right of the pointer when there is room and follows its movement', () => {
        expect(sectorPreviewLeft(400, 1200, 440)).toBe(480);
        expect(sectorPreviewLeft(500, 1200, 440)).toBe(580);
        expect(sectorPreviewLeft(600, 1200, 440)).toBe(680);
    });
    it('switches to the left when the right side has insufficient room', () => {
        expect(sectorPreviewLeft(900, 1200, 440)).toBe(380);
        expect(sectorPreviewLeft(1000, 1200, 440)).toBe(480);
        expect(sectorPreviewLeft(672, 1200, 440)).toBe(752);
        expect(sectorPreviewLeft(673, 1200, 440)).toBe(153);
    });
    it('leaves a gap instead of covering the pointer whenever either side fits', () => {
        for (let x = 0; x <= 1200; x += 10) {
            const left = sectorPreviewLeft(x, 1200, 440);
            expect(left >= x + 80 || left + 440 <= x - 80).toBe(true);
        }
    });
    it('keeps the panel inside the map, including narrow maps', () => {
        expect(sectorPreviewLeft(0, 1200, 440)).toBe(80);
        expect(sectorPreviewLeft(1200, 1200, 440)).toBe(680);
        expect(sectorPreviewLeft(150, 300, 284)).toBe(8);
    });
});

describe('sector preview vertical tracking', () => {
    it('aligns its top edge to the pointer while there is room below', () => {
        expect(sectorPreviewTop(200, 1000, 400)).toBe(200);
        expect(sectorPreviewTop(400, 1000, 400)).toBe(400);
    });
    it('moves upward to stay inside the map when the pointer is near the bottom', () => {
        expect(sectorPreviewTop(900, 1000, 400)).toBe(592);
        expect(sectorPreviewTop(900, 1000, 600)).toBe(392);
    });
    it('keeps the top margin for a pointer at the top and a full-height preview', () => {
        expect(sectorPreviewTop(0, 1000, 400)).toBe(8);
        expect(sectorPreviewTop(700, 1000, 984)).toBe(8);
    });
});
