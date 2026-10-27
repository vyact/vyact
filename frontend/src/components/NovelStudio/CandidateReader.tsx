import CandidateQuery from './CandidateQuery';
import ProposalReader from './ProposalReader';
import type {SettingCandidate} from './storyStorage';

export default function CandidateReader({candidate, onChange, onBack}: {candidate: SettingCandidate; onChange: (content: string) => void; onBack: () => void}) {
    return <ProposalReader text={candidate.content} action={candidate.category} title={candidate.title} busy={false} maxLength={20000} onChange={onChange} onReturn={onBack} context={<CandidateQuery candidate={candidate}/>}/>;
}
