import type {KnowledgeCollection} from '../types';
import {api} from './api';
import {KNOWLEDGE_COLLECTIONS_UPDATED_EVENT} from '../constants/ui';

const STORAGE_KEY = 'vyact:knowledge-collections';

const readStoredCollections = (): KnowledgeCollection[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

let collections = readStoredCollections();
let initializationRequest: Promise<KnowledgeCollection[]> | null = null;

export const getCachedKnowledgeCollections = () => collections;

export const setCachedKnowledgeCollections = (nextCollections: KnowledgeCollection[]) => {
    collections = nextCollections;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
    } catch {
        // Storage may be unavailable in private or restricted browser contexts.
    }
    window.dispatchEvent(new Event(KNOWLEDGE_COLLECTIONS_UPDATED_EVENT));
};

export const updateCachedKnowledgeCollections = (updater: (current: KnowledgeCollection[]) => KnowledgeCollection[]) => {
    setCachedKnowledgeCollections(updater(collections));
};

// Invoked once at renderer startup. All knowledge controls read this shared cache
// and therefore never need to fetch the collection list when they are opened.
export const initializeKnowledgeCollections = (): Promise<KnowledgeCollection[]> => {
    if (initializationRequest) return initializationRequest;
    initializationRequest = api.getKnowledgeCollections()
        .then(result => {
            setCachedKnowledgeCollections(result.collections || []);
            return collections;
        })
        .catch(() => collections);
    return initializationRequest;
};
