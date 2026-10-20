import type { SuperDoc } from 'superdoc';
import { api } from './api';
import type { Room } from './types';
import type { ReferenceTransport } from './reference-integration/types';

export const referenceContainer = (superdoc: SuperDoc) => superdoc.ui.viewport.getHost()?.closest<HTMLElement>('.document-pane');
export const typingContainer = (superdoc: SuperDoc) => superdoc.ui.viewport.getHost()?.closest<HTMLElement>('.editor-shell');

export function createReferenceTransport(room: Room): ReferenceTransport {
  return {
    getDocument: (fieldCodes) => api.getDocumentBlob(room.room_id, undefined, fieldCodes),
    getRevision: async () => (await api.getCitationSources(room.room_id)).evaluatedRevision,
    removeCitation: (input) => api.removeCitation(room, input),
    removeEmptyBibliography: (blockId, expectedRevision) => api.removeEmptyBibliography(room, blockId, expectedRevision),
  };
}
