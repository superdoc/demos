import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import config from './profile.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const serverRoot = path.join(root, 'server');
const documentPath = process.argv[2];
const outputPath = process.argv[3] ?? path.join(root, 'profiling/document-worker/results/memory-trials.csv');
const trials = Number.parseInt(process.argv[4] ?? String(config.trials), 10);
if (!Number.isInteger(trials) || trials < 1) {
  throw new Error('Trial count must be a positive integer.');
}
if (!documentPath) {
  throw new Error('Usage: node profiling/document-worker/profile.mjs /path/to/document.docx [output.csv] [trials]');
}
const { samplesPerState, sampleIntervalMs, settleMs, startupWarmupMs, port, operations } = config;

function loadEnvironment() {
  const environment = { ...process.env };
  const source = awaitFile(path.join(root, '.env'));
  return source.then((contents) => {
    for (const sourceLine of contents.split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const separator = line.indexOf('=');
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      environment[key] ??= value;
    }
    if (!environment.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required in .env.');
    return environment;
  });
}

async function awaitFile(filename) {
  return fs.readFile(filename, 'utf8');
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForServer(baseUrl, process_) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process_.exitCode !== null) throw new Error(`Profile server exited with status ${process_.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(200);
  }
  throw new Error('Timed out waiting for the profile server.');
}

function parseOutput(stream, onLine) {
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  });
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
      resolve();
    }, 10_000);
    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

const environment = await loadEnvironment();
const documentBytes = await fs.readFile(documentPath);
const rows = [];

for (let trial = 1; trial <= trials; trial += 1) {
  const dataRoot = await fs.mkdtemp(path.join(tmpdir(), `superdoc-memory-trial-${trial}-`));
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: serverRoot,
    env: {
      ...environment,
      PORT: String(port),
      PUBLIC_ORIGIN: `http://localhost:${port}`,
      DOCUMENT_ROOT: dataRoot,
      LOG_SERVICES: 'documentworker',
      DOCUMENT_WORKER_MEMORY_SAMPLE_MS: String(sampleIntervalMs),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const baseUrl = `http://localhost:${port}`;
  let collector;
  const recentErrors = [];

  parseOutput(server.stdout, (line) => {
    const match = line.match(
      /^\[document-worker\] memory\.sample documents:(\d+) workerRssMB:([\d.]+) runtimeRssMB:([\d.]+) totalRssMB:([\d.]+)$/,
    );
    if (!match || !collector || Number(match[1]) !== collector.documents) return;
    collector.samples.push({
      capturedAt: new Date().toISOString(),
      workerRssMb: Number(match[2]),
      runtimeRssMb: Number(match[3]),
      totalRssMb: Number(match[4]),
    });
    if (collector.samples.length === samplesPerState) {
      const completed = collector;
      collector = undefined;
      completed.resolve(completed.samples);
    }
  });
  parseOutput(server.stderr, (line) => {
    recentErrors.push(line);
    if (recentErrors.length > 20) recentErrors.shift();
  });

  async function collect(phase, documents) {
    await delay(settleMs);
    const samples = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        collector = undefined;
        reject(new Error(`Timed out collecting trial ${trial}, phase ${phase}.\n${recentErrors.join('\n')}`));
      }, (samplesPerState + 15) * sampleIntervalMs);
      collector = {
        documents,
        samples: [],
        resolve: (values) => {
          clearTimeout(timeout);
          resolve(values);
        },
      };
    });
    samples.forEach((sample, index) => rows.push({
      trial,
      phase,
      documents,
      sample: index + 1,
      capturedAt: sample.capturedAt,
      workerRssMb: sample.workerRssMb,
      runtimeRssMb: sample.runtimeRssMb,
      totalRssMb: sample.totalRssMb,
    }));
    console.log(
      `trial ${trial}/${trials} ${phase}: total ${average(samples.map((sample) => sample.totalRssMb)).toFixed(1)} MB`
      + ` (worker ${average(samples.map((sample) => sample.workerRssMb)).toFixed(1)},`
      + ` runtime ${average(samples.map((sample) => sample.runtimeRssMb)).toFixed(1)})`,
    );
  }

  try {
    await waitForServer(baseUrl, server);
    await delay(startupWarmupMs);
    for (const operation of operations) {
      const roomId = `profile-${trial}-${operation.slot}`;
      if (operation.action === 'open') {
        const form = new FormData();
        form.set('file', new Blob([documentBytes]), path.basename(documentPath));
        const response = await fetch(`${baseUrl}/api/rooms/${roomId}/document`, { method: 'PUT', body: form });
        if (!response.ok) throw new Error(`${operation.phase} failed: ${response.status} ${await response.text()}`);
      } else if (operation.action === 'close') {
        const response = await fetch(`${baseUrl}/api/rooms/${roomId}/document`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`${operation.phase} failed: ${response.status} ${await response.text()}`);
      } else if (operation.action !== 'sample') {
        throw new Error(`Unsupported profile action: ${operation.action}`);
      }
      await collect(operation.phase, operation.documents);
    }
  } finally {
    await stopServer(server);
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

const trialAverages = new Map();
const overallAverages = new Map();
for (const row of rows) {
  const trialKey = `${row.trial}:${row.phase}`;
  const trialValues = trialAverages.get(trialKey) ?? [];
  trialValues.push(row.totalRssMb);
  trialAverages.set(trialKey, trialValues);
  const overallValues = overallAverages.get(row.phase) ?? [];
  overallValues.push(row.totalRssMb);
  overallAverages.set(row.phase, overallValues);
}

const header = [
  'trial',
  'phase',
  'documents',
  'sample',
  'captured_at',
  'worker_rss_mb',
  'runtime_rss_mb',
  'total_rss_mb',
  'trial_phase_average_mb',
  'overall_phase_average_mb',
];
const csvRows = rows.map((row) => [
  row.trial,
  row.phase,
  row.documents,
  row.sample,
  row.capturedAt,
  row.workerRssMb.toFixed(1),
  row.runtimeRssMb.toFixed(1),
  row.totalRssMb.toFixed(1),
  average(trialAverages.get(`${row.trial}:${row.phase}`)).toFixed(1),
  average(overallAverages.get(row.phase)).toFixed(1),
]);
await fs.writeFile(outputPath, [header, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n');
console.log(`wrote ${rows.length} samples to ${outputPath}`);
