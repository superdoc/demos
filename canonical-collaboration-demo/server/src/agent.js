import OpenAI from 'openai';
import { config } from './config.js';
import { logEvent } from './logging.js';

const maximumTurns = 12;

export function createDocumentAgent(documents) {
  const openai = new OpenAI();
  const toolkit = documents.getToolkit();

  async function run(document, prompt, history, isSuggesting, signal, { onToolCall = () => {}, messageId } = {}) {
    const changeMode = isSuggesting ? 'tracked' : 'direct';
    const messages = [
      {
        role: 'system',
        content: `${toolkit.systemPrompt}\n\nFor this request, every document mutation must use changeMode=${changeMode}. Choose actions that support this change mode.`,
      },
      ...history.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: prompt },
    ];
    let fullOutput = '';
    const toolCalls = [];
    function saveAnswer(answer) {
      history.push({ role: 'user', content: prompt }, {
        id: messageId, role: 'assistant', content: answer, toolCalls: toolCalls.map((call) => ({ ...call })),
      });
      return answer;
    }
    logEvent('agent', 'run.started', { changeMode, historyMessages: history.length });

    for (let turn = 1; turn <= maximumTurns; turn += 1) {
      const modelStarted = performance.now();
      const response = await openai.chat.completions.create(
        { model: config.openaiModel, messages, tools: toolkit.tools },
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
        logEvent('agent', 'run.completed', { turns: turn, changeMode });
        return saveAnswer(answer);
      }

      messages.push(choice);
      for (const call of choice.tool_calls) {
        if (signal.aborted) throw signal.reason;
        const started = performance.now();
        let args = {};
        let result;
        const toolCall = {
          id: call.id,
          tool: call.function.name,
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        toolCalls.push(toolCall);
        try {
          args = JSON.parse(call.function.arguments || '{}');
          if (typeof args.action === 'string') toolCall.action = args.action;
          onToolCall({ ...toolCall });
          if (call.function.name === 'superdoc_perform_action') args.changeMode = changeMode;
          result = await document.dispatch(call.function.name, args);
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        toolCall.durationMs = Math.round(performance.now() - started);
        toolCall.status = result?.ok === false || result?.success === false || result?.result?.success === false
          || result?.status === 'failed' || Boolean(result?.error) ? 'failed' : 'completed';
        onToolCall({ ...toolCall });
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
    logEvent('agent', 'run.turn_limit', { turns: maximumTurns, changeMode });
    return saveAnswer(answer);
  }

  return { run };
}
