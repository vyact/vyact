import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { parseMemoMarkdown } from './memoMarkdown';

const MD_PATTERN = /(^#{1,6} )|(^\*\*.+\*\*)|(^```)|(^[*-] )|(^> )|(^\d+\. )|(^\|.+\|)/m;

export const MarkdownPaste = Extension.create({
    name: 'markdownPaste',

    addProseMirrorPlugins() {
        const editor = this.editor;
        return [
            new Plugin({
                key: new PluginKey('markdownPaste'),
                props: {
                    handlePaste(_view, event) {
                        const text = event.clipboardData?.getData('text/plain');
                        if (!text || !MD_PATTERN.test(text.trim())) return false;
                        if (editor.isActive('codeBlock') || editor.isActive('code')) return false;

                        event.preventDefault();
                        const segments = parseMemoMarkdown(text);

                        segments.forEach(seg => {
                            if (seg.type === 'codeBlock') {
                                editor.commands.insertContent({
                                    type: 'codeBlock',
                                    attrs: { language: seg.lang || null },
                                    content: seg.content ? [{ type: 'text', text: seg.content }] : [],
                                });
                            } else if (seg.type === 'taskList' && seg.tasks) {
                                editor.commands.insertContent({
                                    type: 'taskList',
                                    content: seg.tasks.map(t => ({
                                        type: 'taskItem',
                                        attrs: { checked: t.checked },
                                        content: [{ type: 'paragraph', content: [{ type: 'text', text: t.text }] }],
                                    })),
                                });
                            } else {
                                if (seg.content.trim()) {
                                    editor.commands.insertContent(seg.content);
                                }
                            }
                        });

                        return true;
                    },
                },
            }),
        ];
    },
});