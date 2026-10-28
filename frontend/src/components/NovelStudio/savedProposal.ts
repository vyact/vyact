import type {Story} from './storyStorage';

export interface SavedProposalSource {kind: 'candidate' | 'final'; id: string}
export function reviseSavedProposal(story: Story, source: SavedProposalSource, revision: {title: string; content: string; instruction: string; authorDirection: string}): Partial<Story> {
    if (source.kind === 'candidate') return {settingsCandidates: (story.settingsCandidates ?? []).map(item => item.id === source.id ? {...item, title: revision.title.trim() || item.title, content: revision.content, generationInstruction: revision.instruction, authorDirection: revision.authorDirection} : item)};
    return {finalSettings: (story.finalSettings ?? []).map(item => item.id === source.id ? {...item, title: revision.title.trim() || item.title, content: revision.content} : item)};
}
