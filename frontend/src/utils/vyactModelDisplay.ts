import type {VyactHardwareInfo} from '../services/api';

export const MODEL_MEMORY_OVERHEAD_RATIO = 1.2;

const MAX_FILES_PER_MODEL = 8;

export const formatModelBytes = (bytes: number) => {
    if (!bytes) return '—';
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

export const formatCompactDownloads = (downloads: number) => {
    const compact = (value: number, suffix: string) => `${value.toFixed(1).replace(/\.0$/, '')}${suffix}`;
    if (downloads >= 1_000_000) return compact(downloads / 1_000_000, 'm');
    if (downloads >= 1_000) return compact(downloads / 1_000, 'k');
    return String(downloads);
};

export const getSelectableModelFiles = (files: string[]) => files
    .filter(filename => !/^BF16\//i.test(filename) && !/(^|\/)mtp-[^/]*\.gguf$/i.test(filename))
    .filter(filename => !/(^|\/)mmproj[^/]*\.gguf$/i.test(filename))
    .filter(filename => !/-\d{5}-of-\d{5}\.gguf$/i.test(filename))
    .sort((left, right) => {
        const priority = (filename: string) => {
            if (/Q4_K_M/i.test(filename)) return 0;
            if (/Q4_0/i.test(filename)) return 1;
            if (/Q5_K_M/i.test(filename)) return 2;
            if (/Q6_K/i.test(filename)) return 3;
            if (/Q8_0/i.test(filename)) return 4;
            return 5;
        };
        return priority(left) - priority(right);
    })
    .slice(0, MAX_FILES_PER_MODEL);

export type ModelMemoryTone = 'comfortable' | 'tight' | 'over';

const getTotalModelMemoryCapacity = (hardware: VyactHardwareInfo) => {
    if (hardware.memory_mode !== 'dedicated') return hardware.system_memory.total_bytes;
    const dedicatedVram = hardware.gpus
        .filter(gpu => !gpu.shared_memory)
        .reduce((total, gpu) => total + gpu.total_bytes, 0);
    return hardware.system_memory.total_bytes + dedicatedVram;
};

export const getModelMemoryTone = (estimatedMemory: number, hardware: VyactHardwareInfo): ModelMemoryTone => {
    const capacity = getTotalModelMemoryCapacity(hardware);
    if (!capacity || estimatedMemory > capacity * .85) return 'over';
    if (estimatedMemory > capacity * .6) return 'tight';
    return 'comfortable';
};
