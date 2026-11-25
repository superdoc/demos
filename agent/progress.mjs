// Translate provider lifecycle/output events into short, host-owned status messages.
// Never surface reasoning text, partial source, or provider errors to the browser.
export async function readGenerationResponse(response, onProgress, onText) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  let buffer = '', data = [], output = '';
  function consume() {
    if (!data.length) return;
    const payload = data.join('\n');
    data = [];
    if (payload === '[DONE]') return;
    const event = JSON.parse(payload);
    if (event.type === 'response.created' || event.type === 'response.in_progress'
      || (event.type === 'response.output_item.added' && event.item?.type === 'reasoning')) {
      onProgress?.('Planning your demo…');
    }
    if (event.type === 'response.output_text.delta') {
      output += event.delta;
      if (output.length > 1024 * 1024) throw new Error('Generation output exceeds the limit');
      onText?.(output);
      const stage = /"guidance"\s*:/.test(output) ? 'Adding setup instructions and agent guidance…'
        : /"css"\s*:/.test(output) ? 'Styling your demo…'
        : /"javascript"\s*:/.test(output) ? 'Writing your demo’s interactions…'
        : 'Outlining your demo…';
      onProgress?.(stage);
    }
    if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) return event.response;
    if (event.type === 'error') {
      const error = new Error('Generation stream failed');
      error.providerCode = event.code || event.error?.code;
      throw error;
    }
  }
  for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += text;
    if (buffer.length > 1024 * 1024) throw new Error('Generation event exceeds the limit');
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      else if (!line) {
        const result = consume();
        if (result) return result;
      }
    }
  }
  // Never publish a partial project if the stream disconnects before a terminal event.
  throw new Error('Generation stream ended before completion');
}
