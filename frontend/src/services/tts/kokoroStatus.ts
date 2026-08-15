let cachedAvailability: boolean | null = null;
let availabilityRequest: Promise<boolean> | null = null;

export function getKokoroAvailability(forceRefresh = false): Promise<boolean> {
    if (!forceRefresh && cachedAvailability !== null) return Promise.resolve(cachedAvailability);
    if (availabilityRequest) return availabilityRequest;
    availabilityRequest = fetch('/api/tts/kokoro/status')
        .then(response => response.json() as Promise<{available?: boolean}>)
        .then(result => {
            cachedAvailability = result.available === true;
            return cachedAvailability;
        })
        .catch(() => {
            cachedAvailability = false;
            return false;
        })
        .finally(() => {
            availabilityRequest = null;
        });
    return availabilityRequest;
}
