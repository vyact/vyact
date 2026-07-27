export type DriveUploadItem = {
    file: File;
    path: string;
};

export type DriveDropContents = {
    files: DriveUploadItem[];
    directories: string[];
};

const readFileEntry = (entry: FileSystemFileEntry) =>
    new Promise<File>((resolve, reject) => entry.file(resolve, reject));

const readDirectoryEntries = async (entry: FileSystemDirectoryEntry) => {
    const reader = entry.createReader();
    const entries: FileSystemEntry[] = [];
    while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) return entries;
        entries.push(...batch);
    }
};

const collectEntry = async (entry: FileSystemEntry, parentPath: string, contents: DriveDropContents) => {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
        contents.files.push({file: await readFileEntry(entry as FileSystemFileEntry), path});
        return;
    }
    if (!entry.isDirectory) return;
    contents.directories.push(path);
    const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
    await Promise.all(children.map(child => collectEntry(child, path, contents)));
};

export async function getDriveDropContents(dataTransfer: DataTransfer): Promise<DriveDropContents> {
    const contents: DriveDropContents = {files: [], directories: []};
    const entries = Array.from(dataTransfer.items)
        .filter(item => item.kind === 'file')
        .map(item => item.webkitGetAsEntry?.())
        .filter((entry): entry is FileSystemEntry => Boolean(entry));

    if (entries.length > 0) {
        await Promise.all(entries.map(entry => collectEntry(entry, '', contents)));
        return contents;
    }

    contents.files = Array.from(dataTransfer.files).map(file => ({
        file,
        path: file.webkitRelativePath || file.name,
    }));
    return contents;
}

export function getDriveInputContents(fileList: FileList): DriveDropContents {
    const files = Array.from(fileList).map(file => ({
        file,
        path: file.webkitRelativePath || file.name,
    }));
    const directories = new Set<string>();
    files.forEach(({path}) => {
        const parts = path.split('/');
        for (let index = 1; index < parts.length; index += 1) {
            directories.add(parts.slice(0, index).join('/'));
        }
    });
    return {files, directories: Array.from(directories)};
}
