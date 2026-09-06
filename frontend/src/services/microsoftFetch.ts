import {assertOk} from '../utils/apiError';
import {handleMicrosoftApiError, type MicrosoftErrorFeedback} from '../utils/microsoftErrorToast';

export async function microsoftFetch(input: RequestInfo | URL, init?: RequestInit,
                                     feedback: MicrosoftErrorFeedback = 'action'): Promise<Response> {
    try {
        const response = await globalThis.fetch(input, init);
        await assertOk(response);
        return response;
    } catch (error) {
        if (init?.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
        throw handleMicrosoftApiError(error, feedback);
    }
}
