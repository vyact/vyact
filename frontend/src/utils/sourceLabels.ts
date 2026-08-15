import type { TFunction } from 'i18next';

/** Converts internal source-type values into the current interface language. */
export function getLocalizedSourceLabel(source: string | undefined, t: TFunction): string {
    const normalizedSource = source?.trim() ?? '';
    const normalizedExternalSource = normalizedSource.toLowerCase();
    const externalSourceNameKeys: Record<string, string> = {
        'kr.gov24': 'gov24',
        'government24': 'gov24',
        'kr.biz_support': 'bizSupport',
        'bizinfo': 'bizSupport',
        'kr.k_startup': 'kStartup',
        'k-startup': 'kStartup',
        'kr.welfare': 'welfare',
        'welfare': 'welfare',
        'kr.housing': 'housing',
        'housing': 'housing',
        'kr.lh_lease_complex': 'lhLeaseComplex',
        'lh lease complex': 'lhLeaseComplex',
        'kr.lh_lease_notice': 'lhLeaseNotice',
        'lh notice': 'lhLeaseNotice',
    };
    const externalSourceNameKey = externalSourceNameKeys[normalizedExternalSource];
    if (externalSourceNameKey) {
        return t(`externalData.sources.${externalSourceNameKey}.name`, {ns: 'settings'});
    }

    // External-data source names are stable backend identifiers. Translate them
    // only at the presentation boundary so filtering and source-type checks keep
    // using the same value regardless of the interface language.
    if (!normalizedSource || normalizedSource === '웹페이지' || normalizedSource === 'Web page') {
        return t('message.webPage');
    }
    if (normalizedSource === 'memo' || normalizedSource === '메모') return t('message.memo');
    if (normalizedSource === 'email_thread') return t('knowledgeCollectionSources.email_thread');
    if (normalizedSource === 'manual') return t('message.manual');
    if (normalizedSource === '링크') return t('message.link');
    if (normalizedSource === '첨부파일') return t('message.attachment');
    if (normalizedSource === '붙여넣기') return t('message.pastedText');

    if (normalizedSource.startsWith('첨부:')) {
        return t('message.attachmentWithName', { name: normalizedSource.slice('첨부:'.length) });
    }
    if (normalizedSource.startsWith('zip:')) {
        return t('message.zipAttachment', { name: normalizedSource.slice('zip:'.length) });
    }

    const documentMatch = normalizedSource.match(/^문서\((.+)\)$/);
    if (documentMatch) return t('message.document', { type: documentMatch[1] });

    return normalizedSource;
}
