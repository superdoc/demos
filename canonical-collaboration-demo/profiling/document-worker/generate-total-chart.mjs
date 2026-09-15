import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inputPath = process.argv[2] ?? path.join(root, 'profiling/document-worker/results/document-worker-memory-trials.csv');
const outputPath = process.argv[3] ?? path.join(root, 'profiling/document-worker/results/document-worker-memory-by-state.svg');
const csv = (await fs.readFile(inputPath, 'utf8')).trim().split(/\r?\n/);
const rows = csv.slice(1).map((line) => {
  const values = line.split(',');
  return {
    trial: Number(values[0]),
    phase: values[1],
    documents: Number(values[2]),
    sample: Number(values[3]),
    memoryMb: Number(values[5]),
  };
});

const states = [
  ['baseline_0', 'Baseline', '0 docs'],
  ['open_1', 'Open 1', '1 doc'],
  ['open_2', 'Open 2', '2 docs'],
  ['open_3', 'Open 3', '3 docs'],
  ['close_to_2', 'Close', '2 docs'],
  ['close_to_1', 'Close', '1 doc'],
  ['close_to_0', 'Close', '0 docs'],
];
const trials = [...new Set(rows.map((row) => row.trial))].sort((left, right) => left - right);
const width = 1400;
const height = 820;
const margin = { top: 140, right: 80, bottom: 150, left: 105 };
const chartWidth = width - margin.left - margin.right;
const chartHeight = height - margin.top - margin.bottom;
const memoryValues = rows.map((row) => row.memoryMb);
const yMin = Math.floor((Math.min(...memoryValues) - 10) / 25) * 25;
const yMax = Math.ceil((Math.max(...memoryValues) + 10) / 25) * 25;
const x = (index) => margin.left + (chartWidth * index) / (states.length - 1);
const y = (value) => margin.top + chartHeight * (1 - (value - yMin) / (yMax - yMin));
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const trialAverages = new Map();
for (const trial of trials) {
  trialAverages.set(trial, states.map(([phase]) => average(
    rows.filter((row) => row.trial === trial && row.phase === phase).map((row) => row.memoryMb),
  )));
}
const overallAverages = states.map(([phase]) => average(rows.filter((row) => row.phase === phase).map((row) => row.memoryMb)));
const trialColors = [
  '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0D9488',
  '#0891B2', '#2563EB', '#7C3AED', '#C026D3', '#DB2777',
];
const parts = [];

parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
parts.push('<rect width="100%" height="100%" fill="#F8FAFC"/>');
parts.push('<text x="105" y="62" font-family="Inter, Arial, sans-serif" font-size="32" font-weight="700" fill="#172033">Document worker memory across collaboration states</text>');
parts.push(`<text x="105" y="98" font-family="Inter, Arial, sans-serif" font-size="17" fill="#64748B">${trials.length} fresh-process trials · 6 idle samples per state · memory includes the worker and SuperDoc runtime descendants</text>`);

for (let tick = yMin; tick <= yMax; tick += 25) {
  const tickY = y(tick);
  parts.push(`<line x1="${margin.left}" y1="${tickY}" x2="${width - margin.right}" y2="${tickY}" stroke="${tick % 50 === 0 ? '#CBD5E1' : '#E8EDF3'}" stroke-width="1"/>`);
  if (tick % 50 === 0) {
    parts.push(`<text x="${margin.left - 18}" y="${tickY + 6}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="15" fill="#64748B">${tick}</text>`);
  }
}
parts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" stroke="#94A3B8" stroke-width="1.5"/>`);
parts.push(`<line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${width - margin.right}" y2="${margin.top + chartHeight}" stroke="#94A3B8" stroke-width="1.5"/>`);
parts.push(`<text transform="translate(30 ${margin.top + chartHeight / 2}) rotate(-90)" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="600" fill="#475569">Resident memory (MB)</text>`);

for (const row of rows) {
  const stateIndex = states.findIndex(([phase]) => phase === row.phase);
  const trialIndex = trials.indexOf(row.trial);
  const jitter = (row.sample - 3.5) * 3 + (trialIndex - (trials.length - 1) / 2) * 2;
  parts.push(`<circle cx="${x(stateIndex) + jitter}" cy="${y(row.memoryMb)}" r="3" fill="${trialColors[trialIndex % trialColors.length]}" opacity="0.24"/>`);
}

for (const trial of trials) {
  const values = trialAverages.get(trial);
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const trialColor = trialColors[trials.indexOf(trial) % trialColors.length];
  parts.push(`<polyline points="${points}" fill="none" stroke="${trialColor}" stroke-width="2" stroke-dasharray="6 7" opacity="0.72"/>`);
  values.forEach((value, index) => parts.push(`<circle cx="${x(index)}" cy="${y(value)}" r="3.5" fill="#F8FAFC" stroke="${trialColor}" stroke-width="2"/>`));
}

const overallPoints = overallAverages.map((value, index) => `${x(index)},${y(value)}`).join(' ');
parts.push(`<polyline points="${overallPoints}" fill="none" stroke="#2563EB" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`);
overallAverages.forEach((value, index) => {
  parts.push(`<circle cx="${x(index)}" cy="${y(value)}" r="7" fill="#FFFFFF" stroke="#2563EB" stroke-width="4"/>`);
  parts.push(`<rect x="${x(index) - 31}" y="${y(value) - 38}" width="62" height="24" rx="12" fill="#DBEAFE"/>`);
  parts.push(`<text x="${x(index)}" y="${y(value) - 21}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="#1D4ED8">${value.toFixed(1)}</text>`);
});

states.forEach(([, operation, documents], index) => {
  const labelX = x(index);
  const labelY = margin.top + chartHeight + 34;
  parts.push(`<text x="${labelX}" y="${labelY}" text-anchor="middle" font-family="Inter, Arial, sans-serif" fill="#334155"><tspan x="${labelX}" font-size="16" font-weight="650">${escape(operation)}</tspan><tspan x="${labelX}" dy="23" font-size="14" fill="#64748B">${escape(documents)}</tspan></text>`);
});

const legendY = height - 78;
parts.push(`<line x1="105" y1="${legendY}" x2="145" y2="${legendY}" stroke="#2563EB" stroke-width="5"/><text x="155" y="${legendY + 5}" font-family="Inter, Arial, sans-serif" font-size="14" fill="#334155">Overall average</text>`);
trials.forEach((trial, index) => {
  const legendX = 305 + (index % 5) * 130;
  const trialLegendY = legendY + Math.floor(index / 5) * 30;
  parts.push(`<line x1="${legendX}" y1="${trialLegendY}" x2="${legendX + 32}" y2="${trialLegendY}" stroke="${trialColors[index % trialColors.length]}" stroke-width="2" stroke-dasharray="6 7"/><text x="${legendX + 42}" y="${trialLegendY + 5}" font-family="Inter, Arial, sans-serif" font-size="14" fill="#475569">Trial ${trial}</text>`);
});
parts.push(`<circle cx="1000" cy="${legendY}" r="4" fill="#64748B" opacity="0.35"/><text x="1014" y="${legendY + 5}" font-family="Inter, Arial, sans-serif" font-size="14" fill="#475569">Idle samples</text>`);
parts.push(`<text x="${width - 80}" y="${legendY + 35}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="13" fill="#64748B">RSS varies with garbage collection and macOS memory reclamation</text>`);
parts.push('</svg>');

await fs.writeFile(outputPath, parts.join('\n'));
console.log(outputPath);
