import assert from 'node:assert/strict';
import test from 'node:test';
import { JobService } from './job-service.js';
import { targetChanged } from './reference-integration/native/stream-conflicts.js';

test('jobs forward a snapshot of selected text to the agent separately from the prompt', async () => {
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  let received;
  const room = { document: {}, conversation: [], startJob() {}, finishJob: finish, updateLastActivityAt() {} };
  const jobs = new JobService({ require: () => room }, { async run(...args) { received = args; return 'Done.'; } });
  const input = { prompt: 'Shorten this.', selectedText: '  The selected passage.\n', isSuggesting: false };
  const record = jobs.create('room', input);
  input.selectedText = 'A later selection.';
  await finished;
  assert.equal(record.status, 'completed');
  assert.equal(record.prompt, 'Shorten this.');
  assert.equal(received[1], 'Shorten this.');
  assert.equal(received[3], false);
  assert.equal(received[5].selectedText, '  The selected passage.\n');
});

test('jobs reject invalid selection context before running the agent', () => {
  let runs = 0;
  const jobs = new JobService({ require: () => ({}) }, { run() { runs++; } });
  for (const selectedText of [42, null, {}, 'a'.repeat(100_001)]) {
    assert.throws(() => jobs.create('room', { prompt: 'Shorten this.', selectedText }), { statusCode: 400 });
  }
  assert.equal(runs, 0);
});

test('job subscribers receive answer prefixes before the agent finishes', async () => {
  let callbacks;
  let complete;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const room = { document: {}, conversation: [], startJob() {}, finishJob: finish, updateLastActivityAt() {} };
  const jobs = new JobService({ require: () => room }, { run(_document, _prompt, _history, _mode, _signal, options) {
    callbacks = options;
    return new Promise((resolve) => { complete = resolve; });
  } });
  const job = jobs.create('room', { prompt: 'Explain this.' });
  const answers = [];
  const unsubscribe = jobs.subscribe('room', job.id, (current) => answers.push({ answer: current.answer, status: current.status }));
  callbacks.onTextDelta('First ');
  callbacks.onTextDelta('second.');
  assert.deepEqual(answers, [{ answer: 'First ', status: 'running' }, { answer: 'First second.', status: 'running' }]);
  complete('First second.');
  await finished;
  assert.equal(job.status, 'completed');
  unsubscribe();
});

test('target conflicts pause the job, notify subscribers and release the room without model retries', async () => {
  let finish;
  let fail;
  let runs = 0;
  const finished = new Promise((resolve) => { finish = resolve; });
  const room = { document: {}, conversation: [], startJob() {}, finishJob: finish, updateLastActivityAt() {} };
  const jobs = new JobService({ require: () => room }, { async run(_doc, _prompt, _history, _mode, _signal, callbacks) {
    runs++;
    callbacks.onToolCall({ id: 'stream', status: 'generating' });
    await new Promise((_resolve, reject) => { fail = reject; });
  } });
  const job = jobs.create('room', { prompt: 'Rewrite this.' });
  const events = [];
  const unsubscribe = jobs.subscribe('room', job.id, (record) => events.push(structuredClone(record)));
  fail(targetChanged());
  await finished;
  assert.equal(runs, 1);
  assert.equal(job.status, 'paused');
  assert.match(job.error, /target text was changed, deleted, or became ambiguous/);
  assert.match(job.error, /Select the passage/);
  assert.equal(events.at(-1).status, 'paused');
  assert.equal(job.toolCalls[0].status, 'failed');
  assert.equal(jobs.cancel('room', job.id).status, 'paused');
  unsubscribe();
  job.updated_at = '2000-01-01T00:00:00.000Z';
  assert.deepEqual(jobs.expire(), [job.id]);
});
