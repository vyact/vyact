import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import ModalOverlay from './ModalOverlay';

const portal = vi.hoisted(() => vi.fn((children: unknown, _target: unknown) => children));
vi.mock('react-dom', () => ({createPortal: portal}));
afterEach(() => {vi.unstubAllGlobals(); portal.mockClear();});

describe('modal stacking containers', () => {
    it('renders a top-level modal outside the sidebar in the document body', () => {
        const body = {};
        vi.stubGlobal('document', {body});
        const html = renderToStaticMarkup(createElement(ModalOverlay, {children: 'Settings'}));
        expect(portal).toHaveBeenCalledOnce();
        expect(portal.mock.calls[0][1]).toBe(body);
        expect(html).toContain('Settings');
    });
    it('keeps nested confirmations inside their parent modal stacking context', () => {
        vi.stubGlobal('document', {body: {}});
        const html = renderToStaticMarkup(createElement(ModalOverlay, {className: 'settings-overlay', children: createElement(ModalOverlay, {className: 'confirm-modal-overlay', children: 'Confirm'})}));
        expect(portal).toHaveBeenCalledOnce();
        expect(html.indexOf('settings-overlay')).toBeLessThan(html.indexOf('confirm-modal-overlay'));
    });
    it('can render without a browser document', () => {
        vi.stubGlobal('document', undefined);
        expect(renderToStaticMarkup(createElement(ModalOverlay, {children: 'Settings'}))).toContain('Settings');
        expect(portal).not.toHaveBeenCalled();
    });
});
