import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { logEvent } from './logging.js';

const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
const maximumPromptCharacters = 20_000;

export class JobService {
  #rooms;
  #agent;
  #queue = [];
  #records = new Map();
  #active;
  #running = false;

  constructor(rooms, agent) {
    this.#rooms = rooms;
    this.#agent = agent;
  }

  create(roomId, input) {
    this.#rooms.require(roomId);
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt || prompt.length > maximumPromptCharacters) {
      const error = new Error(`Prompt must contain between 1 and ${maximumPromptCharacters} characters.`);
      error.name = 'HttpError';
      error.statusCode = 400;
      throw error;
    }
    if (input?.isSuggesting !== undefined && typeof input.isSuggesting !== 'boolean') {
      const error = new Error('isSuggesting must be a boolean.');
      error.name = 'HttpError';
      error.statusCode = 400;
      throw error;
    }
    const timestamp = new Date().toISOString();
    const record = {
      id: `job_${randomUUID().replaceAll('-', '')}`,
      room_id: roomId,
      prompt,
      isSuggesting: input.isSuggesting ?? true,
      status: 'queued',
      created_at: timestamp,
      updated_at: timestamp,
      answer: null,
      error: null,
    };
    this.#records.set(record.id, record);
    this.#queue.push(record.id);
    logEvent('worker', 'job.queued', { jobId: record.id, roomId, queueSize: this.#queue.length });
    void this.#drain();
    return record;
  }

  get(roomId, jobId) {
    const record = this.#records.get(jobId);
    if (!record || record.room_id !== roomId) {
      const error = new Error('Job not found.');
      error.name = 'HttpError';
      error.statusCode = 404;
      throw error;
    }
    return record;
  }

  cancel(roomId, jobId) {
    const record = this.get(roomId, jobId);
    if (terminalStatuses.has(record.status)) return record;
    record.status = 'cancelled';
    record.updated_at = new Date().toISOString();
    if (this.#active?.record.id === jobId) this.#active.controller.abort(new Error('Agent job cancelled.'));
    logEvent('worker', 'job.cancelled', { jobId, roomId });
    return record;
  }

  expire() {
    const cutoff = Date.now() - config.completedJobTtlMs;
    const expired = [...this.#records.values()]
      .filter((record) => terminalStatuses.has(record.status) && new Date(record.updated_at).getTime() < cutoff)
      .map((record) => record.id);
    for (const jobId of expired) this.#records.delete(jobId);
    if (expired.length) logEvent('worker', 'jobs.expired', { jobIds: expired, retainedJobs: this.#records.size });
    return expired;
  }

  stop() {
    this.#active?.controller.abort(new Error('Worker stopping.'));
    logEvent('worker', 'worker.stopped');
  }

  async #drain() {
    if (this.#running) return;
    this.#running = true;
    logEvent('worker', 'worker.started');
    try {
      while (this.#queue.length) {
        const jobId = this.#queue.shift();
        const record = this.#records.get(jobId);
        if (!record || record.status === 'cancelled') continue;
        let room;
        const controller = new AbortController();
        this.#active = { record, controller };
        try {
          room = this.#rooms.require(record.room_id);
          room.startJob();
          record.status = 'running';
          record.updated_at = new Date().toISOString();
          logEvent('worker', 'job.running', { jobId, roomId: record.room_id, queueSize: this.#queue.length });
          record.answer = await this.#agent.run(
            room.document,
            record.prompt,
            room.conversation,
            record.isSuggesting,
            controller.signal,
          );
          if (record.status !== 'cancelled') {
            record.status = 'applying_edit';
            record.updated_at = new Date().toISOString();
            room.updateLastActivityAt();
            record.status = 'completed';
          }
        } catch (error) {
          if (controller.signal.aborted || record.status === 'cancelled') {
            record.status = 'cancelled';
          } else {
            record.status = 'failed';
            record.error = error instanceof Error ? error.message : String(error);
            logEvent('worker', 'job.failed', { jobId, roomId: record.room_id, error: record.error });
          }
        } finally {
          record.updated_at = new Date().toISOString();
          room?.finishJob();
          this.#active = undefined;
          logEvent('worker', 'job.finished', { jobId, roomId: record.room_id, status: record.status, queueSize: this.#queue.length });
        }
      }
    } finally {
      this.#running = false;
    }
  }
}
