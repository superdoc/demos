import { streamTextInput } from '../tools/stream-text-tool.js';
import { setTimeout as delay } from 'node:timers/promises';
import { isStreamPauseError, StreamPauseError, targetChanged } from './stream-conflicts.js';

const maximumWriteAttempts = 5;

function checked(result) {
  const receipt = result?.receipt ?? result;
  if (!receipt?.success) {
    const error = new Error(receipt?.failure?.message ?? receipt?.error ?? 'The streaming document mutation failed.');
    error.code = receipt?.failure?.code;
    throw error;
  }
  return result;
}

// Native collaborative edits: replace the original passage once, then insert
// only newly generated suffixes. Already-applied text remains on cancellation.
export function createTextStream(handle, { changeMode, signal }) {
  let metadata;
  let lastText = '';
  let block;
  let result;
  let used = false;
  let sourceBlock;
  let paused;

  async function match(text, within) {
    const { revision } = await handle.blocks.list({ offset: 0, limit: 1 });
    if (typeof revision !== 'string' || revision === 'unknown') throw new Error('The current document revision is unavailable.');
    let matches;
    try {
      matches = await handle.query.match({ select: { type: 'text', pattern: text, caseSensitive: true },
        ...(within ? { within } : {}), require: 'any', limit: 2 });
    } catch (error) {
      if (error?.code === 'TARGET_NOT_FOUND') throw targetChanged();
      throw error;
    }
    const item = matches.items?.[0];
    // Follow an unchanged, unique quote within the same block, even when a
    // human insertion before it shifts its offsets. Never jump to a copy.
    if (matches.total !== 1 || matches.items?.length !== 1 || !item?.address || !item?.target
      || item.target.start.blockId !== item.target.end.blockId
      || (within && item.target.start.blockId !== within.nodeId)) {
      throw targetChanged();
    }
    return { item, revision };
  }

  async function update(input) {
    if (paused) throw paused;
    signal?.throwIfAborted();
    const args = streamTextInput(input);
    const identity = JSON.stringify([args.mode, args.anchor]);
    if (metadata && metadata !== identity) throw new Error('The streaming target changed during generation.');
    if (!args.text.startsWith(lastText)) throw new Error('Generated text changed an already streamed prefix.');
    if (args.text === lastText) return;
    const suffix = args.text.slice(lastText.length);
    for (let attempt = 0; attempt < maximumWriteAttempts; attempt++) {
      signal?.throwIfAborted();
      let attemptedWrite = false;
      try {
        if (!used && ['append', 'paragraphBefore', 'paragraphAfter'].includes(args.mode)) {
          let at = { kind: 'documentEnd' };
          let expectedRevision;
          if (args.mode !== 'append') {
            const { item, revision } = await match(args.anchor, sourceBlock);
            sourceBlock ??= item.address;
            at = { kind: args.mode === 'paragraphBefore' ? 'before' : 'after', target: item.address };
            expectedRevision = revision;
          }
          signal?.throwIfAborted();
          attemptedWrite = true;
          result = checked(await handle.create.paragraph({ text: suffix, at, changeMode, ...(expectedRevision ? { expectedRevision } : {}) }, { changeMode, expectedRevision }));
          block = result.paragraph;
        } else {
          const { item, revision } = await match(used ? lastText : args.anchor, used ? block : sourceBlock);
          if (!used) sourceBlock ??= item.address;
          let target = { ...item.target, coordinateSpace: 'visible' };
          const replacing = !used && args.mode === 'replace';
          if (!replacing) {
            const point = !used && args.mode === 'before' ? target.start : target.end;
            target = { ...target, start: point, end: point };
          }
          signal?.throwIfAborted();
          const options = { changeMode, expectedRevision: revision };
          attemptedWrite = true;
          result = checked(await (replacing
            ? handle.replace({ target, text: suffix, ...options }, options)
            : handle.insert({ target, value: suffix, type: 'text', ...options }, options)));
          block = item.address;
        }
        metadata = identity;
        lastText = args.text;
        used = true;
        return;
      } catch (error) {
        if (isStreamPauseError(error)) { paused = error; throw error; }
        // This SDK failure explicitly rejects a write before applying it.
        // Timeouts, transport errors and other failures must never be replayed.
        if (error?.code !== 'REVISION_MISMATCH') {
          if (attemptedWrite) error.streamWriteAttempted = true;
          throw error;
        }
        if (attempt === maximumWriteAttempts - 1) {
          paused = new StreamPauseError('STREAM_DOCUMENT_BUSY',
            'Agent paused because the document kept changing before its next write could be applied. Your edits and text already streamed remain in the document. Run the prompt again when ready.');
          throw paused;
        }
        await delay(20 * 2 ** attempt, undefined, { signal });
      }
    }
  }

  return {
    update,
    async commit(args) {
      await update(args);
      signal?.throwIfAborted();
      if (!used) throw new Error('The generated document text was empty.');
      try { await match(lastText, block); }
      catch (error) {
        if (isStreamPauseError(error)) paused = error;
        // Completion reads can fail after all text has already been written.
        // The model must not repeat the tool to recover an uncertain result.
        error.streamWriteAttempted = true;
        throw error;
      }
      return { success: true, streamed: true, characters: lastText.length, receipt: result?.receipt ?? result };
    },
  };
}
