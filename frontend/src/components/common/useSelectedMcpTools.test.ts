import {beforeEach, expect, it, vi} from 'vitest';
import useSelectedMcpTools from './useSelectedMcpTools';

const state = vi.hoisted(() => ({servers: [
    {id: 'keen', type: 'keenable', enabled: false}, {id: 'tavily', type: 'web_search', enabled: true},
]}));
vi.mock('react', () => ({useState: () => [state.servers, vi.fn()], useEffect: (effect: () => unknown) => {effect();}}));
vi.mock('../../services/api', () => ({api: {getMcpServers: async () => ({servers: state.servers})}}));
vi.mock('../../utils/mcpEvents', () => ({onMcpServersChanged: () => () => {}}));
beforeEach(() => vi.clearAllMocks());
it('defaults to Keenable without depending on global enabled state', () => {
    const save = vi.fn();
    useSelectedMcpTools(undefined, save, 'keenable');
    expect(save).toHaveBeenCalledWith(['keen']);
});
it('preserves explicit empty selection and other selected tools', () => {
    const save = vi.fn();
    expect(useSelectedMcpTools([], save, 'keenable').selectedServers).toEqual([]);
    expect(useSelectedMcpTools(['tavily'], save, 'keenable').selectedServers.map(server => server.id)).toEqual(['tavily']);
    expect(save).not.toHaveBeenCalled();
});
it('does not change defaults for callers without a default type', () => {
    const save = vi.fn();
    useSelectedMcpTools([], save);
    expect(save).not.toHaveBeenCalled();
});
