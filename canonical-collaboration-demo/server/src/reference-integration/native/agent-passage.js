import { createHash } from 'node:crypto';

const maxPassageLength = 4_000;
export const inlineProperties = ['bold', 'italic', 'underline', 'strike', 'color', 'highlight', 'fontSize'];

export function passageHint(text, block, offset) {
  if (!block?.nodeId || !Number.isSafeInteger(offset) || !text.trim() || text.length > maxPassageLength || /[\r\n]/.test(text)) return;
  return { text, block, offset };
}

async function revisionFor(handle, block) {
  const scope = block?.story ? { in: block.story } : {};
  const { revision } = await handle.blocks.list({ ...scope, limit: 1 });
  if (typeof revision !== 'string' || revision === 'unknown') throw new Error('The current document revision is unavailable.');
  return revision;
}

async function locate(handle, { text, block }) {
  const scope = block?.story ? { in: block.story } : {};
  const revision = await revisionFor(handle, block);
  const matches = await handle.query.match({
    ...scope, ...(block ? { within: block } : {}),
    select: { type: 'text', pattern: text, caseSensitive: true }, require: 'all', limit: 100,
  });
  const candidates = (matches.items ?? []).filter(({ target }) =>
    target?.start && target.start.blockId === target.end?.blockId && (!block || target.start.blockId === block.nodeId));
  return { revision, candidates, total: matches.total ?? candidates.length };
}

async function fingerprint(handle, block) {
  const text = await handle.getText({ scope: block, reviewMode: 'final' });
  if (typeof text !== 'string') throw new Error('The current passage could not be verified.');
  return createHash('sha256').update(text).digest('hex');
}

export async function captureAgentPassage(handle, hint) {
  if (!hint) return;
  const { candidates, total, revision } = await locate(handle, hint);
  if (!candidates.some(({ target }) => target.start.offset === hint.offset)) return;
  const signature = await fingerprint(handle, hint.block);
  if (await revisionFor(handle, hint.block) !== revision) return;
  return { ...hint, total, fingerprint: signature };
}

export async function findAgentPassage(handle, text, selection) {
  if (typeof text !== 'string' || !text.trim() || /[\r\n]/.test(text) || text.length > maxPassageLength) {
    throw new Error('Select or quote one short, continuous passage.');
  }
  if (selection) {
    const { address } = await handle.getNodeById({ id: selection.blockId });
    const hint = passageHint(text, address, selection.start);
    if (!hint || selection.end - selection.start !== text.length) throw new Error('The selected passage could not be verified. Select the text again.');
    const focus = await captureAgentPassage(handle, hint);
    if (!focus) throw new Error('The selected passage changed. Select the text again.');
    return focus;
  }
  const { candidates, total } = await locate(handle, { text });
  if (total !== 1 || candidates.length !== 1) throw new Error('The passage must match exactly one place in the document. Select a more specific passage.');
  const [{ address, target }] = candidates;
  return { text, block: address, offset: target.start.offset, total, fingerprint: await fingerprint(handle, address) };
}

export async function resolveAgentPassage(handle, focus) {
  if (!focus) throw new Error('There is no recent passage to use. Select or quote the exact text.');
  const { address } = await handle.getNodeById({ id: focus.block.nodeId, story: focus.block.story }).catch(() => ({}));
  if (address?.kind !== 'block') throw new Error('That passage is no longer in the document. Ask the user to select or quote the exact text.');
  const block = focus.block.story ? { ...address, story: focus.block.story } : address;
  const { candidates, revision, total } = await locate(handle, { ...focus, block });
  let current;
  if (total === 1 && candidates.length === 1 && focus.total === 1) current = candidates[0];
  else if (candidates.length && await fingerprint(handle, block) === focus.fingerprint) {
    current = candidates.find(({ target }) => target.start.offset === focus.offset);
  }
  if (!current) throw new Error('That passage changed or is ambiguous. Select or quote the exact text you mean.');
  return {
    revision,
    target: { ...current.target, coordinateSpace: 'visible' },
    hint: { ...focus, block, offset: current.target.start.offset },
  };
}

export async function readAgentPassageFormatting(handle, target, revision) {
  const { properties } = await handle.format.readSelection({ target, expectedRevision: revision });
  const inline = {};
  const mixed = [];
  for (const property of inlineProperties) {
    const value = properties?.[property];
    if (value?.state === 'uniform' && value.value != null) inline[property] = value.value;
    if (value?.state === 'mixed' || value?.state === 'unresolvable') mixed.push(property);
  }
  return { inline, mixed };
}

export function passageRange(target, start, end) {
  return {
    ...target,
    start: { ...target.start, offset: target.start.offset + start },
    end: { ...target.end, offset: target.start.offset + end },
  };
}

export async function snapshotAgentPassageFormatting(handle, target, revision, text) {
  const formatting = await readAgentPassageFormatting(handle, target, revision);
  if (!formatting.mixed.length || text.length !== target.end.offset - target.start.offset) return formatting;
  let readsLeft = 24;
  const runs = [];
  const unresolved = new Set();

  async function capture(start, end, known) {
    const style = known ?? await readAgentPassageFormatting(handle, passageRange(target, start, end), revision);
    let split = start + Math.floor((end - start) / 2);
    if (/[\uDC00-\uDFFF]/.test(text[split] ?? '')) split++;
    if (style.mixed.length && split > start && split < end && readsLeft >= 2) {
      readsLeft -= 2;
      await capture(start, split);
      await capture(split, end);
      return;
    }
    for (const property of style.mixed) unresolved.add(property);
    const previous = runs.at(-1);
    if (previous && JSON.stringify(previous.inline) === JSON.stringify(style.inline)) previous.end = end;
    else runs.push({ start, end, inline: style.inline });
  }

  await capture(0, text.length, formatting);
  return { ...formatting, mixed: [...unresolved], runs };
}
