import { expect, test } from '@playwright/test';
import { buildOutlineSkeleton } from '../src/outline/generate-outline';

test('outline skeleton preserves heading hierarchy and duplicate labels by ID', () => {
  expect(buildOutlineSkeleton([
    { id: 'plan', text: 'Plan', level: 1 },
    { id: 'milestones', text: 'Milestones', level: 2 },
    { id: 'first-notes', text: 'Notes', level: 3 },
    { id: 'second-notes', text: 'Notes', level: 2 },
    { id: 'decisions', text: 'Decisions', level: 1 },
  ])).toEqual([
    { id: 'plan', text: 'Plan', children: [
      { id: 'milestones', text: 'Milestones', children: [
        { id: 'first-notes', text: 'Notes', children: [] },
      ] },
      { id: 'second-notes', text: 'Notes', children: [] },
    ] },
    { id: 'decisions', text: 'Decisions', children: [] },
  ]);
});

test('outline skeleton supports empty outlines and skipped heading levels', () => {
  expect(buildOutlineSkeleton([])).toEqual([]);
  expect(buildOutlineSkeleton([
    { id: 'root', text: 'Root', level: 1 },
    { id: 'detail', text: 'Detail', level: 3 },
    { id: 'next', text: 'Next', level: 2 },
  ])).toEqual([{ id: 'root', text: 'Root', children: [
    { id: 'detail', text: 'Detail', children: [] },
    { id: 'next', text: 'Next', children: [] },
  ] }]);
});
