import assert from 'node:assert/strict';
import { test } from 'node:test';
import { referenceAnchorSchema, validateReferenceAnchor } from './reference-anchor-contract.js';
import { citationTool, citationInput } from './citation-tool.js';
import { footnoteTool, footnoteInput } from './footnote-tool.js';
import { toolErrorResult } from './tool-errors.js';

test('strict schemas require the fields for each anchor kind and prohibit unrelated fields', () => {
  assert.equal(citationTool.function.strict, true);
  assert.equal(footnoteTool.function.strict, true);
  const shapes = referenceAnchorSchema.anyOf;
  for (const shape of shapes) {
    assert.equal(shape.additionalProperties, false);
    assert.deepEqual(shape.required, Object.keys(shape.properties));
  }
  assert.deepEqual(shapes.find((shape) => shape.properties.kind.enum[0] === 'sectionEnd').required, ['kind', 'sectionHeading']);
  assert.deepEqual(shapes.find((shape) => shape.properties.kind.enum[0] === 'paragraphEnd').required, ['kind', 'blockId']);
});

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

test('nullable strict scopes normalize once at the tool boundary for both insertion tools', () => {
  const anchor = { kind: 'afterText', text: 'quoted words', sectionHeading: null, blockId: null };
  assert.deepEqual(citationInput({ anchor, sourceId: 'saved', expectedRevision: '1' }).anchor, { kind: 'afterText', text: 'quoted words' });
  assert.deepEqual(footnoteInput({ anchor, content: 'Note.', expectedRevision: '1' }).anchor, { kind: 'afterText', text: 'quoted words' });
  assert.equal(anchor.sectionHeading, null);
});
