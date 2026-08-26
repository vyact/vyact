const SUPPORTED_CHAT_FILE_EXTENSION_LIST = [
    '.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.html', '.htm', '.md', '.zip',
    '.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.kt',
    '.go', '.rs', '.c', '.cpp', '.h', '.cs', '.swift',
    '.yaml', '.yml', '.json', '.toml', '.ini', '.env',
    '.sh', '.bat', '.ps1', '.fish', '.zsh', '.sql', '.csv', '.xml',
    '.css', '.scss', '.sass', '.less',
    '.vue', '.svelte', '.astro', '.graphql', '.gql',
    '.properties', '.gradle', '.cmake', '.mk',
    '.tf', '.proto', '.rb', '.php', '.lua', '.r', '.ex', '.exs',
    '.mp3', '.wav', '.flac',
];

const SUPPORTED_CHAT_FILE_EXTENSIONS = new Set(SUPPORTED_CHAT_FILE_EXTENSION_LIST);

export const CHAT_FILE_ACCEPT = ['image/*', 'audio/mpeg', 'audio/wav', 'audio/flac', ...SUPPORTED_CHAT_FILE_EXTENSION_LIST].join(',');

function getFileExtension(fileName: string): string {
    const extensionStart = fileName.lastIndexOf('.');
    return extensionStart >= 0 ? fileName.slice(extensionStart).toLowerCase() : '';
}

export function isSupportedChatFileName(fileName: string): boolean {
    return SUPPORTED_CHAT_FILE_EXTENSIONS.has(getFileExtension(fileName));
}

export function isSupportedChatFile(file: File): boolean {
    return file.type.startsWith('image/')
        || file.type.startsWith('audio/')
        || isSupportedChatFileName(file.name);
}
