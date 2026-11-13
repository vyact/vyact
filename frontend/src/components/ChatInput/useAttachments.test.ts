import type {ChangeEvent, ClipboardEvent} from 'react';
import {beforeEach, expect, it, vi} from 'vitest';
import {useAttachments} from './useAttachments';

const state = vi.hoisted(() => ({values: [] as unknown[], cursor: 0, warning: vi.fn()}));
vi.mock('react', () => ({
    useState: (initial: unknown) => {
        const index = state.cursor++;
        if (!(index in state.values)) state.values[index] = initial;
        return [state.values[index], (update: unknown) => {
            state.values[index] = typeof update === 'function' ? update(state.values[index]) : update;
        }];
    },
    useRef: () => ({current: null}),
    useEffect: () => {},
    useCallback: (callback: unknown) => callback,
}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('../common/ToastNotifications/ToastNotifications', () => ({toast: {warning: state.warning}}));

const render = () => {state.cursor = 0; return useAttachments('chat', [], undefined, undefined, true, false);};
const image = (name: string) => new File(['image'], name, {type: 'image/png'});
const document = (name: string) => new File(['document'], name, {type: 'application/pdf'});
beforeEach(() => {state.values = []; state.cursor = 0; state.warning.mockClear();});

it('attaches all selected files and appends another selection', () => {
    render().handleFileSelect({target: {files: [image('one.png'), image('two.png'), document('report.pdf')]}} as unknown as ChangeEvent<HTMLInputElement>);
    expect(render().images.map(file => file.name)).toEqual(['one.png', 'two.png']);
    expect(render().fileAttachments.map(({file}) => file.name)).toEqual(['report.pdf']);
    render().handleFileSelect({target: {files: [document('second.pdf')]}} as unknown as ChangeEvent<HTMLInputElement>);
    expect(render().fileAttachments.map(({file}) => file.name)).toEqual(['report.pdf', 'second.pdf']);
});

it('accepts mixed dropped files with the same limits and media validation', () => {
    render().addFiles([...Array.from({length: 7}, (_, i) => image(`${i}.png`)),
        ...Array.from({length: 12}, (_, i) => document(`${i}.pdf`)),
        new File(['audio'], 'recording.mp3', {type: 'audio/mpeg'})]);
    expect(render().images).toHaveLength(5);
    expect(render().fileAttachments).toHaveLength(10);
    expect(state.warning).toHaveBeenCalledWith('fileUpload.audioNotSupported');
});

it('pastes every clipboard image instead of just the first', () => {
    const preventDefault = vi.fn();
    const images = [image('one.png'), image('two.png')];
    render().handlePaste({preventDefault, clipboardData: {items: images.map(file => ({type: file.type, getAsFile: () => file}))}} as unknown as ClipboardEvent<HTMLTextAreaElement>);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(render().images).toEqual(images);
});
