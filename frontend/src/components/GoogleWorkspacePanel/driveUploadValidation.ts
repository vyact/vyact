import type {DriveDropContents} from './driveDrop';

// Keep aligned with MAX_DRIVE_UPLOAD_BYTES in the Microsoft workspace router.
export const DRIVE_UPLOAD_LIMIT_MIB = 25;
export const DRIVE_UPLOAD_LIMIT_BYTES = DRIVE_UPLOAD_LIMIT_MIB * 1024 * 1024;

export function findOversizedDriveUpload(provider: 'google' | 'microsoft', contents: DriveDropContents) {
    if (provider !== 'microsoft') return undefined;
    return contents.files.find(({file}) => file.size > DRIVE_UPLOAD_LIMIT_BYTES);
}
