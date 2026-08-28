export const THEME_STORAGE_KEY = 'vyact-theme';
const PENDING_THEME_STORAGE_KEY = 'vyact-pending-theme';

export type AppTheme = 'dark' | 'light';

export const DEFAULT_THEME: AppTheme = 'dark';

export const getStoredTheme = (): AppTheme => {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
};

export const applyTheme = (theme: AppTheme): void => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // 저장소를 사용할 수 없는 환경에서도 현재 세션의 테마는 적용한다.
    }
};

const isAppTheme = (value: unknown): value is AppTheme => value === 'dark' || value === 'light';

async function saveThemeToServer(theme: AppTheme): Promise<boolean> {
    try {
        const response = await fetch('/api/settings/theme', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({theme}),
        });
        if (!response.ok) return false;
        const result = await response.json() as {saved?: boolean};
        return result.saved === true;
    } catch {
        return false;
    }
}

export const changeTheme = (theme: AppTheme): void => {
    applyTheme(theme);
    localStorage.setItem(PENDING_THEME_STORAGE_KEY, theme);
    void saveThemeToServer(theme).then(saved => {
        if (saved) localStorage.removeItem(PENDING_THEME_STORAGE_KEY);
    });
};

export async function syncPendingThemeAfterSetup(): Promise<void> {
    const theme = localStorage.getItem(PENDING_THEME_STORAGE_KEY) || getStoredTheme();
    if (isAppTheme(theme) && await saveThemeToServer(theme)) {
        localStorage.removeItem(PENDING_THEME_STORAGE_KEY);
    }
}

export async function syncThemeFromServer(): Promise<void> {
    const pendingTheme = localStorage.getItem(PENDING_THEME_STORAGE_KEY);
    if (isAppTheme(pendingTheme)) {
        changeTheme(pendingTheme);
        return;
    }
    try {
        const response = await fetch('/api/settings/theme');
        if (!response.ok) return;
        const {theme} = await response.json() as {theme?: unknown};
        if (isAppTheme(theme)) {
            applyTheme(theme);
            return;
        }
        changeTheme(getStoredTheme());
    } catch {
        // 서버 시작 전에는 로컬에 저장된 테마를 유지한다.
    }
}
