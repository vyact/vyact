import CopyIconButton from '../common/CopyIconButton/CopyIconButton';
import {useTranslation} from 'react-i18next';
import type {SettingCandidate} from './storyStorage';

export default function CandidateQuery({candidate}: {candidate: SettingCandidate}) {
    const {t} = useTranslation('main');
    const normalizeQuery = (value: string) => value.replace(/\r\n?/g, '\n').trim();
    const hasAdditionalInstruction = Boolean(candidate.authorDirection && candidate.generationInstruction && normalizeQuery(candidate.authorDirection) !== normalizeQuery(candidate.generationInstruction));
    const hasQuery = Boolean(candidate.generationInstruction || candidate.authorDirection);
    return <section className="novel-candidate-query novel-reader-query">
        <div className="novel-query-heading"><h4>{t('novelStudio.generationQuery')}</h4>{hasQuery && <CopyIconButton text={candidate.authorDirection || candidate.generationInstruction || ''} className="titlebar-btn novel-query-copy"/>}</div>
        <p className={hasQuery ? undefined : 'novel-query-empty'}>{hasQuery ? candidate.authorDirection || candidate.generationInstruction : t('novelStudio.missingGenerationQuery')}</p>
        {hasAdditionalInstruction && <details><summary>{t('novelStudio.fullGenerationQuery')}</summary><p>{candidate.generationInstruction}</p></details>}
    </section>;
}
