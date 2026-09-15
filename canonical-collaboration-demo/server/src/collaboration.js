import { Hocuspocus } from '@hocuspocus/server';
import { logEvent } from './diagnostics.js';

export function createCollaboration() {
  let onActivity = () => {};
  const lastChangeLog = new Map();
  const canonicalDocumentId = (documentName) => documentName.split('/').at(-1);
  const server = new Hocuspocus({
    quiet: true,
    async onConnect({ documentName }) {
      logEvent('collab', 'connection.opened', {
        documentName,
        documents: server.getDocumentsCount(),
        connections: server.getConnectionsCount(),
      });
    },
    async onDisconnect({ documentName }) {
      logEvent('collab', 'connection.closed', {
        documentName,
        documents: server.getDocumentsCount(),
        connections: server.getConnectionsCount(),
      });
    },
    async onChange({ documentName }) {
      onActivity(canonicalDocumentId(documentName));
      const timestamp = Date.now();
      if (timestamp - (lastChangeLog.get(documentName) ?? 0) >= 1_000) {
        lastChangeLog.set(documentName, timestamp);
        logEvent('collab', 'document.changed', { documentName });
      }
    },
  });

  return {
    server,
    setActivityHandler(handler) {
      onActivity = handler;
    },
    handleConnection(socket, request) {
      const originalUrl = request.url;
      request.url = originalUrl?.replace(/^\/collaboration/, '') || '/';
      server.handleConnection(socket, request);
      request.url = originalUrl;
    },
    async unload(documentId) {
      const documentName = [...server.documents.keys()].find(
        (candidate) => canonicalDocumentId(candidate) === documentId,
      );
      if (!documentName) return;
      lastChangeLog.delete(documentName);
      server.closeConnections(documentName);
      const document = server.documents.get(documentName);
      if (document) await server.unloadDocument(document);
    },
    async close() {
      server.closeConnections();
      for (const document of [...server.documents.values()]) {
        await server.unloadDocument(document);
      }
    },
  };
}
