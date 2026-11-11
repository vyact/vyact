export type DragBounds = {left: number; top: number; width: number; height: number};
export function movedDragBounds(source: DragBounds, grabX: number, grabY: number, x: number, y: number): DragBounds {
    return {left: x - grabX, top: y - grabY, width: source.width, height: source.height};
}
export function overlapArea(first: DragBounds, second: DragBounds): number {
    return Math.max(0, Math.min(first.left + first.width, second.left + second.width) - Math.max(first.left, second.left))
        * Math.max(0, Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top));
}
