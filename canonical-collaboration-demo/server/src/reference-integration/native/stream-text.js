import { streamTextInput } from '../tools/stream-text-tool.js';

function checked(result) {
  const receipt = result?.receipt ?? result;
  if (!receipt?.success) throw new Error(receipt?.failure?.message ?? receipt?.error ?? 'The streaming document mutation failed.');
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
  let expectedStart;

  async function match(text, within) {
    const { revision } = await handle.blocks.list({ offset: 0, limit: 1 });
    if (typeof revision !== 'string' || revision === 'unknown') throw new Error('The current document revision is unavailable.');
    const matches = await handle.query.match({ select: { type: 'text', pattern: text, caseSensitive: true },
      ...(within ? { within, require: 'all', limit: 200 } : { require: 'exactlyOne' }) });
    const candidates = within ? matches.items?.filter((item) => item.target?.start.offset === expectedStart) : matches.items;
    const item = candidates?.[0];
    if (candidates?.length !== 1 || !item?.target || item.target.start.blockId !== item.target.end.blockId) {
      throw new Error('The streaming anchor must match exactly one passage in one paragraph. Inspect again or use the structured document tools.');
    }
    return { item, revision };
  }

  async function update(input) {
    signal?.throwIfAborted();
    const args = streamTextInput(input);
    const identity = JSON.stringify([args.mode, args.anchor]);
    if (metadata && metadata !== identity) throw new Error('The streaming target changed during generation.');
    if (!args.text.startsWith(lastText)) throw new Error('Generated text changed an already streamed prefix.');
    if (args.text === lastText) return;
    const suffix = args.text.slice(lastText.length);
    if (!used && ['append', 'paragraphBefore', 'paragraphAfter'].includes(args.mode)) {
      let at = { kind: 'documentEnd' };
      let expectedRevision;
      if (args.mode !== 'append') {
        const { item, revision } = await match(args.anchor);
        at = { kind: args.mode === 'paragraphBefore' ? 'before' : 'after', target: item.address };
        expectedRevision = revision;
      }
      signal?.throwIfAborted();
      result = checked(await handle.create.paragraph({ text: suffix, at, changeMode, ...(expectedRevision ? { expectedRevision } : {}) }, { changeMode, expectedRevision }));
      block = result.paragraph;
      expectedStart = 0;
    } else {
      const { item, revision } = await match(used ? lastText : args.anchor, block);
      let target = { ...item.target, coordinateSpace: 'visible' };
      const replacing = !used && args.mode === 'replace';
      if (!replacing) {
        const point = !used && args.mode === 'before' ? target.start : target.end;
        target = { ...target, start: point, end: point };
      }
      if (!used) expectedStart = target.start.offset;
      signal?.throwIfAborted();
      const options = { changeMode, expectedRevision: revision };
      result = checked(await (replacing
        ? handle.replace({ target, text: suffix, ...options }, options)
        : handle.insert({ target, value: suffix, type: 'text', ...options }, options)));
      block = item.address;
    }
    metadata = identity;
    lastText = args.text;
    used = true;
  }

  return {
    update,
    async commit(args) {
      await update(args);
      signal?.throwIfAborted();
      if (!used) throw new Error('The generated document text was empty.');
      return { success: true, streamed: true, characters: lastText.length, receipt: result?.receipt ?? result };
    },
  };
}
