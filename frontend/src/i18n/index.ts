import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';

import koCommon from './locales/ko/common.json';
import koSetup from './locales/ko/setup.json';
import koSettings from './locales/ko/settings.json';
import koMain from './locales/ko/main.json';

import enCommon from './locales/en/common.json';
import enSetup from './locales/en/setup.json';
import enSettings from './locales/en/settings.json';
import enMain from './locales/en/main.json';

import jaCommon from './locales/ja/common.json';
import jaSetup from './locales/ja/setup.json';
import jaSettings from './locales/ja/settings.json';
import jaMain from './locales/ja/main.json';

import zhCommon from './locales/zh/common.json';
import zhSetup from './locales/zh/setup.json';
import zhSettings from './locales/zh/settings.json';
import zhMain from './locales/zh/main.json';

import thCommon from './locales/th/common.json';
import thSetup from './locales/th/setup.json';
import thSettings from './locales/th/settings.json';
import thMain from './locales/th/main.json';

import viCommon from './locales/vi/common.json';
import viSetup from './locales/vi/setup.json';
import viSettings from './locales/vi/settings.json';
import viMain from './locales/vi/main.json';

import esCommon from './locales/es/common.json';
import esSetup from './locales/es/setup.json';
import esSettings from './locales/es/settings.json';
import esMain from './locales/es/main.json';

import frCommon from './locales/fr/common.json';
import frSetup from './locales/fr/setup.json';
import frSettings from './locales/fr/settings.json';
import frMain from './locales/fr/main.json';

const SUPPORTED_LANGUAGE_CODES = ['ko', 'en', 'ja', 'zh', 'th', 'vi', 'es', 'fr'];
const LEGACY_LANGUAGE_STORAGE_KEY = 'vyact-language';

function detectLanguage(): string {
    const legacyLanguage = localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
    if (legacyLanguage && SUPPORTED_LANGUAGE_CODES.includes(legacyLanguage)) return legacyLanguage;
    const systemLanguage = navigator.language.split('-')[0];
    return SUPPORTED_LANGUAGE_CODES.includes(systemLanguage) ? systemLanguage : 'en';
}

i18n.use(initReactI18next).init({
    resources: {
        ko: {common: koCommon, setup: koSetup, settings: koSettings, main: koMain},
        en: {common: enCommon, setup: enSetup, settings: enSettings, main: enMain},
        ja: {common: jaCommon, setup: jaSetup, settings: jaSettings, main: jaMain},
        zh: {common: zhCommon, setup: zhSetup, settings: zhSettings, main: zhMain},
        th: {common: thCommon, setup: thSetup, settings: thSettings, main: thMain},
        vi: {common: viCommon, setup: viSetup, settings: viSettings, main: viMain},
        es: {common: esCommon, setup: esSetup, settings: esSettings, main: esMain},
        fr: {common: frCommon, setup: frSetup, settings: frSettings, main: frMain},
    },
    lng: detectLanguage(),
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'setup', 'settings', 'main'],
    interpolation: {escapeValue: false},
});

const applyDocumentLanguage = (language: string) => {
    document.documentElement.lang = language.split('-')[0];
};

applyDocumentLanguage(i18n.language);
i18n.on('languageChanged', applyDocumentLanguage);

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
    i18n.changeLanguage(language);
    // ES가 준비되지 않은 초기 설치에서도 선택값을 잃지 않도록 먼저 보관한다.
    localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, language);
    void saveLanguageToServer(language).then((saved) => {
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

void syncLanguageFromServer();

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
