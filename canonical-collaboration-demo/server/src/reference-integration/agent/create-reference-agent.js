import { createReferenceAgentAdapter } from './reference-agent-adapter.js';
const maximumTurns = 12;

export function createReferenceAgent(documents, { client, model = 'gpt-5-mini', logEvent = () => {}, editingModeHint = 'Select Editing in your application and retry the remaining bibliography operation.' } = {}) {
  if (!client?.chat?.completions?.create) throw new Error('Provide a chat completions client.');
  const openai = client;
  const toolkit = documents.getToolkit();

  async function run(document, prompt, history, isSuggesting, signal, { onToolCall = () => {}, messageId } = {}) {
    const changeMode = isSuggesting ? 'tracked' : 'direct';
    const adapter = await createReferenceAgentAdapter({ document, toolkit, prompt, changeMode, editingModeHint });
    const messages = [
      { role: 'system', content: adapter.systemPrompt },
      ...history.map(({ role, content }) => ({ role, content })),
      adapter.contextMessage,
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
        { model, reasoning_effort: 'low', messages, tools: adapter.tools,
          ...(adapter.initialToolChoice && turn === 1 ? { tool_choice: adapter.initialToolChoice } : {}) },
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
        const toolCall = {
          id: call.id,
          tool: call.function.name,
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        toolCalls.push(toolCall);
        const outcome = await adapter.execute(call.function.name, call.function.arguments, { onStarted(args) {
          if (typeof args.action === 'string') toolCall.action = args.action;
          onToolCall({ ...toolCall });
        } });
        const { args, result } = outcome;
        toolCall.durationMs = Math.round(performance.now() - started);
        toolCall.status = outcome.failed ? 'failed' : 'completed';
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
        if (outcome.stop) {
          logEvent('agent', outcome.stop === 'repeated_failure' ? 'run.repeated_failure' : 'run.completed',
            { turns: turn, changeMode, tool: call.function.name });
          return saveAnswer(outcome.message);
        }
      }
    }

    const answer = adapter.interruptionReport('turn_limit');
    logEvent('agent', 'run.turn_limit', { turns: maximumTurns, changeMode });
    return saveAnswer(answer);
  }

  return { run };
}
