import CandidateQuery from './CandidateQuery';
import ProposalReader from './ProposalReader';
import type {SettingCandidate} from './storyStorage';

export default function CandidateReader({candidate, onChange, onBack, onTitleChange}: {candidate: SettingCandidate; onChange: (content: string) => void; onBack: () => void; onTitleChange?: (title: string) => void}) {
    return <ProposalReader text={candidate.content} action={candidate.category} title={candidate.title} busy={false} maxLength={20000} onTitleChange={onTitleChange} onChange={onChange} onReturn={onBack} context={<CandidateQuery candidate={candidate}/>}/>;
}
