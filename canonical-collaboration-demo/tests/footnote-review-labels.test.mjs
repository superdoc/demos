import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFootnoteReviewLabel } from '../client/src/reference-integration/workarounds/footnote-review-labels.ts';

test('footnote caption correction preserves IDs, native type, and decisions', () => {
  const comment = { commentId: 'native-id', trackedChange: true, trackedChangeDisplayType: 'tableInsert',
    trackedChangeText: 'footnote insertion', trackedChangeLabel: null, trackedChangeDecision: null };
  assert.equal(applyFootnoteReviewLabel(comment), true);
  assert.deepEqual(comment, { commentId: 'native-id', trackedChange: true, trackedChangeDisplayType: 'tableInsert',
    trackedChangeText: 'footnote insertion', trackedChangeLabel: 'Added footnote', trackedChangeDecision: null });
  assert.equal(applyFootnoteReviewLabel(comment), false);
});

test('actual tables, ordinary comments, and already-correct footnote captions are untouched', () => {
  for (const comment of [null,
    { trackedChange: true, trackedChangeDisplayType: 'tableInsert', trackedChangeText: '' },
    { trackedChange: false, trackedChangeDisplayType: 'tableInsert', trackedChangeText: 'footnote insertion' },
    { trackedChange: true, trackedChangeDisplayType: 'footnoteInsert', trackedChangeText: 'footnote insertion' },
  ]) {
    const before = structuredClone(comment);
    assert.equal(applyFootnoteReviewLabel(comment), false);
    assert.deepEqual(comment, before);
  }
});
