import {describe, expect, it} from 'vitest';
import type {VyactHubModel} from '../services/api';
import {estimateModelMemoryBytes, getModelPublisher, resolveModelMemoryBytes} from './vyactModelDisplay';

const model = (overrides: Partial<VyactHubModel>): VyactHubModel => ({
    id: 'example/model-12B',
    revision: 'main',
    files: ['model-Q4_K_M.gguf'],
    file_sizes: {},
    mtp_supported_files: [],
    dflash2_supported_files: [],
    downloads: 0,
    runtime: 'gguf',
    ...overrides,
});

describe('estimateModelMemoryBytes', () => {
    it('estimates GGUF memory from parameter and quantization names', () => {
        expect(estimateModelMemoryBytes(model({}), 'model-Q4_K_M.gguf')).toBe(7_200_000_000);
    });

    it('supports decimal and future MLX model names', () => {
        const mlxModel = model({id: 'example/future-1.5B-4bit', files: ['future-1.5B-4bit'], runtime: 'mlx'});
        expect(estimateModelMemoryBytes(mlxModel, 'future-1.5B-4bit')).toBe(900_000_000);
    });

    it('uses a fetched MLX repository size instead of a larger name estimate', () => {
        const mlxModel = model({
            id: 'example/Qwen3.5-9B-MLX-8bit',
            files: ['__mlx_repository__'],
            file_sizes: {'__mlx_repository__': 1_250_000_000},
            runtime: 'mlx',
            quantization: '8-bit',
        });
        const estimatedMemory = 1_250_000_000 + 512 * 1024 ** 2;
        expect(estimateModelMemoryBytes(mlxModel, '__mlx_repository__')).toBe(estimatedMemory);
        expect(resolveModelMemoryBytes(mlxModel, '__mlx_repository__', 1_500_000_000)).toBe(estimatedMemory);
    });

    it('reads GGUF-style quantization embedded in an MLX repository name', () => {
        const mlxModel = model({id: 'example/future-27B-Q3_K_XL-MLX', files: ['future-27B-Q3_K_XL-MLX'], runtime: 'mlx'});
        expect(estimateModelMemoryBytes(mlxModel, 'future-27B-Q3_K_XL-MLX')).toBe(12_150_000_000);
    });

    it('uses total parameters for mixture model names', () => {
        const mixtureModel = model({id: 'example/mixture-8x7B'});
        expect(estimateModelMemoryBytes(mixtureModel, 'model-Q4_K_M.gguf')).toBe(33_600_000_000);
    });

    it('keeps exact file sizes ahead of name estimates', () => {
        const exactModel = model({file_sizes: {'model-Q4_K_M.gguf': 5_000_000_000}});
        expect(estimateModelMemoryBytes(exactModel, 'model-Q4_K_M.gguf')).toBe(5_000_000_000 + 512 * 1024 ** 2);
    });
});

describe('getModelPublisher', () => {
    it('returns the Hugging Face repository owner', () => {
        expect(getModelPublisher('mlx-community/Qwen3.5-9B-MLX-4bit')).toBe('mlx-community');
        expect(getModelPublisher('Qwen3.5-9B-MLX-4bit')).toBe('');
    });
});
