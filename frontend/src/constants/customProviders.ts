import type {TFunction} from 'i18next';

export const OPENAI_COMPATIBLE_DOCS_URL = 'https://platform.openai.com/docs/api-reference/chat';

export const getCustomProtocolOptions = (t: TFunction) => [
    {value: 'openai-compatible', label: t('main:connectionProtocol.openaiCompatible')},
];
