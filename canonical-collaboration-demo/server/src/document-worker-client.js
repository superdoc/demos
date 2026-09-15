import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const workerPath = fileURLToPath(new URL('./document-worker-process.js', import.meta.url));

export class DocumentWorkerClient {
  #child;
  #pending = new Map();
  #ready;

  async start() {
    this.#child = fork(workerPath, [], {
      env: process.env,
      serialization: 'advanced',
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    this.#child.on('message', (message) => this.#receive(message));
    this.#child.on('exit', (code, signal) => {
      const error = new Error(`Document worker exited (${signal ?? code}).`);
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    });
    this.#ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Document worker did not become ready.')), 30_000);
      this.#pending.set('ready', {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject,
      });
    });
    await this.#ready;
  }

  getToolkit() {
    return this.#request('getToolkit');
  }

  open(documentId, documentPath, collaboration) {
    return this.#request('open', { documentId, documentPath, collaboration });
  }

  replaceFile(documentId, documentPath) {
    return this.#request('replaceFile', { documentId, documentPath });
  }

  dispatch(documentId, tool, args) {
    return this.#request('dispatch', { documentId, tool, args });
  }

  save(documentId, outputPath) {
    return this.#request('save', { documentId, outputPath });
  }

  close(documentId) {
    return this.#request('close', { documentId });
  }

  async stop() {
    if (!this.#child || this.#child.exitCode !== null) return;
    await this.#request('shutdown').catch(() => {});
    await new Promise((resolve) => {
      if (this.#child.exitCode !== null) return resolve();
      const timeout = setTimeout(() => {
        this.#child.kill('SIGTERM');
        resolve();
      }, 5_000);
      this.#child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  #request(operation, payload = {}) {
    if (!this.#child || this.#child.exitCode !== null || !this.#child.connected) {
      return Promise.reject(new Error('Document worker is unavailable.'));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child.send({ id, operation, payload }, (error) => {
        if (!error) return;
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  #receive(message) {
    if (message?.type === 'ready') {
      const pending = this.#pending.get('ready');
      this.#pending.delete('ready');
      pending?.resolve();
      return;
    }
    if (message?.type !== 'response') return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      const error = new Error(message.error?.message ?? 'Document worker operation failed.');
      error.name = message.error?.name ?? 'DocumentWorkerError';
      error.code = message.error?.code;
      error.details = message.error?.details;
      pending.reject(error);
    }
  }
}
