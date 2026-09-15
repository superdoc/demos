export default {
  trials: 10,
  samplesPerState: 6,
  sampleIntervalMs: 1_000,
  settleMs: 3_000,
  startupWarmupMs: 10_000,
  port: 18_000,
  operations: [
    { phase: 'baseline_0', label: 'Baseline', documents: 0, action: 'sample' },
    { phase: 'open_1', label: 'Open 1', documents: 1, action: 'open', slot: 1 },
    { phase: 'open_2', label: 'Open 2', documents: 2, action: 'open', slot: 2 },
    { phase: 'open_3', label: 'Open 3', documents: 3, action: 'open', slot: 3 },
    { phase: 'close_to_2', label: 'Close', documents: 2, action: 'close', slot: 3 },
    { phase: 'close_to_1', label: 'Close', documents: 1, action: 'close', slot: 2 },
    { phase: 'close_to_0', label: 'Close', documents: 0, action: 'close', slot: 1 },
  ],
};
