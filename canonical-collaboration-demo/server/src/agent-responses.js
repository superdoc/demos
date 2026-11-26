function toInput(message, toolTurns) {
  if (message.role === 'tool') {
    return { type: 'function_call_output', call_id: message.tool_call_id, output: message.content };
  }
  if (message.tool_calls?.length) {
    const turn = toolTurns.get(message.tool_calls[0].id);
    if (!turn) throw new Error('OpenAI tool context is missing for the next response.');
    return turn;
  }
  const content = Array.isArray(message.content)
    ? message.content.map((part) => part.type === 'image_url'
      ? { type: 'input_image', image_url: part.image_url.url, detail: part.image_url.detail ?? 'auto' }
      : { type: 'input_text', text: part.text })
    : message.content;
  return { role: message.role, content };
}

function chunk(delta, finishReason = null) {
  return { choices: [{ delta, finish_reason: finishReason }] };
}

function toolChunk(index, call, args) {
  return chunk({ tool_calls: [{
    index,
    ...(call && { id: call.call_id, type: 'function' }),
    function: { ...(call && { name: call.name }), arguments: args },
  }] });
}

async function* completionChunks(events, toolTurns) {
  const streamedArguments = new Map();
  const commentary = new Set();
  for await (const event of events) {
    const { item, output_index: index } = event;
    switch (event.type) {
      case 'response.output_item.added':
        if (item.type === 'message' && item.phase === 'commentary') commentary.add(index);
        if (item.type === 'function_call') {
          const args = item.arguments ?? '';
          streamedArguments.set(index, args);
          yield toolChunk(index, item, args);
        }
        break;
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        if (!commentary.has(index)) yield chunk({ content: event.delta });
        break;
      case 'response.function_call_arguments.delta':
        streamedArguments.set(index, (streamedArguments.get(index) ?? '') + event.delta);
        yield toolChunk(index, undefined, event.delta);
        break;
      case 'response.output_item.done':
        if (item.type === 'function_call') {
          const prefix = streamedArguments.get(index);
          if (prefix === undefined) {
            yield toolChunk(index, item, item.arguments);
          } else {
            if (!item.arguments.startsWith(prefix)) throw new Error('OpenAI tool arguments changed after streaming.');
            const remaining = item.arguments.slice(prefix.length);
            if (remaining) yield toolChunk(index, undefined, remaining);
          }
        }
        break;
      case 'response.completed': {
        const output = event.response.output;
        const firstCall = output.find((entry) => entry.type === 'function_call');
        if (firstCall) toolTurns.set(firstCall.call_id, output);
        yield chunk({}, firstCall ? 'tool_calls' : 'stop');
        return;
      }
      case 'response.failed':
      case 'response.incomplete':
      case 'error':
        throw new Error(event.message ?? event.response?.error?.message ??
          `OpenAI response ended before completion (${event.response?.incomplete_details?.reason ?? event.type}).`);
      default:
        break;
    }
  }
}

// Adapt Responses events to the document runner's existing streamed tool contract.
export function createResponsesChatClient(client) {
  const jobs = new WeakMap();
  return { chat: { completions: { async create(request, { signal }) {
    const { messages, tools, tool_choice: choice, model, reasoning_effort: effort, verbosity } = request;
    let toolTurns = jobs.get(messages);
    if (!toolTurns) {
      toolTurns = new Map();
      jobs.set(messages, toolTurns);
    }
    const events = await client.responses.create({
      model,
      input: messages.flatMap((message) => toInput(message, toolTurns)),
      tools: tools.map(({ type, function: tool }) => ({ type, ...tool, strict: tool.strict ?? false })),
      ...(choice && { tool_choice: { type: choice.type, name: choice.function.name } }),
      ...(verbosity && { text: { verbosity } }),
      reasoning: { effort },
      include: ['reasoning.encrypted_content'],
      parallel_tool_calls: false,
      store: false,
      stream: true,
    }, { signal });
    return completionChunks(events, toolTurns);
  } } } };
}
