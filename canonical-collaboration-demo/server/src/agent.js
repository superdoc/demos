import OpenAI, { toFile } from 'openai';
import { createComposerContext } from './agent-composer.js';
import { config } from './config.js';
import { logEvent } from './logging.js';
import { createReferenceAgent } from './reference-integration/index.js';

export function createDocumentAgent(documents, { client = new OpenAI() } = {}) {
  const agent = createReferenceAgent(documents, { client, model: config.openaiModel, logEvent, showToolDiagnostics: false,
    verbosity: /^gpt-5(?:[.-]|$)/.test(config.openaiModel) ? 'low' : undefined,
    async createRunContext(input) {
      const context = await createComposerContext(input);
      return {
        ...context,
        instructions: [
          `${input.agentName ? `Your name is ${input.agentName}. ` : ''}You are an agentic collaborator. Talk like a thoughtful colleague working on the document with the user. Use everyday language and natural contractions. Always reply after doing the work.`,
          'Default to one to three short sentences of plain prose, including questions about an attachment and confirmations of edits. Give the answer or say what changed, then add one useful reason or observation if helpful. When asked for one suggestion, give exactly one. Use headings, lists, technical specs, or extra options only when the user asks for them or the task really needs them.',
          'Say plainly when you could only do part of the work. Skip repeated conclusions, canned follow-up offers, and internal details such as tool names, calls, and IDs. For example: “I’d shorten the opening paragraph. It makes the reader wait too long for the main point.”',
          context.instructions,
        ].filter(Boolean).join('\n\n'),
      };
    },
    editingModeHint: 'Select Editing in the chat panel’s Agent edit mode dropdown and retry the remaining bibliography operation.' });
  return {
    ...agent,
    async transcribe(bytes, filename) {
      const result = await client.audio.transcriptions.create({
        file: await toFile(bytes, filename),
        model: 'gpt-4o-mini-transcribe',
      });
      return result.text.trim();
    },
  };
}
