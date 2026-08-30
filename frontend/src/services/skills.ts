import i18n from '../i18n';

export interface Skill {
    id: string;
    name: string;
    description: string;
    instructions: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

let cachedSkills: Skill[] | null = null;
let pendingSkillsRequest: Promise<Skill[]> | null = null;

async function requestSkills(): Promise<Skill[]> {
    const response = await fetch('/api/skills');
    if (!response.ok) throw new Error(i18n.t('main:networkError.requestFailed'));
    const skills = await response.json();
    cachedSkills = skills;
    return skills;
}

export function getSkills(): Promise<Skill[]> {
    if (cachedSkills) return Promise.resolve(cachedSkills);
    if (!pendingSkillsRequest) {
        pendingSkillsRequest = requestSkills().finally(() => {
            pendingSkillsRequest = null;
        });
    }
    return pendingSkillsRequest;
}

export function refreshSkills(): Promise<Skill[]> {
    if (pendingSkillsRequest) return pendingSkillsRequest;
    pendingSkillsRequest = requestSkills().finally(() => {
        pendingSkillsRequest = null;
    });
    return pendingSkillsRequest;
}

export function updateSkillsCache(skills: Skill[]): Skill[] {
    cachedSkills = skills;
    return skills;
}
