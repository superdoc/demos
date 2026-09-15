import OpenAI from 'openai';
import { config } from './config.js';
import { logEvent } from './diagnostics.js';

const maximumTurns = 12;

export class DocumentAgent {
  #openai = new OpenAI();
  #toolkit;
  #documentWorker;

  constructor(documentWorker) {
    this.#documentWorker = documentWorker;
  }

  async initialize() {
    this.#toolkit = await this.#documentWorker.getToolkit();
  }

  async run(documentId, prompt, history, isSuggesting, signal) {
    const changeMode = isSuggesting ? 'tracked' : 'direct';
    const messages = [
      {
        role: 'system',
        content: `${this.#toolkit.systemPrompt}\n\nFor this request, every document mutation must use changeMode=${changeMode}. Choose actions that support this change mode.`,
      },
      ...history,
      { role: 'user', content: prompt },
    ];
    let fullOutput = '';
    logEvent('agent', 'run.started', { changeMode, historyMessages: history.length });

    for (let turn = 1; turn <= maximumTurns; turn += 1) {
      const modelStarted = performance.now();
      const response = await this.#openai.chat.completions.create(
        { model: config.openaiModel, messages, tools: this.#toolkit.tools },
        { signal },
      );
      const choice = response.choices[0].message;
      logEvent('agent', 'model.completed', {
        turn,
        durationMs: Math.round(performance.now() - modelStarted),
        toolCalls: choice.tool_calls?.length ?? 0,
      });
      if (choice.content) fullOutput += choice.content;
      if (!choice.tool_calls?.length) {
        const answer = fullOutput || 'Document updated.';
        history.push({ role: 'user', content: prompt }, { role: 'assistant', content: answer });
        logEvent('agent', 'run.completed', { turns: turn, changeMode });
        return answer;
      }

      messages.push(choice);
      for (const call of choice.tool_calls) {
        if (signal.aborted) throw signal.reason;
        const started = performance.now();
        let args = {};
        let result;
        try {
          args = JSON.parse(call.function.arguments || '{}');
          if (call.function.name === 'superdoc_perform_action') args.changeMode = changeMode;
          result = await this.#documentWorker.dispatch(documentId, call.function.name, args);
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        logEvent('agent', 'tool.completed', {
          tool: call.function.name,
          action: args.action,
          changeMode,
          durationMs: Math.round(performance.now() - started),
          status: result?.status ?? result?.ok,
          error: result?.error,
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
    }

    const answer = fullOutput || 'The agent reached its turn limit.';
    history.push({ role: 'user', content: prompt }, { role: 'assistant', content: answer });
    logEvent('agent', 'run.turn_limit', { turns: maximumTurns, changeMode });
    return answer;
  }

  dispatch(documentId, tool, args) {
    return this.#documentWorker.dispatch(documentId, tool, args);
  }
}
