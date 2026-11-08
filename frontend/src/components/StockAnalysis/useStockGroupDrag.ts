import {useState, type DragEvent} from 'react';

type DragItem = {groupId: string; symbol?: string};
type DropItem = DragItem & {after: boolean};
const sameItem = (a: DragItem | null, b: DragItem) => a?.groupId === b.groupId && a.symbol === b.symbol;

export default function useStockGroupDrag(onMove: (source: DragItem, target: DropItem) => void) {
    const [dragged, setDragged] = useState<DragItem | null>(null);
    const [target, setTarget] = useState<DropItem | null>(null);
    const finish = () => {setDragged(null); setTarget(null);};
    return (item: DragItem) => ({
        draggable: true,
        'data-dragging': sameItem(dragged, item),
        'data-drop': sameItem(target, item) ? target?.after ? 'after' : 'before' : undefined,
        onDragStart: (event: DragEvent<HTMLElement>) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-vyact-stock-group', JSON.stringify(item));
            setDragged(item);
        },
        onDragOver: (event: DragEvent<HTMLElement>) => {
            if (!dragged || sameItem(dragged, item) || !!dragged.symbol !== !!item.symbol
                || (item.symbol && dragged.groupId !== item.groupId)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            const bounds = event.currentTarget.getBoundingClientRect();
            setTarget({...item, after: event.clientY > bounds.top + bounds.height / 2});
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null) && sameItem(target, item)) setTarget(null);
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragged && target && sameItem(target, item)) onMove(dragged, target);
            finish();
        },
        onDragEnd: finish,
    });
}
