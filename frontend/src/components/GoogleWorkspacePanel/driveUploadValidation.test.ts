import {describe, expect, it} from 'vitest';
import {DRIVE_UPLOAD_LIMIT_BYTES, findOversizedDriveUpload} from './driveUploadValidation';
import type {DriveDropContents} from './driveDrop';

const selection = (...sizes: number[]): DriveDropContents => ({
    files: sizes.map((size, index) => ({file: {size} as File, path: `folder/nested/${index}.bin`})),
    directories: ['folder', 'folder/nested'],
});

describe('OneDrive upload preflight', () => {
    it('rejects an oversized nested file even after valid files', () => {
        expect(findOversizedDriveUpload('microsoft', selection(1, DRIVE_UPLOAD_LIMIT_BYTES + 1))?.path)
            .toBe('folder/nested/1.bin');
    });
    it('allows the exact limit and totals exceeding the per-file limit', () => {
        expect(findOversizedDriveUpload('microsoft', selection(DRIVE_UPLOAD_LIMIT_BYTES, DRIVE_UPLOAD_LIMIT_BYTES))).toBeUndefined();
    });
    it('allows empty folders and does not limit Google Drive', () => {
        expect(findOversizedDriveUpload('microsoft', selection())).toBeUndefined();
        expect(findOversizedDriveUpload('google', selection(DRIVE_UPLOAD_LIMIT_BYTES + 1))).toBeUndefined();
    });
});
