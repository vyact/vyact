type DictionaryRequest = { resolve: (installed: boolean) => void };

let installationPromise: Promise<boolean> | null = null;

export class JapaneseTtsDictionaryCancelledError extends Error {
    constructor() {
        super('Japanese TTS dictionary installation was cancelled');
    }
}

export async function isJapaneseTtsDictionaryInstalled(): Promise<boolean> {
    const response = await fetch('/api/tts/japanese-dictionary/status');
    return response.ok && (await response.json()).installed === true;
}

export function ensureJapaneseTtsDictionary(): Promise<boolean> {
    if (!installationPromise) {
        installationPromise = (async () => {
            if (await isJapaneseTtsDictionaryInstalled()) return true;
            return new Promise<boolean>(resolve => {
                window.dispatchEvent(new CustomEvent<DictionaryRequest>('vyact:japanese-tts-dictionary-required', {
                    detail: {resolve},
                }));
            });
        })().finally(() => { installationPromise = null; });
    }
    return installationPromise;
}
