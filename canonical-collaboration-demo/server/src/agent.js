import OpenAI, { toFile } from 'openai';
import { createComposerContext } from './agent-composer.js';
import { createResponsesChatClient } from './agent-responses.js';
import { synthesizeAgentSpeech } from './agent-speech.js';
import { config } from './config.js';
import { logEvent } from './logging.js';
import { createReusablePromptContext } from './reusable-prompt.js';
import { createReferenceAgent } from './reference-integration/index.js';

export function createDocumentAgent(documents, { client = new OpenAI(), model = config.openaiModel } = {}) {
  const usesResponses = /^gpt-5\.5(?:-|$)/.test(model);
  const agent = createReferenceAgent(documents, {
    client: usesResponses ? createResponsesChatClient(client) : client,
    model, logEvent, showToolDiagnostics: false,
    reasoningEffort: usesResponses ? 'medium' : 'low',
    verbosity: /^gpt-5(?:[.-]|$)/.test(model) ? 'low' : undefined,
    async createRunContext(input) {
      if (input.reusablePrompt) return createReusablePromptContext(input.document);
      const context = await createComposerContext(input);
      return {
        ...context,
        instructions: [
          `${input.agentName ? `Your name is ${input.agentName}. ` : ''}You are an agentic collaborator. Talk like a thoughtful colleague working on the document with the user. Use everyday language and natural contractions. Always reply after doing the work.`,
          'Apply requests to write, draft, add, or revise content directly to the current document by default. For example, “write a paragraph about X” means insert the paragraph in the document, even without an explicit placement or mention of the document. A specific request to change current content can be phrased as “can you” or “let’s.” Use the document tools to make the requested change, then briefly confirm it in chat. Keep drafts in chat when explicitly requested, and answer questions and give feedback in chat when the user is asking for advice without an edit.',
          'Read follow-up requests in context. If you just confirmed that you applied formatting throughout the document and the user repeats that rule (“make sure you do that for every mention”), acknowledge it as guidance for future edits. Do not repeat the edit or claim that you changed anything on this turn. Carry the rule forward in this chat and apply it to new or changed text when the next request calls for an edit.',
          'When the user asks to check or verify existing formatting, inspect it and report what you find. Apply a change to existing text when the user asks to correct it, adds a new target, or gives a new formatting instruction for current text. Skip occurrences that already match the requested formatting.',
          'Default to one to three short sentences of plain prose, including questions about an attachment and confirmations of edits. Give the answer or say what changed, then add one useful reason or observation if helpful. When asked for one suggestion, give exactly one. Use headings, lists, technical specs, or extra options only when the user asks for them or the task really needs them.',
          'Say plainly when you could only do part of the work. Skip repeated conclusions, canned follow-up offers, and internal details such as tool names, calls, and IDs. For example: “I’d shorten the opening paragraph. It makes the reader wait too long for the main point.”',
          'Use tools silently. Skip opening acknowledgments and progress narration. Reply when you have the answer, can report what changed, or need clarification.',
          context.instructions,
        ].filter(Boolean).join('\n\n'),
      };
    },
    editingModeHint: 'Select “Agent is editing” in the chat panel and retry the remaining bibliography operation.' });
  return {
    ...agent,
    synthesize(text, signal) {
      return synthesizeAgentSpeech(client, text, signal);
    },
    async transcribe(bytes, filename) {
      const result = await client.audio.transcriptions.create({
        file: await toFile(bytes, filename),
        model: 'gpt-4o-mini-transcribe',
      });
      return result.text.trim();
    },
  };
}
