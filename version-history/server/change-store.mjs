import { Doc, Skip, applyUpdate, decodeStateVector, decodeUpdate, encodeStateVector } from 'yjs';

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
function transactionClocks(update) {
  const clocks = new Map();
  // encodeStateVectorFromUpdate only reports continuous clocks starting at zero;
  // an incremental edit normally starts later in an existing client's history.
  for (const struct of decodeUpdate(decodeBase64(update)).structs) {
    if (struct instanceof Skip) continue;
    clocks.set(struct.id.client, Math.max(clocks.get(struct.id.client) ?? 0, struct.id.clock + struct.length));
  }
  return clocks;
}
export function decodeBase64(value) {
  if (typeof value !== 'string' || !value.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw invalid('Expected base64 Yjs data');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw invalid('Invalid base64 Yjs data');
  return bytes;
}

export function validateRecords(items) {
  if (!Array.isArray(items) || items.length > 1000) throw invalid('Expected at most 1000 change records');
  for (const record of items) {
    if (!record || typeof record.id !== 'string' || !record.id.length || record.id.length > 2048
      || typeof record.revision !== 'string' || !record.at || typeof record.at.observed !== 'string'
      || !Array.isArray(record.changes) || record.changes.length > 10000
      || !['authored', 'declared', 'relayed', 'unknown'].includes(record.provenance)
      || (record.actor !== null && (!record.actor || !(record.actor.id === null || typeof record.actor.id === 'string')))
      || !record.session || !Number.isSafeInteger(record.session.clientId)) throw invalid('Invalid change record');
    const vector = transactionClocks(record.update);
    if (!vector.size) throw invalid('A change record must carry its transaction clocks');
  }
  return items;
}

export function validateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint.revision !== 'string' || typeof checkpoint.at !== 'string'
    || !(checkpoint.cursor === null || typeof checkpoint.cursor === 'string')
    || !(checkpoint.baseVersionId === null || typeof checkpoint.baseVersionId === 'string')) throw invalid('Invalid change checkpoint');
  const state = decodeBase64(checkpoint.state);
  const vector = decodeBase64(checkpoint.stateVector);
  const document = new Doc();
  try {
    applyUpdate(document, state);
    if (!document.getMap('content').size) throw invalid('Snapshot has no document content');
    if (!Buffer.from(encodeStateVector(document)).equals(vector)) throw invalid('Snapshot state does not match its state vector');
  } finally { document.destroy(); }
  return state;
}

export function containsRecord(stateVector, record) {
  const state = decodeStateVector(decodeBase64(stateVector));
  const update = transactionClocks(record.update);
  return update.size > 0 && [...update].every(([client, clock]) => (state.get(client) ?? 0) >= clock);
}

export function intervalRecords(records, checkpoint, previous) {
  return records.filter((record) => containsRecord(checkpoint.stateVector, record)
    && (!previous?.stateVector || !containsRecord(previous.stateVector, record)));
}
