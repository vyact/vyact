import type {VyactGgufMetadata, VyactHardwareInfo, VyactHubModel} from '../services/api';

export const MODEL_MEMORY_OVERHEAD_RATIO = 1.2;

const MAX_FILES_PER_MODEL = 8;
const DEFAULT_MODEL_CONTEXT = 32768;

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

export const getModelPublisher = (modelId: string) => {
    const separatorIndex = modelId.indexOf('/');
    return separatorIndex > 0 ? modelId.slice(0, separatorIndex) : '';
};

export const getModelQuantization = (model: VyactHubModel, filename: string) => {
    if (model.runtime === 'mlx') {
        if (model.quantization) return model.quantization;
        const mlxName = `${model.id}/${filename}`;
        const bitMatch = mlxName.match(/(?:^|[-_.\/])(\d+)[-_]?bit(?:$|[-_.\/])/i);
        if (bitMatch) return `${bitMatch[1]}-bit`;
        const quantizationMatch = mlxName.match(/(?:^|[-_.\/])(IQ\d_[A-Z0-9_]+|Q\d(?:_[A-Z0-9]+)+|BF16|FP16|FP8|MXFP4|NVFP4)(?:$|[-.\/])/i);
        return quantizationMatch?.[1]?.toUpperCase() || '';
    }
    const basename = filename.split('/').pop() || filename;
    const match = basename.match(/(?:UD-)?(IQ\d_[A-Z0-9_]+|Q\d(?:_[A-Z0-9]+)+|MXFP4(?:_[A-Z0-9]+)*|BF16|F16|F32)\.gguf$/i);
    return match?.[1]?.toUpperCase() || '';
};

const getModelParameterCount = (modelName: string) => {
    const mixtureMatch = modelName.match(/(?:^|[^a-z0-9])(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b(?=$|[^a-z0-9])/i);
    if (mixtureMatch) return Number(mixtureMatch[1]) * Number(mixtureMatch[2]) * 1_000_000_000;

    const matches = [...modelName.matchAll(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*([bm])(?=$|[^a-z0-9])/gi)];
    return matches.reduce((largest, match) => {
        const scale = match[2].toLowerCase() === 'b' ? 1_000_000_000 : 1_000_000;
        return Math.max(largest, Number(match[1]) * scale);
    }, 0);
};

const getQuantizationBits = (quantization: string) => {
    const normalized = quantization.toUpperCase();
    const explicitBits = normalized.match(/(?:^|[^0-9])(\d+)[-_]?BIT/);
    if (explicitBits) return Number(explicitBits[1]);
    const ggufBits = normalized.match(/(?:^|[^A-Z0-9])(?:I?Q)(\d)/);
    if (ggufBits) return Number(ggufBits[1]);
    if (/BF16|FP16|F16/.test(normalized)) return 16;
    if (/FP8|F8/.test(normalized)) return 8;
    if (/MXFP4|NVFP4/.test(normalized)) return 4;
    if (/FP32|F32/.test(normalized)) return 32;
    return 16;
};

export const estimateModelMemoryBytes = (model: VyactHubModel, filename: string) => {
    const fileSize = model.file_sizes?.[filename] || 0;
    const companionSize = model.dflash2_model?.size || (model.runtime === 'mlx' ? model.mtp_model?.size || 0 : 0);
    if (fileSize > 0) return (fileSize + companionSize) * MODEL_MEMORY_OVERHEAD_RATIO;

    const parameterCount = getModelParameterCount(`${model.id}/${filename}`);
    if (!parameterCount) return 0;
    const quantizationBits = getQuantizationBits(getModelQuantization(model, filename));
    return parameterCount * (quantizationBits / 8) * MODEL_MEMORY_OVERHEAD_RATIO;
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

export const getOptimizedModelContext = (
    metadata: VyactGgufMetadata | undefined,
    fileSize: number,
    hardware: VyactHardwareInfo,
) => {
    const modelLimit = metadata?.contextLength || DEFAULT_MODEL_CONTEXT;
    const capacity = getTotalModelMemoryCapacity(hardware);
    if (!metadata?.kvCacheBytes || !capacity || !fileSize) {
        return Math.max(512, Math.min(DEFAULT_MODEL_CONTEXT, modelLimit));
    }
    const fixedMemory = Math.max(fileSize * MODEL_MEMORY_OVERHEAD_RATIO, fileSize + metadata.runtimeBufferBytes);
    const contextBudget = Math.max(0, capacity * .8 - fixedMemory);
    const bytesPerToken = metadata.kvCacheBytes / DEFAULT_MODEL_CONTEXT;
    const memoryLimitedContext = Math.floor(contextBudget / bytesPerToken);
    const candidates = [131072, 65536, 32768, 16384, 8192, 4096, 2048, 1024, 512];
    return candidates.find(value => value <= modelLimit && value <= memoryLimitedContext) || 512;
};
