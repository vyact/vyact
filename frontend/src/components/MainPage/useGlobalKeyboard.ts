import { useEffect, useRef } from 'react';

interface KeyboardHandlers {
    onToggleSidebar: () => void;
    onToggleCommandPalette: () => void;
    onToggleShortcuts: () => void;
    onOpenDocument: () => void;
    onOpenSettings: () => void;
    onNewConversation: () => void;
    onOpenMemo: () => void;
    onOpenQuickMemo: () => void;
    onOpenKnowledgeCollections: () => void;
    onOpenChatSummary: () => void;
    onToggleNotifications: () => void;
    onCloseAll: () => void;
}

export function useGlobalKeyboard(handlers: KeyboardHandlers, isMemoOpen = false) {
    // handlers가 렌더마다 새로 생성되어도(예: conv.currentConvId 변경) 항상 최신 값을
    // 참조할 수 있도록 ref에 담아둔다. (리스너 재등록 없이 최신 클로저 접근)
    const handlersRef = useRef(handlers);
    useEffect(() => {
        handlersRef.current = handlers;
    });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const handlers = handlersRef.current;
            // 메모 모달 열려있고 에디터에 포커스 있으면 단축키 차단
            if (isMemoOpen) {
                const active = document.activeElement;
                const inEditor = active?.closest('.memo-editor-content') || active?.closest('.ProseMirror');
                if (inEditor) return;
            }
            const meta = e.metaKey || e.ctrlKey;

            if (meta && e.shiftKey && (e.key === 'S' || e.key === 's')) {
                e.preventDefault();
                handlers.onToggleSidebar();
            } else if (meta && e.key === 'k') {
                e.preventDefault();
                handlers.onToggleCommandPalette();
            } else if (meta && e.key === '1') {
                e.preventDefault();
                handlers.onNewConversation();
            } else if (meta && e.key === '/') {
                e.preventDefault();
                handlers.onToggleShortcuts();
            } else if (meta && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
                e.preventDefault();
                handlers.onOpenDocument();
            } else if (meta && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
                e.preventDefault();
                handlers.onOpenQuickMemo();
            } else if (meta && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
                e.preventDefault();
                handlers.onOpenMemo();
            } else if (meta && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
                e.preventDefault();
                handlers.onOpenKnowledgeCollections();
            } else if (meta && e.shiftKey && (e.key === 'J' || e.key === 'j')) {
                e.preventDefault();
                handlers.onOpenChatSummary();
            } else if (meta && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
                e.preventDefault();
                handlers.onToggleNotifications();
            } else if (meta && e.shiftKey && (e.key === ',' || e.key === '<')) {
                e.preventDefault();
                handlers.onOpenSettings();
            } else if (e.key === 'Escape') {
                // 모달이 열려 있으면 각 모달의 최상위 ESC 핸들러가 닫기 순서를
                // 관리한다. 여기서 onCloseAll을 호출하면 중첩 모달과 부모가 함께 닫힌다.
                if (document.querySelector('.app-modal-overlay')) return;
                handlers.onCloseAll();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMemoOpen]);
}
