import {gguf} from '@huggingface/gguf';
import type {VyactGgufMetadata} from '../services/api';

const BYTES_PER_F16_VALUE = 2;
const MINIMUM_RUNTIME_BUFFER_BYTES = 512 * 1024 ** 2;

export type GgufModelMetadata = VyactGgufMetadata;

interface GgufRepositoryMetadata {
    architecture: string;
    parameterCount: number;
    contextLength: number;
    blockCount: number;
    kvCacheBytes: number;
}

const repositoryMetadataCache = new Map<string, Promise<GgufRepositoryMetadata>>();

const asNumber = (value: unknown) => typeof value === 'bigint' ? Number(value) : Number(value || 0);

const getQuantization = (filename: string) => {
    const match = filename.match(/(?:^|[-_])(UD-)?((?:I?Q)\d(?:_[A-Z0-9]+)+)(?:\.|-)/i);
    return match?.[2]?.toUpperCase() || 'GGUF';
};

const buildResolveUrl = (repository: string, filename: string, revision: string) => {
    const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
    const encodedFilename = filename.split('/').map(encodeURIComponent).join('/');
    return `https://huggingface.co/${encodedRepository}/resolve/${encodeURIComponent(revision)}/${encodedFilename}`;
};

export const inspectRemoteGguf = (
    repository: string,
    filename: string,
    revision: string,
    fileSize: number,
    contextSize: number,
    token: string,
) => {
    const cacheKey = `${repository}@${revision}@${contextSize}`;
    let repositoryRequest = repositoryMetadataCache.get(cacheKey);

    if (!repositoryRequest) {
        repositoryRequest = (async (): Promise<GgufRepositoryMetadata> => {
            const parsed = await gguf(buildResolveUrl(repository, filename, revision), {
                computeParametersCount: true,
                additionalFetchHeaders: token ? {Authorization: `Bearer ${token}`} : undefined,
            });
            const metadata = parsed.metadata as unknown as Record<string, unknown>;
            const architecture = String(metadata['general.architecture'] || 'GGUF');
            const blockCount = asNumber(metadata[`${architecture}.block_count`]);
            const headCount = asNumber(metadata[`${architecture}.attention.head_count`]);
            const kvHeadCount = asNumber(metadata[`${architecture}.attention.head_count_kv`]) || headCount;
            const embeddingLength = asNumber(metadata[`${architecture}.embedding_length`]);
            const keyLength = asNumber(metadata[`${architecture}.attention.key_length`]) || (headCount ? embeddingLength / headCount : 0);
            const valueLength = asNumber(metadata[`${architecture}.attention.value_length`]) || keyLength;
            const fullAttentionInterval = Math.max(1, asNumber(metadata[`${architecture}.full_attention_interval`]) || 1);
            const attentionLayerCount = Math.ceil(blockCount / fullAttentionInterval);
            const contextLength = asNumber(metadata[`${architecture}.context_length`]);
            const effectiveContextSize = Math.min(contextSize, contextLength || contextSize);
            return {
                architecture,
                parameterCount: parsed.parameterCount,
                contextLength,
                blockCount,
                kvCacheBytes: effectiveContextSize * attentionLayerCount * kvHeadCount
                    * (keyLength + valueLength) * BYTES_PER_F16_VALUE,
            };
        })();
        repositoryMetadataCache.set(cacheKey, repositoryRequest);
        repositoryRequest.catch(() => repositoryMetadataCache.delete(cacheKey));
    }

    return repositoryRequest.then(metadata => {
        const runtimeBufferBytes = Math.ceil(Math.max(MINIMUM_RUNTIME_BUFFER_BYTES, fileSize * .05));
        return {
            ...metadata,
            quantization: getQuantization(filename),
            runtimeBufferBytes,
            estimatedMemoryBytes: fileSize + metadata.kvCacheBytes + runtimeBufferBytes,
        };
    });
};
