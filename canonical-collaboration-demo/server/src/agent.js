import OpenAI from 'openai';
import { config } from './config.js';
import { logEvent } from './logging.js';
import { createAgent } from './reference-integration/agent/create-agent.js';

export function createDocumentAgent(documents, { client = new OpenAI() } = {}) {
  return createAgent(documents, { client, model: config.openaiModel, logEvent });
}
