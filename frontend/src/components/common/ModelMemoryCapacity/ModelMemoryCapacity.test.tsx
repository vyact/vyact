import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import ModelMemoryCapacity, {MaxContextHelp} from './ModelMemoryCapacity';
import type {VyactHardwareInfo} from '../../../services/api';

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string, options?: {count?: number}) => `${key}${options?.count === undefined ? '' : `:${options.count}`}`})}));
vi.mock('../Tooltip/Tooltip', () => ({Tooltip: ({children}: {children: React.ReactNode}) => <>{children}</>}));
const hardware: VyactHardwareInfo = {
    platform: 'darwin', apple_silicon: true, memory_mode: 'unified',
    system_memory: {total_bytes: 24 * 1024 ** 3, available_bytes: 4 * 1024 ** 3},
    metal_recommended_working_set_bytes: 19_069_665_280, gpus: [],
};
describe('ModelMemoryCapacity', () => {
    it('shows reported recommendation separately from total and free RAM', () => {
        const html = renderToStaticMarkup(<ModelMemoryCapacity hardware={hardware}/>);
        expect(html).toContain('24.0 GB');
        expect(html).toContain('17.8 GB');
        expect(html).not.toContain('>4.0 GB<');
    });
    it('does not estimate missing Metal data', () => {
        const html = renderToStaticMarkup(<ModelMemoryCapacity hardware={{...hardware, metal_recommended_working_set_bytes: null}}/>);
        expect(html).toContain('memoryUnavailable');
    });
    it('hides Metal on other platforms', () => {
        const html = renderToStaticMarkup(<ModelMemoryCapacity hardware={{...hardware, platform: 'linux', apple_silicon: false, memory_mode: 'system'}}/>);
        expect(html).not.toContain('metalRecommendedMemory');
    });
    it('provides a keyboard-accessible context explanation without an estimate count', () => {
        const html = renderToStaticMarkup(<MaxContextHelp/>);
        expect(html).toContain('tabindex="0"');
        expect(html).toContain('aria-label="modelSelector.maxContextHelp"');
    });
});
