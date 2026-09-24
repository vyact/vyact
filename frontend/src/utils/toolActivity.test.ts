import {describe, expect, it} from 'vitest';
import {
    getToolActivityDetail,
    getToolActivityDisplayLabel,
    getToolActivityFailureDetail,
    getToolActivityLabel,
    getToolActivityLinks,
    getToolActivityResultPresentation,
    isToolActivityResultFailed,
} from './toolActivity';

const translations: Record<string, string> = {
    'toolActivity.actions.searching': '검색하고 있어요',
    'toolActivity.actions.reading': '내용을 확인하고 있어요',
    'toolActivity.actions.creating': '새 항목을 만들고 있어요',
    'toolActivity.actions.sending': '전송하고 있어요',
    'toolActivity.completedActions.searching': '검색 완료',
    'toolActivity.completedActions.sending': '전송 완료',
    'toolActivity.failedActions.searching': '검색 실패',
    'toolActivity.approvalRejected': '사용자가 실행을 거부했어요',
    'toolActivity.serviceAction': '{{service}} · {{action}}',
    'toolActivity.browserBatchReading': '여러 원문을 확인하고 있어요',
    'toolActivity.browserClickCompleted': '페이지 요소 클릭 완료',
    'toolActivity.browserWaiting': '페이지 로딩을 기다리고 있어요',
    'toolActivity.browserGoingBack': '이전 페이지로 돌아가고 있어요',
    'toolActivity.browserCheckingStatus': '페이지 상태를 확인하고 있어요',
    'toolActivity.browserClosing': '페이지를 닫고 있어요',
    'toolActivity.codeFileInventory': '프로젝트 파일 크기를 확인하고 있어요',
    'toolActivity.codeInstallDependencies': '프로젝트 의존성을 설치하고 있어요',
    'toolActivity.codeFileInventoryCompleted': '프로젝트 파일 크기 확인 완료',
    'toolActivity.codeInstallDependenciesCompleted': '프로젝트 의존성 설치 완료',
    'toolActivity.searchCompleted': '검색 완료',
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
        expect(getToolActivityLabel('notion__search_files', translate))
            .toBe('notion · 검색하고 있어요');
        expect(getToolActivityLabel('notion__search_code', translate))
            .toBe('notion · 검색하고 있어요');
    });

    it('uses the registered service for Microsoft and Google Workspace tools', () => {
        expect(getToolActivityLabel('microsoft_search_files', translate))
            .toBe('OneDrive · 검색하고 있어요');
        expect(getToolActivityLabel('microsoft_get_email', translate))
            .toBe('Outlook · 내용을 확인하고 있어요');
        expect(getToolActivityLabel('microsoft_create_calendar_event', translate))
            .toBe('Outlook Calendar · 새 항목을 만들고 있어요');
        expect(getToolActivityLabel('read_document_content', translate))
            .toBe('Google Drive · 내용을 확인하고 있어요');
        expect(getToolActivityDisplayLabel('microsoft_search_files', '', translate, 'completed', 'success'))
            .toBe('OneDrive · 검색 완료');
        expect(getToolActivityDisplayLabel('microsoft_search_files', 'Google Drive · 검색하고 있어요', translate, 'running'))
            .toBe('OneDrive · 검색하고 있어요');
    });

    it('identifies project inventory without calling it Google Drive', () => {
        expect(getToolActivityLabel('code_file_inventory', translate))
            .toBe('프로젝트 파일 크기를 확인하고 있어요');
        expect(getToolActivityDisplayLabel('code_file_inventory', '', translate, 'completed', 'success'))
            .toBe('프로젝트 파일 크기 확인 완료');
        expect(getToolActivityDisplayLabel('code_file_inventory', 'Google Drive · code file inventory', translate, 'running'))
            .toBe('프로젝트 파일 크기를 확인하고 있어요');
        expect(getToolActivityDisplayLabel('code_file_inventory', '승인 대기 · 프로젝트 파일 크기 확인', translate, 'running', undefined, true))
            .toBe('승인 대기 · 프로젝트 파일 크기 확인');
        expect(getToolActivityLabel('code_install_dependencies', translate))
            .toBe('프로젝트 의존성을 설치하고 있어요');
        expect(getToolActivityDisplayLabel('code_install_dependencies', '', translate, 'completed', 'success'))
            .toBe('프로젝트 의존성 설치 완료');
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

    it('shows localized labels for the remaining browser actions', () => {
        expect(getToolActivityLabel('browser_wait', translate)).toBe('페이지 로딩을 기다리고 있어요');
        expect(getToolActivityLabel('browser_back', translate)).toBe('이전 페이지로 돌아가고 있어요');
        expect(getToolActivityLabel('browser_status', translate)).toBe('페이지 상태를 확인하고 있어요');
        expect(getToolActivityLabel('browser_close', translate)).toBe('페이지를 닫고 있어요');
    });

    it('shows the concrete completed browser action instead of a generic completion', () => {
        expect(getToolActivityDisplayLabel(
            'browser_click', '작업을 완료했어요', translate, 'completed', 'success',
        )).toBe('페이지 요소 클릭 완료');
    });

    it('shows the service and concrete action when an external tool completes', () => {
        expect(getToolActivityDisplayLabel(
            'naver_news__search_articles', '작업을 완료했어요', translate, 'completed', 'success',
        )).toBe('naver news · 검색 완료');
        expect(getToolActivityDisplayLabel(
            'send_email', '작업을 완료했어요', translate, 'completed', 'success',
        )).toBe('Gmail · 전송 완료');
    });

    it('keeps failure and rejection distinct from successful completion', () => {
        expect(getToolActivityDisplayLabel(
            'naver_news__search_articles', '작업에 실패했어요', translate, 'completed', 'failed',
        )).toBe('naver news · 검색 실패');
        expect(getToolActivityDisplayLabel(
            'naver_news__search_articles', '사용자가 실행을 거부했어요', translate, 'completed', 'rejected',
        )).toBe('사용자가 실행을 거부했어요');
    });

    it('treats structured tool errors as failed activity', () => {
        expect(isToolActivityResultFailed('{"ok":false,"error":"element_not_found"}')).toBe(true);
        expect(isToolActivityResultFailed('{"ok":true}')).toBe(false);
    });

    it('presents the actual reason for a failed AI tool call', () => {
        expect(getToolActivityFailureDetail("[오류] _read_files() got an unexpected keyword argument 'offset'"))
            .toBe("_read_files() got an unexpected keyword argument 'offset'");
        expect(getToolActivityResultPresentation('{"ok":false,"error":"invalid arguments"}', {path: 'app.py'}))
            .toEqual({detail: 'invalid arguments', links: undefined});
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
