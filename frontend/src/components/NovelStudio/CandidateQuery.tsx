import CopyIconButton from '../common/CopyIconButton/CopyIconButton';
import {useTranslation} from 'react-i18next';
import type {SettingCandidate} from './storyStorage';

export default function CandidateQuery({candidate}: {candidate: SettingCandidate}) {
    const {t} = useTranslation('main');
    const hasQuery = Boolean(candidate.generationInstruction || candidate.authorDirection);
    return <section className="novel-candidate-query novel-reader-query">
        <div className="novel-query-heading"><h4>{t('novelStudio.generationQuery')}</h4>{hasQuery && <CopyIconButton text={candidate.authorDirection || candidate.generationInstruction || ''} className="titlebar-btn novel-query-copy"/>}</div>
        <p className={hasQuery ? undefined : 'novel-query-empty'}>{hasQuery ? candidate.authorDirection || candidate.generationInstruction : t('novelStudio.missingGenerationQuery')}</p>
        {candidate.authorDirection && candidate.generationInstruction && <details><summary>{t('novelStudio.fullGenerationQuery')}</summary><p>{candidate.generationInstruction}</p></details>}
    </section>;
}
