import {describe, expect, it} from 'vitest';
import {Schema} from '@tiptap/pm/model';
import {AllSelection, EditorState, TextSelection} from '@tiptap/pm/state';
import type {DecorationSet} from '@tiptap/pm/view';
import {manuscriptImageSelectionPlugin} from './manuscriptImageSelection';

const schema = new Schema({nodes: {
    doc: {content: 'block+'},
    paragraph: {group: 'block', content: 'text*'},
    text: {group: 'inline'},
    memoImage: {group: 'block', atom: true},
}});

describe('manuscript image range selection', () => {
    it('highlights every image in select-all and clears highlights when the cursor collapses', () => {
        const doc = schema.node('doc', null, [schema.node('memoImage'), schema.node('paragraph', null, schema.text('본문')), schema.node('memoImage')]);
        const plugin = manuscriptImageSelectionPlugin();
        let state = EditorState.create({doc, plugins: [plugin], selection: new AllSelection(doc)});
        const decorations = () => (plugin.props.decorations!.call(plugin, state) as DecorationSet).find();
        expect(decorations().map(item => item.from)).toEqual([0, 5]);
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 3)));
        expect(decorations()).toHaveLength(0);
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
        expect(decorations()).toHaveLength(0);
    });
});
