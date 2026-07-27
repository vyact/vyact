import { Extension } from '@tiptap/core';

const ALIGNABLE_NODE_TYPES = [
    'paragraph', 'heading', 'blockquote', 'listItem', 'tableCell', 'tableHeader', 'memoImage',
];

export const MemoTextAlign = Extension.create({
    name: 'memoTextAlign',

    addGlobalAttributes() {
        return [{
            types: ALIGNABLE_NODE_TYPES,
            attributes: {
                textAlign: {
                    default: null,
                    parseHTML: element => element.style.textAlign || null,
                    renderHTML: attributes => attributes.textAlign
                        ? { style: `text-align: ${attributes.textAlign}` }
                        : {},
                },
            },
        }];
    },
});
