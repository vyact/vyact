import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';

const SUPPORTED_LANGUAGE_CODES = ['ko', 'en', 'ja', 'zh', 'th', 'vi', 'es', 'fr'];
const LEGACY_LANGUAGE_STORAGE_KEY = 'vyact-language';
const TRANSLATION_NAMESPACES = ['common', 'setup', 'settings', 'main'] as const;
type TranslationNamespace = typeof TRANSLATION_NAMESPACES[number];
type TranslationResources = Record<TranslationNamespace, Record<string, unknown>>;

const LANGUAGE_RESOURCE_LOADERS: Record<string, () => Promise<TranslationResources>> = Object.fromEntries(
    SUPPORTED_LANGUAGE_CODES.map(language => [language, async () => {
        const [common, setup, settings, main] = await Promise.all([
            import(`./locales/${language}/common.json`),
            import(`./locales/${language}/setup.json`),
            import(`./locales/${language}/settings.json`),
            import(`./locales/${language}/main.json`),
        ]);
        return {common: common.default, setup: setup.default, settings: settings.default, main: main.default};
    }]),
);

function detectLanguage(): string {
    const legacyLanguage = localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
    if (legacyLanguage && SUPPORTED_LANGUAGE_CODES.includes(legacyLanguage)) return legacyLanguage;
    const systemLanguage = navigator.language.split('-')[0];
    return SUPPORTED_LANGUAGE_CODES.includes(systemLanguage) ? systemLanguage : 'en';
}

async function loadLanguageResources(language: string): Promise<void> {
    if (i18n.hasResourceBundle(language, 'common')) return;
    const resources = await LANGUAGE_RESOURCE_LOADERS[language]();
    TRANSLATION_NAMESPACES.forEach(namespace => {
        i18n.addResourceBundle(language, namespace, resources[namespace], true, true);
    });
}

const applyDocumentLanguage = (language: string) => {
    document.documentElement.lang = language.split('-')[0];
};

async function saveLanguageToServer(language: string): Promise<boolean> {
    try {
        const response = await fetch('/api/extension/language', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({language}),
        });
        if (!response.ok) return false;
        const {saved} = await response.json();
        return saved === true;
    } catch {
        return false;
    }
}

export const changeLanguage = (lang: string) => {
    const language = lang.split('-')[0];
    // ES가 준비되지 않은 초기 설치에서도 선택값을 잃지 않도록 먼저 보관한다.
    localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, language);
    void loadLanguageResources(language).then(() => i18n.changeLanguage(language)).then(() => saveLanguageToServer(language)).then(saved => {
        if (saved) localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY);
    });
};

/** 설치 완료 직후, 초기 설치 중 임시 보관한 언어를 ES에 저장한다. */
export async function syncPendingLanguageAfterSetup(): Promise<void> {
    const language = localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY)
        || i18n.language.split('-')[0];
    if (!SUPPORTED_LANGUAGE_CODES.includes(language)) return;

    if (await saveLanguageToServer(language)) {
        localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY);
    }
}

async function syncLanguageFromServer() {
    try {
        // 기존 앱은 언어를 localStorage에만 저장했다. 업그레이드 직후 한 번은
        // 사용자가 이미 선택한 값을 ES로 올려야 기존 선택이 기본값(예: ko)에 덮이지 않는다.
        const legacyLanguage = localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
        if (legacyLanguage && SUPPORTED_LANGUAGE_CODES.includes(legacyLanguage)) {
            changeLanguage(legacyLanguage);
            return;
        }
        const response = await fetch('/api/extension/bootstrap');
        if (!response.ok) return;
        const {language} = await response.json();
        if (SUPPORTED_LANGUAGE_CODES.includes(language)) {
            await loadLanguageResources(language);
            await i18n.changeLanguage(language);
            localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY);
            return;
        }
        // 첫 설치 시에만 시스템 언어 감지값을 ES의 기준값으로 저장한다.
        changeLanguage(detectLanguage());
    } catch {
        // 서버가 아직 시작 전이면 시스템 언어로만 표시하고 다음 실행 때 동기화한다.
    }
}

async function initializeI18n(): Promise<void> {
    const initialLanguage = detectLanguage();
    await i18n.use(initReactI18next).init({
        lng: initialLanguage,
        fallbackLng: 'en',
        defaultNS: 'common',
        ns: [...TRANSLATION_NAMESPACES],
        interpolation: {escapeValue: false},
    });
    await Promise.all([
        loadLanguageResources(initialLanguage),
        initialLanguage === 'en' ? Promise.resolve() : loadLanguageResources('en'),
    ]);
    await i18n.changeLanguage(initialLanguage);
    applyDocumentLanguage(i18n.language);
    i18n.on('languageChanged', applyDocumentLanguage);
    void syncLanguageFromServer();
}

export const i18nInitialization = initializeI18n();

export const SUPPORTED_LANGUAGES = [
    {value: 'ko', label: '한국어'},
    {value: 'en', label: 'English'},
    {value: 'es', label: 'Español'},
    {value: 'fr', label: 'Français'},
    {value: 'zh', label: '中文'},
    {value: 'ja', label: '日本語'},
    {value: 'th', label: 'ไทย'},
    {value: 'vi', label: 'Việt'},
];

export default i18n;
