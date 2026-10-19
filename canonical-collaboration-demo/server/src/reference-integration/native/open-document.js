import { ReferenceDocument, prepareReferenceDocument } from '../reference-document.js';

// The SDK client and collaboration configuration belong to the host application.
export async function openReferenceDocument({ client, toolkit, id, filename, path, collaboration, onClose, logEvent }) {
  const importedCitations = await prepareReferenceDocument(path);
  const handle = await client.open({ doc: path, collaboration }, { timeoutMs: 150_000 });
  return new ReferenceDocument({ id, filename, path, handle, toolkit, importedCitations, onClose, logEvent });
}
