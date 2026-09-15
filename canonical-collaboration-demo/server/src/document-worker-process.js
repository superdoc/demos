import { execFileSync } from 'node:child_process';
import { createAgentToolkit, SuperDocClient } from '@superdoc/sdk';

const documents = new Map();
const megabytes = (bytes) => Math.round((bytes / 1_000_000) * 10) / 10;
const selectedServices = new Set((process.env.LOG_SERVICES ?? 'all').split(',').map((value) => value.trim()));
const loggingEnabled = selectedServices.has('all') || selectedServices.has('documentworker');
const memorySampleIntervalMs = Math.max(1_000, Number(process.env.DOCUMENT_WORKER_MEMORY_SAMPLE_MS ?? 5_000));

function descendantRssBytes() {
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/))
      .filter(Boolean)
      .map((match) => ({
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        rssKilobytes: Number(match[3]),
        command: match[4],
      }));
    const childrenByParent = new Map();
    for (const { pid, parentPid, rssKilobytes, command } of rows) {
      if (parentPid === process.pid && /(?:^|\/)ps -axo pid=/.test(command)) continue;
      const children = childrenByParent.get(parentPid) ?? [];
      children.push({ pid, rssKilobytes });
      childrenByParent.set(parentPid, children);
    }
    let totalKilobytes = 0;
    const pending = [process.pid];
    while (pending.length) {
      for (const child of childrenByParent.get(pending.pop()) ?? []) {
        totalKilobytes += child.rssKilobytes;
        pending.push(child.pid);
      }
    }
    return totalKilobytes * 1024;
  } catch {
    return 0;
  }
}

function memoryUsage() {
  const workerRssBytes = process.memoryUsage().rss;
  const runtimeRssBytes = descendantRssBytes();
  return {
    workerRssMb: megabytes(workerRssBytes),
    runtimeRssMb: megabytes(runtimeRssBytes),
    totalRssMb: megabytes(workerRssBytes + runtimeRssBytes),
  };
}

function logWorker(event, fields = {}) {
  if (!loggingEnabled) return;
  const details = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}:${typeof value === 'string' && value.includes(' ') ? JSON.stringify(value) : value}`)
    .join(' ');
  const memory = memoryUsage();
  console.log(
    `[document-worker] ${event}${details ? ` ${details}` : ''}`
    + ` workerRssMB:${memory.workerRssMb} runtimeRssMB:${memory.runtimeRssMb} totalRssMB:${memory.totalRssMb}`,
  );
}

const client = new SuperDocClient({
  runtime: 'v2',
  startupTimeoutMs: 20_000,
  watchdogTimeoutMs: 180_000,
  defaultChangeMode: 'direct',
  user: { name: 'Document worker', email: 'document-worker@demo.local' },
});
await client.connect();
const toolkit = await createAgentToolkit({ provider: 'openai', preset: 'core' });
logWorker('service.ready', { pid: process.pid, documents: 0 });
process.send?.({ type: 'ready' });
const memorySampler = loggingEnabled
  ? setInterval(() => logWorker('memory.sample', { documents: documents.size }), memorySampleIntervalMs)
  : undefined;
memorySampler?.unref();

function requireDocument(documentId) {
  const document = documents.get(documentId);
  if (!document) throw new Error(`Document is not open: ${documentId}`);
  return document;
}

async function execute(operation, payload) {
  switch (operation) {
    case 'getToolkit':
      return { tools: toolkit.tools, systemPrompt: toolkit.systemPrompt };
    case 'open': {
      if (documents.has(payload.documentId)) throw new Error(`Document is already open: ${payload.documentId}`);
      const document = await client.open({
        doc: payload.documentPath,
        collaboration: payload.collaboration,
      }, { timeoutMs: 150_000 });
      documents.set(payload.documentId, document);
      logWorker('document.synced', { documentId: payload.documentId, documents: documents.size });
      return { sessionId: document.sessionId };
    }
    case 'replaceFile': {
      const result = await requireDocument(payload.documentId).replaceFile(payload.documentPath, { timeoutMs: 150_000 });
      logWorker('document.replaced', { documentId: payload.documentId, documents: documents.size });
      return result;
    }
    case 'dispatch':
      return toolkit.dispatch(requireDocument(payload.documentId), payload.tool, payload.args);
    case 'save':
      return requireDocument(payload.documentId).save({ out: payload.outputPath, force: true });
    case 'close': {
      const document = requireDocument(payload.documentId);
      await document.close({ discard: true });
      documents.delete(payload.documentId);
      logWorker('document.closed', { documentId: payload.documentId, documents: documents.size });
      return { closed: true };
    }
    case 'shutdown':
      await shutdownRuntime();
      return { stopped: true };
    default:
      throw new Error(`Unknown document operation: ${operation}`);
  }
}

let shutdownPromise;
function shutdownRuntime(disposeClient = true) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    if (memorySampler) clearInterval(memorySampler);
    logWorker('service.stopping', { pid: process.pid, documents: documents.size });
    if (disposeClient) {
      for (const document of documents.values()) await document.close({ discard: true }).catch(() => {});
      await client.dispose().catch(() => {});
    }
    documents.clear();
    logWorker('service.stopped', { pid: process.pid, documents: 0 });
  })();
  return shutdownPromise;
}

let operationQueue = Promise.resolve();
process.on('message', (message) => {
  operationQueue = operationQueue.then(async () => {
    const started = performance.now();
    logWorker('operation.started', {
      operation: message.operation,
      documentId: message.payload?.documentId,
      documents: documents.size,
    });
    try {
      const result = await execute(message.operation, message.payload ?? {});
      logWorker('operation.completed', {
        operation: message.operation,
        documentId: message.payload?.documentId,
        durationMs: Math.round(performance.now() - started),
        documents: documents.size,
      });
      process.send?.({ type: 'response', id: message.id, ok: true, result });
      if (message.operation === 'shutdown') process.disconnect();
    } catch (error) {
      logWorker('operation.failed', {
        operation: message.operation,
        documentId: message.payload?.documentId,
        durationMs: Math.round(performance.now() - started),
        documents: documents.size,
        error: error instanceof Error ? error.message : String(error),
      });
      process.send?.({
        type: 'response',
        id: message.id,
        ok: false,
        error: {
          name: error?.name,
          message: error instanceof Error ? error.message : String(error),
          code: error?.code,
          details: error?.details,
        },
      });
    }
  });
});

async function stopFromSignal() {
  await shutdownRuntime(false);
  if (process.connected) process.disconnect();
}

process.once('SIGINT', () => void stopFromSignal());
process.once('SIGTERM', () => void stopFromSignal());
