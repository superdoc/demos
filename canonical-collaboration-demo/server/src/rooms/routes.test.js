import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';

process.env.COLLABORATION_AUTH = 'none';
const { registerRoomRoutes } = await import('./routes.js');

async function fixture({ roomExists = true, jobService = null } = {}) {
  const app = Fastify();
  app.decorate('httpErrors', {
    badRequest(message) {
      const error = new Error(message);
      error.statusCode = 400;
      return error;
    },
  });
  const issued = [];
  const rooms = {
    require(roomId) {
      if (!roomExists) {
        const error = new Error('Room not found.');
        error.statusCode = 404;
        throw error;
      }
      return { roomId };
    },
  };
  registerRoomRoutes(app, {
    rooms,
    jobService,
    createCollaborationToken(documentId, userId) {
      issued.push({ documentId, userId });
      return `token:${documentId}:${userId}`;
    },
  });
  await app.ready();
  return { app, issued };
}

test('issues a token only for an existing room and a valid user ID', async () => {
  const { app, issued } = await fixture();
  try {
    const response = await app.inject({
      method: 'POST', url: '/api/rooms/contract-42/collaboration-token', payload: { userId: ' alice ' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { token: 'token:contract-42:alice' });
    assert.deepEqual(issued, [{ documentId: 'contract-42', userId: 'alice' }]);

    const invalid = await app.inject({
      method: 'POST', url: '/api/rooms/contract-42/collaboration-token', payload: { userId: ' ' },
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('does not issue a token for a missing room', async () => {
  const { app, issued } = await fixture({ roomExists: false });
  try {
    const response = await app.inject({
      method: 'POST', url: '/api/rooms/missing/collaboration-token', payload: { userId: 'alice' },
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(issued, []);
  } finally {
    await app.close();
  }
});

test('a paused job sends its conflict notice and closes the event stream', async () => {
  const record = { id: 'paused-job', room_id: 'contract-42', status: 'paused', error: 'Select the edited passage and run the prompt again.' };
  let unsubscribed = 0;
  const { app } = await fixture({ jobService: { get: () => record, subscribe: () => () => { unsubscribed++; } } });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/rooms/contract-42/jobs/paused-job/events' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/event-stream');
    assert.deepEqual(JSON.parse(response.body.trim().slice('data: '.length)), record);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unsubscribed, 1);
  } finally { await app.close(); }
});
