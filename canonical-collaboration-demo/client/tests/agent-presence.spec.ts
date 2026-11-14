import fs from 'node:fs/promises';
import { test } from '@playwright/test';
import checkAgentPresence from '../../tests/agent-presence.browser.mjs';

test('agent cursor follows streamed edits for two collaborators and leaves on deletion', async ({ browser }, testInfo) => {
  const artifacts = testInfo.outputPath('agent-presence');
  await fs.mkdir(artifacts, { recursive: true });
  await checkAgentPresence({ browser, artifacts });
});
