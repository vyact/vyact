import {describe, expect, it} from 'vitest';
import {
    getToolActivityDetail,
    getToolActivityDisplayLabel,
    getToolActivityLabel,
    getToolActivityLinks,
    getToolActivityResultPresentation,
    isToolActivityResultFailed,
} from './toolActivity';

const translations: Record<string, string> = {
    'toolActivity.actions.searching': '검색하고 있어요',
    'toolActivity.actions.creating': '새 항목을 만들고 있어요',
    'toolActivity.actions.sending': '전송하고 있어요',
    'toolActivity.serviceAction': '{{service}} · {{action}}',
    'toolActivity.browserBatchReading': '여러 원문을 확인하고 있어요',
    'toolActivity.browserClickCompleted': '페이지 요소 클릭 완료',
};

const translate = (key: string, options?: Record<string, unknown>): string => {
    const template = translations[key] ?? key;
    return Object.entries(options ?? {}).reduce(
        (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
        template,
    );
};

describe('tool activity presentation', () => {
    it('shows the service and localized action for Google Workspace tools', () => {
        expect(getToolActivityLabel('send_email', translate))
            .toBe('Gmail · 전송하고 있어요');
        expect(getToolActivityLabel('create_calendar_event', translate))
            .toBe('Google Calendar · 새 항목을 만들고 있어요');
        expect(getToolActivityLabel('search_files', translate))
            .toBe('Google Drive · 검색하고 있어요');
    });

    it('keeps the MCP server visible for unknown external tools', () => {
        expect(getToolActivityLabel('notion__search_pages', translate))
            .toBe('notion · 검색하고 있어요');
    });

    it('shows safe identifying details without exposing message content', () => {
        expect(getToolActivityDetail({
            subject: '분기 보고서',
            body: '표시되면 안 되는 이메일 본문',
        })).toBe('분기 보고서');
        expect(getToolActivityDetail({
            path: 'app/services/code_tools.py',
            old_string: 'MAX_UNDO_REGISTRY_ENTRIES = 100',
        })).toBe('app/services/code_tools.py');
    });

    it('summarizes files affected by a multi-file patch', () => {
        expect(getToolActivityDetail({
            patch: '*** Update File: app/a.py\n*** Update File: app/b.py',
        })).toBe('app/a.py, app/b.py');
    });

    it('shows browser batch domains without exposing full URLs', () => {
        expect(getToolActivityLabel('browser_read_urls', translate))
            .toBe('여러 원문을 확인하고 있어요');
        expect(getToolActivityDetail({
            urls: ['https://news.example.com/a?secret=1', 'https://docs.example.org/b'],
        })).toBe('news.example.com, docs.example.org');
    });

    it('shows the concrete completed browser action instead of a generic completion', () => {
        expect(getToolActivityDisplayLabel(
            'browser_click', '작업을 완료했어요', translate, 'completed', 'success',
        )).toBe('페이지 요소 클릭 완료');
    });

    it('treats structured tool errors as failed activity', () => {
        expect(isToolActivityResultFailed('{"ok":false,"error":"element_not_found"}')).toBe(true);
        expect(isToolActivityResultFailed('{"ok":true}')).toBe(false);
    });

    it('creates clickable page links and identifies the clicked element from its result', () => {
        expect(getToolActivityLinks({url: 'https://shop.example.com/product/1'})).toEqual([
            {label: 'shop.example.com', url: 'https://shop.example.com/product/1'},
        ]);
        expect(getToolActivityResultPresentation(JSON.stringify({
            ok: true,
            element: {name: '장바구니 담기', tag: 'button', href: ''},
        }))).toEqual({detail: '장바구니 담기', links: undefined});
        expect(getToolActivityResultPresentation(JSON.stringify({pages: [
            {title: '첫 번째 상품', url: 'https://shop.example.com/product/1'},
            {title: '두 번째 상품', url: 'https://shop.example.com/product/2'},
            {title: '중복 상품', url: 'https://shop.example.com/product/2'},
        ]}))).toEqual({
            detail: undefined,
            links: [
                {label: '첫 번째 상품', url: 'https://shop.example.com/product/1'},
                {label: '두 번째 상품', url: 'https://shop.example.com/product/2'},
            ],
        });
    });

    it('deduplicates tracking variants that resolve to the same page', () => {
        expect(getToolActivityResultPresentation(JSON.stringify({pages: [
            {title: '상품 이미지', url: 'https://shop.example.com/product/1?itemId=10&sourceType=image'},
            {title: '상품 제목', url: 'https://shop.example.com/product/1?itemId=10&sourceType=title'},
        ]}))).toEqual({
            detail: undefined,
            links: [{
                label: '상품 이미지',
                url: 'https://shop.example.com/product/1?itemId=10&sourceType=image',
            }],
        });
    });
});
