import {Plugin} from '@tiptap/pm/state';
import {Decoration, DecorationSet} from '@tiptap/pm/view';

export function manuscriptImageSelectionPlugin(): Plugin {
    return new Plugin({
        props: {
            decorations(state) {
                const {from, to, empty} = state.selection;
                if (empty) return DecorationSet.empty;
                const decorations: Decoration[] = [];
                state.doc.nodesBetween(from, to, (node, position) => {
                    if (node.type.name === 'memoImage' && from <= position && to >= position + node.nodeSize) {
                        decorations.push(Decoration.node(position, position + node.nodeSize, {class: 'novel-image-range-selected'}));
                    }
                });
                return DecorationSet.create(state.doc, decorations);
            },
        },
    });
}
