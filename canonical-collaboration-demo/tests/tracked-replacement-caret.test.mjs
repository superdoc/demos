import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installTrackedReplacementCaretRepair } from '../client/src/workarounds/tracked-replacement-caret.ts';

const story = { kind: 'story', storyType: 'body' };
const point = (offset, blockId = 'paragraph') => ({ kind: 'text', blockId, offset, story });
const tracked = () => ({ kind: 'selection', start: point(24), end: point(30), story, coordinateSpace: 'tracked' });
const visible = () => ({ kind: 'text', segments: [{ blockId: 'paragraph', range: { start: 9, end: 15 } }], story });
const snapshot = () => ({ status: 'ready', empty: false, selectionTarget: tracked(), target: visible() });

function setup(t) {
  const document = new EventTarget();
  const root = { ownerDocument: document, contains: (node) => node === input };
  const input = { closest: () => input };
  let current = snapshot();
  let enabled = true;
  let result = { ok: true };
  const applied = [];
  const repair = installTrackedReplacementCaretRepair({ root,
    selection: { getSnapshot: () => current, apply(target) { applied.push(target); return result; } },
    enabled: () => enabled,
  });
  t.after(repair.destroy);
  function event(type = 'keydown', properties = {}) {
    const e = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({ target: input, key: 't', isComposing: false, ...properties })) {
      Object.defineProperty(e, key, { value });
    }
    document.dispatchEvent(e);
    assert.equal(e.defaultPrevented, false, 'The repair must leave native typing in control');
  }
  return { applied, event, repair, get: () => current,
    set(value) { current = value; }, enable(value) { enabled = value; }, fail() { result = { ok: false }; },
  };
}

test('normalizes a tracked selection using the native visible range before typing', (t) => {
  const h = setup(t);
  const original = structuredClone(h.get());
  h.event();
  assert.deepEqual(h.applied, [{ ...tracked(), coordinateSpace: 'visible', start: point(9), end: point(15) }]);
  assert.deepEqual(h.get(), original, 'Do not mutate cached native selection data');
});

test('rapid typing cannot reapply the stale original range before native reads settle', (t) => {
  const h = setup(t);
  for (const key of 'test') h.event('keydown', { key });
  assert.equal(h.applied.length, 1);
  h.set({ status: 'ready', empty: true, selectionTarget: { ...tracked(), start: point(13), end: point(13) }, target: null });
  h.event();
  assert.equal(h.applied.length, 1);
});

test('a new explicit selection can be normalized again, including the same coordinates', (t) => {
  const h = setup(t);
  h.event();
  h.event('pointerdown');
  h.event();
  assert.equal(h.applied.length, 2);
});

test('clean visible selections, disabled mode, composition, shortcuts and non-typing keys stay native', (t) => {
  for (const variant of ['visible', 'disabled', 'composition', 'control', 'meta', 'alt', 'ArrowLeft', 'Dead']) {
    const h = setup(t);
    if (variant === 'visible') h.set({ ...h.get(), selectionTarget: { ...tracked(), coordinateSpace: 'visible' } });
    if (variant === 'disabled') h.enable(false);
    h.event('keydown', { key: ['ArrowLeft', 'Dead'].includes(variant) ? variant : 't',
      isComposing: variant === 'composition', ctrlKey: variant === 'control', metaKey: variant === 'meta', altKey: variant === 'alt' });
    assert.deepEqual(h.applied, [], variant);
  }
});

test('stale, cross-block and deletion-side ranges are not reinterpreted', (t) => {
  for (const variant of ['stale', 'cross-block', 'deleted', 'tracked-visible', 'multi-segment', 'node-edge']) {
    const h = setup(t);
    const state = h.get();
    if (variant === 'stale') state.status = 'stale';
    if (variant === 'cross-block') state.selectionTarget.end.blockId = 'another';
    if (variant === 'deleted') state.target.segments[0].range.end = 10;
    if (variant === 'tracked-visible') state.target.coordinateSpace = 'tracked';
    if (variant === 'multi-segment') state.target.segments.push({ blockId: 'another', range: { start: 0, end: 2 } });
    if (variant === 'node-edge') state.selectionTarget.start = { kind: 'nodeEdge' };
    h.event();
    assert.deepEqual(h.applied, [], variant);
  }
});

test('other inputs and cleanup never change a later selection', (t) => {
  const h = setup(t);
  h.event('keydown', { target: { closest: () => null } });
  assert.deepEqual(h.applied, []);
  h.repair.destroy();
  h.event();
  assert.deepEqual(h.applied, []);
});

test('an unsupported native selection apply leaves the keystroke untouched', (t) => {
  const h = setup(t);
  h.fail();
  h.event();
  assert.equal(h.applied.length, 1);
});
