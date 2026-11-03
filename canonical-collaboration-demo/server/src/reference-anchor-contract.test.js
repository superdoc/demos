import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateReferenceAnchor } from './reference-integration/workarounds/reference-anchor-input.js';
import { toolErrorResult } from './reference-integration/agent/tool-errors.js';

test('anchor validation names every invalid path and supplies concrete recovery examples', () => {
  let result;
  try { validateReferenceAnchor({ kind: 'sectionEnd', offset: 42, blockId: 'a' }); }
  catch (error) { result = toolErrorResult(error); }
  assert.equal(result.code, 'INVALID_REFERENCE_ANCHOR');
  assert.deepEqual(result.issues.map((issue) => issue.path), ['anchor.sectionHeading', 'anchor.offset', 'anchor.blockId']);
  assert.match(result.error, /anchor.sectionHeading: Required non-empty string/);
  assert.equal(result.recovery.action, 'correct_arguments');
  assert.equal(result.recovery.inspectRequired, false);
  for (const example of result.recovery.examples) assert.doesNotThrow(() => validateReferenceAnchor(example));
});

test('malformed objects, unknown kinds and empty scope strings fail at the correct path', () => {
  for (const [anchor, path] of [[null, 'anchor'], [[], 'anchor'], ['sectionEnd', 'anchor'],
    [{ kind: 'section_end' }, 'anchor.kind'], [{ kind: 'paragraphEnd', blockId: null }, 'anchor.blockId'],
    [{ kind: 'afterText', text: 'quote', sectionHeading: ' ' }, 'anchor.sectionHeading']]) {
    assert.throws(() => validateReferenceAnchor(anchor), (error) => error.code === 'INVALID_REFERENCE_ANCHOR' && error.issues[0].path === path);
  }
});

test('nullable anchor scopes normalize without mutating the input', () => {
  const anchor = { kind: 'afterText', text: 'quoted words', sectionHeading: null, blockId: null };
  assert.deepEqual(validateReferenceAnchor(anchor), { kind: 'afterText', text: 'quoted words' });
  assert.equal(anchor.sectionHeading, null);
});
