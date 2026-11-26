import { streamTextInput, streamTextTool } from '../tools/stream-text-tool.js';
import { setTimeout as delay } from 'node:timers/promises';

const charactersPerUpdate = 5;
const updateIntervalMs = 50;

// Consume model output independently from the serialized document writes.
function bufferUpdates(writer, signal) {
  let latest;
  let written = 0;
  let running;
  let failure;
  let stopped = false;
  let lastWrite = 0;

  async function pump() {
    while (!stopped && latest && written < Array.from(latest.text).length) {
      signal.throwIfAborted();
      const wait = updateIntervalMs - (Date.now() - lastWrite);
      if (lastWrite && wait > 0) await delay(wait, undefined, { signal });
      if (stopped) break;
      const characters = Array.from(latest.text);
      const end = Math.min(written + charactersPerUpdate, characters.length);
      await writer.update({ ...latest, text: characters.slice(0, end).join('') });
      written = end;
      lastWrite = Date.now();
    }
  }

  function start() {
    if (!running && !failure && !stopped) {
      running = pump().catch((error) => { failure = error; }).finally(() => {
        running = undefined;
        if (!stopped && !failure && latest && written < Array.from(latest.text).length) start();
      });
    }
  }

  return {
    push(args) { latest = args; start(); },
    async drain() {
      while (running) await running;
      signal.throwIfAborted();
      if (failure) throw failure;
    },
    async stop() { stopped = true; await this.drain(); },
  };
}

// Read complete target metadata before publishing a safely decoded text prefix.
// Older calls without a story can still commit after all arguments are available.
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
  function story() {
    const start = index++;
    while (index < source.length) {
      if (source[index] === '"') {
        if (!string().complete) return;
      } else if (source[index++] === '}') {
        return { value: JSON.parse(source.slice(start, index)), complete: true };
      }
    }
  }
  try {
    skip();
    if (source[index++] !== '{') return;
    const result = {};
    while (index < source.length) {
      skip();
      const key = string();
      if (!key.complete || !['mode', 'anchor', 'story', 'text'].includes(key.value) || key.value in result) return;
      skip();
      if (source[index++] !== ':') return;
      skip();
      let parsed;
      if (source[index] === '"') parsed = string();
      else if (source.slice(index, index + 4) === 'null') { parsed = { value: null, complete: true }; index += 4; }
      else if (key.value === 'story' && source[index] === '{') parsed = story();
      else return;
      if (!parsed) return;
      result[key.value] = !parsed.complete && typeof parsed.value === 'string' ? parsed.value.replace(/[\uD800-\uDBFF]$/, '') : parsed.value;
      if (key.value === 'text') return 'story' in result ? streamTextInput(result) : undefined;
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
        if (streamTextEnabled && call.function.name === streamTextTool.function.name) {
          const args = partialTextArguments(call.function.arguments);
          if (args?.text) {
            call.writer ??= document.createTextStream({ tag: call.id, changeMode, signal });
            call.buffer ??= bufferUpdates(call.writer, signal);
            call.buffer.push(args);
          }
        }
      }
    }
    signal.throwIfAborted();
    if (!['stop', 'tool_calls'].includes(finishReason)) throw new Error(`OpenAI stream ended before completion (${finishReason ?? 'disconnected'}).`);
    const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (ordered.some((call) => !call.id || !call.function.name)) throw new Error('Incomplete OpenAI tool identity.');
    if ((ordered.length > 0) !== (finishReason === 'tool_calls')) throw new Error('Incomplete OpenAI tool-call stream.');
    await Promise.all(ordered.map((call) => call.buffer?.drain()));
    signal.throwIfAborted();
    return {
      choice: { role: 'assistant', content: content || null, ...(ordered.length ? { tool_calls: ordered.map(({ id, type, function: fn }) => ({ id, type, function: fn })) } : {}) },
      writers: new Map(ordered.filter((call) => call.writer).map((call) => [call.id, call.writer])),
    };
  } catch (error) {
    await Promise.allSettled([...calls.values()].map((call) => call.buffer?.stop()));
    if ([...calls.values()].some((call) => call.writer)) {
      error.message += ' Text already streamed into the document remains applied.';
    }
    throw error;
  }
}
