import { Hocuspocus } from '@hocuspocus/server';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import { documentIdFromRoomName } from './room-name.js';

export function createCollaborationServer({ authorize, roomStore, docxAutosave, hooks = {} }) {
  const autosaveSockets = new Set();

  return new Hocuspocus({
    quiet: true,
    ...(authorize && {
      async onAuthenticate({ token, documentName, connection }) {
        const access = await authorize({
          token,
          roomName: documentName,
          documentId: documentIdFromRoomName(documentName),
        });
        if (!access) throw new Error('Access denied.');
        if (access.readOnly) connection.readOnly = true;
        return { userId: access.userId };
      },
    }),
    async onLoadDocument({ documentName, document }) {
      const state = await roomStore.load(documentName);
      if (state) applyUpdate(document, state);
      return document;
    },
    async onStoreDocument({ documentName, document }) {
      await roomStore.store(documentName, encodeStateAsUpdate(document));
    },
    async onConnect(context) {
      if (docxAutosave && context.requestParameters.get(docxAutosave.marker.name) === docxAutosave.marker.value) {
        autosaveSockets.add(context.socketId);
      }
      await hooks.onConnect?.(context);
    },
    async onChange(context) {
      if (docxAutosave && !autosaveSockets.has(context.socketId)) docxAutosave.roomChanged(context.documentName);
      await hooks.onChange?.(context);
    },
    async onDisconnect(context) {
      autosaveSockets.delete(context.socketId);
      if (docxAutosave && context.clientsCount === 0) docxAutosave.roomEmptied(context.documentName);
      await hooks.onDisconnect?.(context);
    },
  });
}
