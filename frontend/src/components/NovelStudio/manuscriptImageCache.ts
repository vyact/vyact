// Keep a bounded set of decoded images alive across chapter switches and studio reopening.
const MAX_DECODED_IMAGES = 24;
const decodedImages = new Map<string, HTMLImageElement>();

export function retainManuscriptImages(container: HTMLElement): void {
    for (const image of container.querySelectorAll<HTMLImageElement>('img')) {
        if (!image.getAttribute('src')?.startsWith('/api/novel-studio/images/')) continue;
        image.loading = 'eager';
        image.decoding = 'sync';
        const remember = () => {
            decodedImages.delete(image.src);
            decodedImages.set(image.src, image.cloneNode(false) as HTMLImageElement);
            if (decodedImages.size > MAX_DECODED_IMAGES) decodedImages.delete(decodedImages.keys().next().value!);
        };
        if (image.complete && image.naturalWidth) remember();
        else image.addEventListener('load', remember, {once: true});
    }
}
