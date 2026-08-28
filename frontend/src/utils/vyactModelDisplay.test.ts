import {describe, expect, it} from 'vitest';
import type {VyactHubModel} from '../services/api';
import {estimateModelMemoryBytes} from './vyactModelDisplay';

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
        expect(estimateModelMemoryBytes(exactModel, 'model-Q4_K_M.gguf')).toBe(6_000_000_000);
    });
});
