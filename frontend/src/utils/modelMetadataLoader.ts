import {api, type VyactHubModel} from '../services/api';
import {inspectRemoteGguf, type GgufModelMetadata} from './ggufMetadata';
import {getModelFileKey, getSelectableModelFiles, resolveModelMemoryBytes} from './vyactModelDisplay';

const DEFAULT_MODEL_CONTEXT = 32768;

export const loadSearchModelMetadata = async (
    models: VyactHubModel[], token: string, contextSize = DEFAULT_MODEL_CONTEXT,
    usePersistentCache = true,
): Promise<Record<string, GgufModelMetadata>> => {
    const entries = await Promise.all(models.flatMap(model =>
        getSelectableModelFiles(model.files).map(async filename => {
            const key = getModelFileKey(model, filename);
            if (model.runtime === 'mlx' && model.metadata) {
                return [key, {
                    ...model.metadata,
                    estimatedMemoryBytes: resolveModelMemoryBytes(
                        model, filename, model.metadata.estimatedMemoryBytes,
                    ),
                }] as const;
            }
            if (model.runtime !== 'gguf') return null;
            const fileSize = model.file_sizes?.[filename] || 0;
            if (usePersistentCache) {
                try {
                    const cached = await api.getVyactModelMetadataCache(
                        model.id, filename, model.revision, contextSize,
                    );
                    if (cached) return [key, cached] as const;
                } catch {
                    // 캐시가 없어도 원격 GGUF 헤더 분석을 계속한다.
                }
            }
            try {
                const metadata = await inspectRemoteGguf(
                    model.id, filename, model.revision, fileSize, contextSize, token,
                );
                if (usePersistentCache) {
                    void api.saveVyactModelMetadataCache(
                        model.id, filename, model.revision, contextSize, fileSize, metadata,
                    ).catch(() => undefined);
                }
                return [key, metadata] as const;
            } catch {
                return null;
            }
        }),
    ));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, GgufModelMetadata] => entry !== null));
};
