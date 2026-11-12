import {renderToStaticMarkup} from 'react-dom/server';
import type {ReactNode} from 'react';
import {beforeEach, expect, it, vi} from 'vitest';
import StockGroupDiscussionPanel from './StockGroupDiscussionPanel';

const state = vi.hoisted(() => ({props: {} as Record<string, unknown>, selectedIds: [] as string[], onChange: (_value: string) => {}}));
vi.mock('react', () => ({useState: () => [state.selectedIds, (update: (value: string[]) => string[]) => {state.selectedIds = update(state.selectedIds);}]}));
beforeEach(() => {state.selectedIds = [];});
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('./StockDiscussionPanel', () => ({default: (props: Record<string, unknown>) => {
    state.props = props;
    return <div>{props.groupPicker as ReactNode}</div>;
}}));
vi.mock('../CustomSelect/CustomSelect', () => ({default: ({options, onChange}: {options: {value: string; label: string}[]; onChange: (value: string) => void}) => {
    state.onChange = onChange;
    return <select>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}}));

it('offers all groups and individual groups and passes their complete membership', () => {
    const groups = [{id: 'ai', market: 'KR' as const, name: 'AI', symbols: ['005930', '000660']},
        {id: 'power', market: 'KR' as const, name: 'Power', symbols: ['267260']}];
    const html = renderToStaticMarkup(<StockGroupDiscussionPanel groups={groups} market="KR" directory={[]}/>);
    expect(html).toContain('stockAnalysis.groups.all');
    expect(html).toContain('AI');
    expect(html).toContain('Power');
    expect(state.props.groups).toEqual(groups);
    expect(state.props.stock).toMatchObject({symbol: 'MARKET-KR', name: 'stockAnalysis.groups.all'});
});

it('combines selected groups, toggles them, and restores all groups', () => {
    const groups = [{id: 'ai', market: 'KR' as const, name: 'AI', symbols: ['005930']},
        {id: 'power', market: 'KR' as const, name: 'Power', symbols: ['005930', '267260']},
        {id: 'ships', market: 'KR' as const, name: 'Ships', symbols: ['009540']}];
    const render = () => renderToStaticMarkup(<StockGroupDiscussionPanel groups={groups} market="KR" directory={[]}/>);
    render(); state.onChange('ai'); render(); state.onChange('power'); render();
    expect(state.props.groups).toEqual(groups.slice(0, 2));
    expect(state.props.stock).toMatchObject({symbol: 'MARKET-KR', name: 'AI, Power'});
    state.onChange('ai'); render();
    expect(state.props.groups).toEqual([groups[1]]);
    state.onChange('power'); render();
    expect(state.props.groups).toEqual([groups[1]]);
    state.onChange(''); render();
    expect(state.props.groups).toEqual(groups);
});
