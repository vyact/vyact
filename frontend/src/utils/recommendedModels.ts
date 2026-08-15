import type { TFunction } from 'i18next';

interface RecommendedModel {
    id: string;
    name: string;
    desc: string;
}

const MODEL_TRANSLATION_KEYS: Record<string, string> = {
    'x/flux2-klein:9b': 'flux2Klein',
    'x/z-image-turbo:latest': 'zImageTurbo',
    'gemma4:e4b-mlx': 'gemma4E4bMlx',
    'gemma4:12b-mlx': 'gemma4_12bMlx',
    'qwen3.5:2b-mlx': 'qwen35_2bMlx',
    'qwen3.5:4b-mlx': 'qwen35_4bMlx',
    'qwen3.5:2b': 'qwen35_2b',
    'qwen3.5:4b': 'qwen35_4b',
    'gemma4:26b': 'gemma4_26b',
};

export function getRecommendedModelDisplay(model: RecommendedModel, t: TFunction) {
    const translationKey = MODEL_TRANSLATION_KEYS[model.id];
    if (!translationKey) return { name: model.name, desc: model.desc };

    return {
        name: t(`setup:models.${translationKey}.name`, { defaultValue: model.name }),
        desc: t(`setup:models.${translationKey}.desc`, { defaultValue: model.desc }),
    };
}
