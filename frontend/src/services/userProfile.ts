export interface UserProfile {
    profile: string | null;
    nickname: string;
    response_style: string;
    updated_at?: string;
}

type UserProfileUpdate = Partial<Pick<UserProfile, 'profile' | 'nickname' | 'response_style'>> & {
    analysis_cursor?: string;
    max_length?: number;
};

const DEFAULT_USER_PROFILE: UserProfile = {profile: null, nickname: '', response_style: 'default'};
const USER_PROFILE_UPDATED_EVENT = 'vyact:user-profile-updated';

let cachedProfile: UserProfile | null = null;
let profileRequest: Promise<UserProfile> | null = null;

export function getUserProfile(forceRefresh = false): Promise<UserProfile> {
    if (!forceRefresh && cachedProfile) return Promise.resolve(cachedProfile);
    if (profileRequest) return profileRequest;
    profileRequest = fetch('/api/user-profile')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json() as Promise<UserProfile>;
        })
        .then(profile => {
            cachedProfile = {...DEFAULT_USER_PROFILE, ...profile};
            return cachedProfile;
        })
        .finally(() => {
            profileRequest = null;
        });
    return profileRequest;
}

export async function updateUserProfile(update: UserProfileUpdate): Promise<UserProfile> {
    const response = await fetch('/api/user-profile', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(update),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json() as {updated_at?: string};
    cachedProfile = {...DEFAULT_USER_PROFILE, ...(cachedProfile || {}), ...update, updated_at: result.updated_at};
    window.dispatchEvent(new CustomEvent(USER_PROFILE_UPDATED_EVENT, {detail: cachedProfile}));
    return cachedProfile;
}

export function onUserProfileUpdated(handler: (profile: UserProfile) => void): () => void {
    const listener = (event: Event) => handler((event as CustomEvent<UserProfile>).detail);
    window.addEventListener(USER_PROFILE_UPDATED_EVENT, listener);
    return () => window.removeEventListener(USER_PROFILE_UPDATED_EVENT, listener);
}
