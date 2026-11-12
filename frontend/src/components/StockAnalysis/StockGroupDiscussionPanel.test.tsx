import {renderToStaticMarkup} from 'react-dom/server';
import type {ReactNode} from 'react';
import {expect, it, vi} from 'vitest';
import StockGroupDiscussionPanel from './StockGroupDiscussionPanel';

const state = vi.hoisted(() => ({props: {} as Record<string, unknown>}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('./StockDiscussionPanel', () => ({default: (props: Record<string, unknown>) => {
    state.props = props;
    return <div>{props.groupPicker as ReactNode}</div>;
}}));
vi.mock('../CustomSelect/CustomSelect', () => ({default: ({options}: {options: {value: string; label: string}[]}) =>
    <select>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}));

it('offers all groups and individual groups and passes their complete membership', () => {
    const groups = [{id: 'ai', market: 'KR' as const, name: 'AI', symbols: ['005930', '000660']},
        {id: 'power', market: 'KR' as const, name: 'Power', symbols: ['267260']}];
    const html = renderToStaticMarkup(<StockGroupDiscussionPanel groups={groups} market="KR" directory={[]}/>);
    expect(html).toContain('stockAnalysis.groups.all');
    expect(html).toContain('AI');
    expect(html).toContain('Power');
    expect(state.props.groups).toEqual(groups);
    expect(state.props.stock).toMatchObject({name: 'stockAnalysis.groups.all'});
});
