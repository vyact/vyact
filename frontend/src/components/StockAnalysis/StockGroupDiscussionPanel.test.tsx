import {renderToStaticMarkup} from 'react-dom/server';
import type {ReactNode} from 'react';
import {beforeEach, expect, it, vi} from 'vitest';
import StockGroupDiscussionPanel from './StockGroupDiscussionPanel';

const state = vi.hoisted(() => ({
    props: {} as Record<string, unknown>, selectedIds: [] as string[], sampleSize: 3 as number | 'all',
    onChange: (_value: string) => {}, onSampleChange: (_value: string) => {},
}));
vi.mock('react', () => ({useState: (initial: unknown) => typeof initial === 'function'
    ? [state.sampleSize, (size: number | 'all') => {state.sampleSize = size;}]
    : [state.selectedIds, (update: (value: string[]) => string[]) => {state.selectedIds = update(state.selectedIds);}]}));
beforeEach(() => {state.selectedIds = []; state.sampleSize = 3;});
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('./StockDiscussionPanel', () => ({default: (props: Record<string, unknown>) => {
    state.props = props;
    return <div>{props.groupPicker as ReactNode}{props.groupSampling as ReactNode}</div>;
}}));
vi.mock('../CustomSelect/CustomSelect', () => ({default: ({ariaLabel, options, onChange}: {
    ariaLabel: string; options: {value: string; label: string}[]; onChange: (value: string) => void;
}) => {
    if (ariaLabel === 'stockAnalysis.groups.topPerSector') state.onSampleChange = onChange;
    else state.onChange = onChange;
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

it('keeps sampling available for an individual sector and supports including all constituents', () => {
    const groups = [{id: 'tech', market: 'KR' as const, name: 'Tech', symbols: ['A', 'B', 'C', 'D']}];
    const weights = {A: 1, B: 3, C: 2, D: 4};
    const render = () => renderToStaticMarkup(
        <StockGroupDiscussionPanel groups={groups} market="KR" directory={[]} scopeType="sector" weights={weights}/>,
    );
    render();
    state.onChange('tech');
    expect(render()).toContain('<option value="all">stockAnalysis.allStocks</option>');
    expect(state.props.groups).toEqual([{...groups[0], symbols: ['D', 'B', 'C'], totalStocks: 4, selectionLimit: 3}]);
    state.onSampleChange('all');
    render();
    expect(state.props.groups).toEqual(groups);
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
