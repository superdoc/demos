import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validLogServices = new Set(['all', 'api', 'rooms', 'worker', 'agent', 'documentworker', 'collab', 'client', 'dev']);

function parseLogServices(arguments_) {
  const logIndex = arguments_.indexOf('--log');
  if (logIndex === -1) return new Set(['all']);
  const value = arguments_[logIndex + 1];
  if (!value || value.startsWith('--')) throw new Error('--log requires a comma-separated service list.');
  const services = new Set(value.split(',').map((service) => service.trim().replaceAll('-', '')).filter(Boolean));
  const invalid = [...services].filter((service) => !validLogServices.has(service));
  if (invalid.length) {
    throw new Error(`Unknown log service: ${invalid.join(', ')}. Choose from: ${[...validLogServices].join(', ')}.`);
  }
  return services;
}

const logServices = parseLogServices(process.argv.slice(2));
const logs = (service) => logServices.has('all') || logServices.has(service);

function loadEnvironment() {
  const environment = { ...process.env };
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) throw new Error('Missing .env. Run: cp .env.example .env');
  for (const sourceLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    environment[key] ??= value;
  }
  if (!environment.OPENAI_API_KEY) throw new Error('Add OPENAI_API_KEY to .env before starting the demo.');
  return {
    ...environment,
    PORT: '8000',
    PUBLIC_ORIGIN: 'http://localhost:8000',
    DOCUMENT_ROOT: path.join(root, 'data'),
    VITE_API_URL: 'http://localhost:8000',
    LOG_SERVICES: [...logServices].join(','),
  };
}

const environment = loadEnvironment();
const services = [
  {
    name: 'server',
    command: process.execPath,
    args: ['src/server.js'],
    cwd: path.join(root, 'server'),
    showOutput: [...logServices].some((service) => service !== 'client' && service !== 'dev') || logServices.has('all'),
  },
  { name: 'client', command: 'npm', args: ['run', 'dev'], cwd: path.join(root, 'client'), showOutput: logs('client') },
];
const processes = [];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of processes) if (child.exitCode === null) child.kill('SIGKILL');
  }, 5_000).unref();
  if (exitCode) process.exitCode = exitCode;
}

for (const service of services) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: environment,
    stdio: ['inherit', service.showOutput ? 'inherit' : 'ignore', 'inherit'],
  });
  processes.push(child);
  if (logs('dev')) console.log(`[dev] started ${service.name} (pid ${child.pid})`);
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[dev] ${service.name} exited (${signal ?? code})`);
      stop(code || 1);
    }
  });
}

if (logs('dev')) console.log('[dev] open http://localhost:15173');
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
