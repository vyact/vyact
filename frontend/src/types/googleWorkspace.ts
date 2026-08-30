export type GoogleCalendarSelection = {
    eventId: string;
    startAt: string;
    requestId: number;
};

export type GoogleDriveSelection = {
    folderId: string;
    folderName: string;
    accountId?: string;
    requestId: number;
};

export const OPEN_GOOGLE_DRIVE_EVENT = 'vyact:open-google-drive';
