import {expect, it} from 'vitest';
import {movedDragBounds, overlapArea} from './indexDragGeometry';

it('accepts card overlap while the pointer remains outside the header', () => {
    const source = {left: 100, top: 300, width: 400, height: 100};
    const moved = movedDragBounds(source, 200, 50, 300, 80);
    const header = {left: 0, top: 0, width: 1000, height: 60};
    expect(80).toBeGreaterThan(header.height);
    expect(overlapArea(moved, header)).toBeGreaterThan(0);
});
it('rejects separated rectangles and respects where the card was grabbed', () => {
    const source = {left: 100, top: 300, width: 400, height: 100};
    expect(movedDragBounds(source, 200, 50, 300, 350)).toEqual(source);
    expect(overlapArea(source, {left: 0, top: 0, width: 1000, height: 60})).toBe(0);
});

it('preserves browser DOMRect dimensions exposed as prototype getters', () => {
    class BrowserRect {
        get left() {return 100;}
        get top() {return 300;}
        get width() {return 400;}
        get height() {return 100;}
    }
    const moved = movedDragBounds(new BrowserRect(), 200, 50, 300, 80);
    expect(moved).toEqual({left: 100, top: 30, width: 400, height: 100});
    expect(overlapArea(moved, {left: 0, top: 0, width: 1000, height: 60})).toBe(12000);
});
