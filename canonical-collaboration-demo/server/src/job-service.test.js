import assert from 'node:assert/strict';
import test from 'node:test';
import { JobService } from './job-service.js';
import { Room } from './rooms/store.js';

test('jobs forward a snapshot of selected text to the agent separately from the prompt', async () => {
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  let received;
  const room = { document: {}, conversationFor: () => [], withAgent: (_session, run) => run('Aldric'), startJob() {}, finishJob: finish, updateLastActivityAt() {} };
  const jobs = new JobService({ require: () => room }, { async run(...args) { received = args; return 'Done.'; } });
  const input = { prompt: 'Shorten this.', selectedText: '  The selected passage.\n', isSuggesting: false };
  const record = jobs.create('room', 'alice', input);
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
    assert.throws(() => jobs.create('room', 'alice', { prompt: 'Shorten this.', selectedText }), { statusCode: 400 });
  }
  assert.equal(runs, 0);
});

test('job subscribers receive answer prefixes before the agent finishes', async () => {
  let callbacks;
  let complete;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const room = { document: {}, conversationFor: () => [], withAgent: (_session, run) => run('Aldric'), startJob() {}, finishJob: finish, updateLastActivityAt() {} };
  const jobs = new JobService({ require: () => room }, { run(_document, _prompt, _history, _mode, _signal, options) {
    callbacks = options;
    return new Promise((resolve) => { complete = resolve; });
  } });
  const job = jobs.create('room', 'alice', { prompt: 'Explain this.' });
  const answers = [];
  const unsubscribe = jobs.subscribe('room', 'alice', job.id, (current) => answers.push({ answer: current.answer, status: current.status }));
  callbacks.onTextDelta('First ');
  callbacks.onTextDelta('second.');
  assert.deepEqual(answers, [{ answer: 'First ', status: 'running' }, { answer: 'First second.', status: 'running' }]);
  complete('First second.');
  await finished;
  assert.equal(job.status, 'completed');
  unsubscribe();
});


test('jobs use separate conversations and check ownership even inside the same room', async () => {
  const room = new Room({ roomId: 'shared', document: {} });
  const histories = [];
  const jobs = new JobService({ require: () => room }, { async run(_document, prompt, history) {
    histories.push(history.map((message) => message.content));
    history.push({ role: 'user', content: prompt });
    return 'Done.';
  } });
  const alice = jobs.create('shared', 'alice', { prompt: 'Alice’s draft' });
  const bob = jobs.create('shared', 'bob', { prompt: 'Bob’s draft' });
  assert.throws(() => jobs.get('shared', 'bob', alice.id), { statusCode: 404 });
  assert.throws(() => jobs.cancel('shared', 'alice', bob.id), { statusCode: 404 });
  assert.throws(() => jobs.subscribe('shared', 'bob', alice.id, () => {}), { statusCode: 404 });
  await new Promise((resolve) => jobs.subscribe('shared', 'bob', bob.id, (job) => {
    if (job.status === 'completed') resolve();
  }));
  assert.deepEqual(histories, [[], []]);
  assert.deepEqual(room.conversationFor('alice'), [{ role: 'user', content: 'Alice’s draft' }]);
  assert.deepEqual(room.conversationFor('bob'), [{ role: 'user', content: 'Bob’s draft' }]);
  room.documentReplaced();
  assert.deepEqual(room.conversationFor('alice'), []);
  assert.deepEqual(room.conversationFor('bob'), []);
});
