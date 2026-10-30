interface TemporaryImage {url: string; deleteToken: string}
const RETRY_DELAY_MS = 1500;
const MAX_ATTEMPTS = 3;
const pending = new Map<string, {image: TemporaryImage; attempts: number}>();
let inFlight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Only detached temporary images may enter this queue; failures never block editing. */
export function queueManuscriptImageCleanup(images: TemporaryImage[]): void {
    if (!images.length) return;
    for (const image of images) pending.set(image.url, {image, attempts: 0});
    void flushManuscriptImageCleanup();
}

export function flushManuscriptImageCleanup(): Promise<void> {
    if (inFlight) return inFlight;
    clearTimeout(retryTimer);
    inFlight = (async () => {
        for (const [url, entry] of pending) {
            if (entry.attempts >= MAX_ATTEMPTS) continue;
            entry.attempts += 1;
            try {
                const response = await fetch(url, {method: 'DELETE', headers: {'X-Image-Delete-Token': entry.image.deleteToken}, keepalive: true});
                if ((response.ok || response.status === 404) && pending.get(url) === entry) pending.delete(url);
            } catch { /* Keep failed cleanup for a bounded retry. */ }
        }
    })().finally(() => {
        inFlight = null;
        if ([...pending.values()].some(entry => entry.attempts < MAX_ATTEMPTS)) {
            retryTimer = setTimeout(() => {void flushManuscriptImageCleanup();}, RETRY_DELAY_MS);
        }
    });
    return inFlight;
}
