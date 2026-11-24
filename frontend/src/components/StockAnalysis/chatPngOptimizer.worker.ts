import init, {optimise} from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import wasmUrl from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url';

self.onmessage = async ({data: png}: MessageEvent<Blob>) => {
    try {
        await init(wasmUrl);
        const optimized = optimise(new Uint8Array(await png.arrayBuffer()), 1, false, false);
        self.postMessage(new Blob([new Uint8Array(optimized)], {type: 'image/png'}));
    } catch {
        self.postMessage(png);
    }
};
