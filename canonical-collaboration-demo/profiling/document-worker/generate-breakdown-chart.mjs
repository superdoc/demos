import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './profile.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inputPath = process.argv[2] ?? path.join(root, 'profiling/document-worker/results/memory-trials.csv');
const outputPath = process.argv[3] ?? path.join(root, 'profiling/document-worker/results/memory-by-state.svg');
const lines = (await fs.readFile(inputPath, 'utf8')).trim().split(/\r?\n/);
const headers = lines[0].split(',');
const column = (name) => headers.indexOf(name);
const rows = lines.slice(1).map((line) => {
  const values = line.split(',');
  return {
    trial: Number(values[column('trial')]),
    phase: values[column('phase')],
    documents: Number(values[column('documents')]),
    sample: Number(values[column('sample')]),
    worker: Number(values[column('worker_rss_mb')]),
    runtime: Number(values[column('runtime_rss_mb')]),
    total: Number(values[column('total_rss_mb')]),
  };
});

const states = config.operations.map((operation) => [
  operation.phase,
  operation.label,
  `${operation.documents} ${operation.documents === 1 ? 'doc' : 'docs'}`,
]);
const metrics = [
  ['total', 'Total RSS', 'Worker + runtime'],
  ['worker', 'Worker RSS', 'Node document-worker process'],
  ['runtime', 'Runtime RSS', 'SuperDoc runtime descendants'],
];
const colors = [
  '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0D9488',
  '#0891B2', '#2563EB', '#7C3AED', '#C026D3', '#DB2777',
];
const trials = [...new Set(rows.map((row) => row.trial))].sort((a, b) => a - b);
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const width = 1400;
const height = 1220;
const margin = { left: 110, right: 70, top: 145, bottom: 145 };
const panelGap = 55;
const panelHeight = (height - margin.top - margin.bottom - panelGap * 2) / 3;
const chartWidth = width - margin.left - margin.right;
const x = (index) => margin.left + (chartWidth * index) / (states.length - 1);
const parts = [];

parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
parts.push('<rect width="100%" height="100%" fill="#F8FAFC"/>');
parts.push('<text x="110" y="58" font-family="Inter,Arial,sans-serif" font-size="32" font-weight="700" fill="#172033">Document worker memory breakdown by collaboration state</text>');
parts.push(`<text x="110" y="94" font-family="Inter,Arial,sans-serif" font-size="17" fill="#64748B">${trials.length} fresh-process trials · 6 idle samples per state · each panel uses its own labeled scale</text>`);

metrics.forEach(([metric, title, subtitle], panelIndex) => {
  const panelTop = margin.top + panelIndex * (panelHeight + panelGap);
  const values = rows.map((row) => row[metric]);
  const yMin = Math.max(0, Math.floor((Math.min(...values) - 10) / 25) * 25);
  const yMax = Math.ceil((Math.max(...values) + 10) / 25) * 25;
  const y = (value) => panelTop + panelHeight * (1 - (value - yMin) / (yMax - yMin));

  for (let tick = yMin; tick <= yMax; tick += 25) {
    const tickY = y(tick);
    parts.push(`<line x1="${margin.left}" y1="${tickY}" x2="${width - margin.right}" y2="${tickY}" stroke="${tick % 50 === 0 ? '#CBD5E1' : '#E8EDF3'}"/>`);
    if (tick % 50 === 0) parts.push(`<text x="${margin.left - 15}" y="${tickY + 5}" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="13" fill="#64748B">${tick}</text>`);
  }
  parts.push(`<text x="${margin.left}" y="${panelTop - 18}" font-family="Inter,Arial,sans-serif" font-size="19" font-weight="700" fill="#334155">${title}<tspan dx="10" font-size="13" font-weight="400" fill="#64748B">${subtitle}</tspan></text>`);

  for (const row of rows) {
    const stateIndex = states.findIndex(([phase]) => phase === row.phase);
    const trialIndex = trials.indexOf(row.trial);
    const jitter = (row.sample - 3.5) * 2 + (trialIndex - (trials.length - 1) / 2) * 1.5;
    parts.push(`<circle cx="${x(stateIndex) + jitter}" cy="${y(row[metric])}" r="2.2" fill="${colors[trialIndex]}" opacity="0.18"/>`);
  }

  trials.forEach((trial, trialIndex) => {
    const trialValues = states.map(([phase]) => average(rows.filter((row) => row.trial === trial && row.phase === phase).map((row) => row[metric])));
    parts.push(`<polyline points="${trialValues.map((value, index) => `${x(index)},${y(value)}`).join(' ')}" fill="none" stroke="${colors[trialIndex]}" stroke-width="1.7" stroke-dasharray="5 6" opacity="0.7"/>`);
  });

  const overall = states.map(([phase]) => average(rows.filter((row) => row.phase === phase).map((row) => row[metric])));
  parts.push(`<polyline points="${overall.map((value, index) => `${x(index)},${y(value)}`).join(' ')}" fill="none" stroke="#172033" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
  overall.forEach((value, index) => {
    parts.push(`<circle cx="${x(index)}" cy="${y(value)}" r="5" fill="#F8FAFC" stroke="#172033" stroke-width="3"/>`);
    parts.push(`<text x="${x(index)}" y="${y(value) - 10}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="11" font-weight="700" fill="#172033">${value.toFixed(1)}</text>`);
  });
});

states.forEach(([, operation, documents], index) => {
  const labelX = x(index);
  parts.push(`<text x="${labelX}" y="${height - 105}" text-anchor="middle" font-family="Inter,Arial,sans-serif" fill="#334155"><tspan x="${labelX}" font-size="15" font-weight="700">${operation}</tspan><tspan x="${labelX}" dy="20" font-size="13" fill="#64748B">${documents}</tspan></text>`);
});

trials.forEach((trial, index) => {
  const legendX = 110 + index * 103;
  parts.push(`<line x1="${legendX}" y1="${height - 42}" x2="${legendX + 24}" y2="${height - 42}" stroke="${colors[index]}" stroke-width="2" stroke-dasharray="5 5"/><text x="${legendX + 30}" y="${height - 37}" font-family="Inter,Arial,sans-serif" font-size="12" fill="#475569">T${trial}</text>`);
});
parts.push(`<line x1="1160" y1="${height - 42}" x2="1190" y2="${height - 42}" stroke="#172033" stroke-width="4"/><text x="1200" y="${height - 37}" font-family="Inter,Arial,sans-serif" font-size="12" fill="#334155">Average</text>`);
parts.push('</svg>');

await fs.writeFile(outputPath, parts.join('\n'));
console.log(outputPath);
