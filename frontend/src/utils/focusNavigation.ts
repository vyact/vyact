const KEYBOARD_NAVIGATION_CLASS = 'keyboard-navigation';

/**
 * 포커스 링은 Tab으로 포커스를 이동할 때만 표시한다.
 * 클릭한 컨트롤에서 Space/Enter를 누르는 동작은 키보드 탐색 시작으로 보지 않는다.
 */
export function installFocusNavigationTracking(): void {
    const root = document.documentElement;

    document.addEventListener('keydown', event => {
        if (event.key === 'Tab') root.classList.add(KEYBOARD_NAVIGATION_CLASS);
    }, true);

    document.addEventListener('pointerdown', () => {
        root.classList.remove(KEYBOARD_NAVIGATION_CLASS);
    }, true);
}
