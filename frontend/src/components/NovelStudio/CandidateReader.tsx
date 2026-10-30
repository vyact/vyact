import type {WorkspaceEditSession} from './workspaceEditSession';
import CandidateQuery from './CandidateQuery';
import ProposalReader from './ProposalReader';
import type {SettingCandidate} from './storyStorage';

export default function CandidateReader({candidate, onChange, onBack, onTitleChange, onSessionChange, onSave}: {candidate: SettingCandidate; onChange: (content: string) => void; onBack: () => void; onTitleChange?: (title: string) => void; onSessionChange?: (session: WorkspaceEditSession | null) => void; onSave?: (content: string, title: string) => void}) {
    return <ProposalReader onSave={onSave} onSessionChange={onSessionChange} text={candidate.content} action={candidate.category} title={candidate.title} busy={false} maxLength={20000} onTitleChange={onTitleChange} onChange={onChange} onReturn={onBack} context={<CandidateQuery candidate={candidate}/>}/>;
}
