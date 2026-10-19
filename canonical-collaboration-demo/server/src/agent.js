import OpenAI from 'openai';
import { config } from './config.js';
import { logEvent } from './logging.js';
import { createReferenceAgent } from './reference-integration/index.js';

export function createDocumentAgent(documents, { client = new OpenAI() } = {}) {
  return createReferenceAgent(documents, { client, model: config.openaiModel, logEvent,
    editingModeHint: 'Select Editing in the chat panel’s Agent edit mode dropdown and retry the remaining bibliography operation.' });
}
