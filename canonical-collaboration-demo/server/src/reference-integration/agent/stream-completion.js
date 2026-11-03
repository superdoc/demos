export async function streamCompletion(client, request, { signal, onTextDelta, onToolCall }) {
  const stream = await client.chat.completions.create({ ...request, stream: true, parallel_tool_calls: false }, { signal });
  const calls = new Map();
  let content = '';
  let finishReason;
  for await (const chunk of stream) {
    signal.throwIfAborted();
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    if (choice.delta?.content) {
      content += choice.delta.content;
      onTextDelta(choice.delta.content);
    }
    for (const delta of choice.delta?.tool_calls ?? []) {
      let call = calls.get(delta.index);
      if (!call) {
        call = { id: '', type: 'function', function: { name: '', arguments: '' }, startedAt: new Date().toISOString() };
        calls.set(delta.index, call);
      }
      if (delta.id) call.id += delta.id;
      if (delta.function?.name) call.function.name += delta.function.name;
      if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
      if (call.id && call.function.name && !call.announced) {
        onToolCall({ id: call.id, tool: call.function.name, status: 'generating', startedAt: call.startedAt });
        call.announced = true;
      }
    }
  }
  signal.throwIfAborted();
  if (!['stop', 'tool_calls'].includes(finishReason)) throw new Error(`OpenAI stream ended before completion (${finishReason ?? 'disconnected'}).`);
  const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (ordered.some((call) => !call.id || !call.function.name)) throw new Error('Incomplete OpenAI tool identity.');
  if ((ordered.length > 0) !== (finishReason === 'tool_calls')) throw new Error('Incomplete OpenAI tool-call stream.');
  return {
    choice: { role: 'assistant', content: content || null, ...(ordered.length ? { tool_calls: ordered.map(({ id, type, function: fn }) => ({ id, type, function: fn })) } : {}) },
  };
}
