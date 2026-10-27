import type {Story} from './storyStorage';
export type NovelExportFormat = 'pdf' | 'md';

export async function downloadNovel(story: Story, format: NovelExportFormat, chapterId?: string) {
    const response = await fetch('/api/novel-studio/export', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({story: {...story, settingsCandidates: []}, format, chapter_id: chapterId}),
    });
    if (!response.ok) throw new Error('Novel export failed');
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const filename = encodedName ? decodeURIComponent(encodedName) : `${story.title}.${chapterId ? format : 'zip'}`;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
