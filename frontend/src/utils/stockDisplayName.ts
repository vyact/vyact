import i18n from 'i18next';

const STOCK_TYPE_KEYS: Record<string, string> = {
    'common stock': 'commonStock',
    'common shares': 'commonStock',
    'ordinary shares': 'ordinaryShares',
};

export function localizeStockName(name: string, language?: string): string {
    return name.replace(/\b(Common Stock|Common Shares|Ordinary Shares)$/i, suffix =>
        i18n.t(`stockAnalysis.securityTypes.${STOCK_TYPE_KEYS[suffix.toLowerCase()]}`, {ns: 'main', lng: language}));
}
