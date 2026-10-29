import { streamTextTool } from '../tools/stream-text-tool.js';

// The streamed tool has flat scalar arguments. Read only complete metadata and
// a safely decoded prefix of text; incomplete escapes stay buffered.
export function partialTextArguments(source) {
  let index = 0;
  const skip = () => { while (/\s/.test(source[index] ?? '') && index < source.length) index++; };
  function string() {
    if (source[index++] !== '"') throw new Error('Expected a JSON string.');
    let value = '';
    while (index < source.length) {
      const char = source[index++];
      if (char === '"') return { value, complete: true };
      if (char === '\\') {
        if (index >= source.length) return { value, complete: false };
        const escape = source[index++];
        if (escape === 'u') {
          if (source.length - index < 4) return { value, complete: false };
          value += JSON.parse(`"\\u${source.slice(index, index + 4)}"`);
          index += 4;
        } else value += JSON.parse(`"\\${escape}"`);
      } else {
        if (char.charCodeAt(0) < 32) throw new Error('Invalid JSON string.');
        value += char;
      }
    }
    // Avoid publishing half of a UTF-16 surrogate pair.
    if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
    return { value, complete: false };
  }
  try {
    skip();
    if (source[index++] !== '{') return;
    const result = {};
    while (index < source.length) {
      skip();
      const key = string();
      if (!key.complete || !['mode', 'anchor', 'text'].includes(key.value) || key.value in result) return;
      skip();
      if (source[index++] !== ':') return;
      skip();
      let parsed;
      if (source[index] === '"') parsed = string();
      else if (source.slice(index, index + 4) === 'null') { parsed = { value: null, complete: true }; index += 4; }
      else return;
      result[key.value] = !parsed.complete && typeof parsed.value === 'string' ? parsed.value.replace(/[\uD800-\uDBFF]$/, '') : parsed.value;
      if (key.value === 'text') return typeof result.mode === 'string' && 'anchor' in result ? result : undefined;
      if (!parsed.complete) return;
      skip();
      if (source[index++] !== ',') return;
    }
  } catch { /* Wait for complete JSON; final validation reports malformed calls. */ }
}

export async function streamCompletion(client, request, { signal, document, changeMode, onTextDelta, onToolCall, streamTextEnabled = true }) {
  const stream = await client.chat.completions.create({ ...request, stream: true, parallel_tool_calls: false }, { signal });
  const calls = new Map();
  let content = '';
  let finishReason;
  try {
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
          call = { id: '', type: 'function', function: { name: '', arguments: '' }, startedAt: new Date().toISOString(), lastLength: 0, lastUpdate: 0 };
          calls.set(delta.index, call);
        }
        if (delta.id) call.id += delta.id;
        if (delta.function?.name) call.function.name += delta.function.name;
        if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
        if (call.id && call.function.name && !call.announced) {
          onToolCall({ id: call.id, tool: call.function.name, status: 'generating', startedAt: call.startedAt });
          call.announced = true;
        }
        if (streamTextEnabled && call.function.name === streamTextTool.function.name) {
          const args = partialTextArguments(call.function.arguments);
          if (args?.text && (args.text.length - call.lastLength >= 24 || Date.now() - call.lastUpdate >= 80)) {
            call.writer ??= document.createTextStream({ tag: call.id, changeMode, signal });
            await call.writer.update(args);
            call.lastLength = args.text.length;
            call.lastUpdate = Date.now();
          }
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
      writers: new Map(ordered.filter((call) => call.writer).map((call) => [call.id, call.writer])),
    };
  } catch (error) {
    if ([...calls.values()].some((call) => call.writer)) {
      error.message += ' Text already streamed into the document remains applied.';
    }
    throw error;
  }
}
