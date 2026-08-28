export const ADAPTIVE_PROJECT_COLOR = '#f5f5f5';

export const PROJECT_COLORS = [
    ADAPTIVE_PROJECT_COLOR,
    '#ff6468',
    '#ff8a4c',
    '#ffd342',
    '#42c978',
    '#3696ed',
    '#9d6af1',
    '#ef7abb',
];

export const getProjectDisplayColor = (color?: string | null): string => {
    if (!color) return 'var(--project-active)';
    return color.toLowerCase() === ADAPTIVE_PROJECT_COLOR ? 'var(--project-neutral)' : color;
};

