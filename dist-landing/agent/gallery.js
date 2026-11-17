const form = document.querySelector('#agent-form');
const input = document.querySelector('#agent-prompt');
const result = document.querySelector('#agent-result');
const submit = form.querySelector('button');
let offer = null;
let conversation = [];

function paragraph(text, className) {
  const element = document.createElement('p');
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function chatMessage(name, text, className) {
  const element = paragraph('', className);
  const speaker = document.createElement('span');
  speaker.className = name === 'You' ? 'you-speaker' : 'moe-speaker';
  speaker.textContent = name;
  element.append(speaker, document.createTextNode(` ${text}`));
  return element;
}
function moeMessage(text, className) {
  return chatMessage('Moe', text, className);
}
function addMessage(name, text) {
  const card = document.createElement('div');
  card.className = 'agent-message';
  card.append(chatMessage(name, text));
  result.prepend(card);
  return card;
}
async function post(url, body, onAcknowledgement) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(onAcknowledgement ? { Accept: 'application/x-ndjson' } : {}) }, body: JSON.stringify(body) });
  if (response.ok && response.headers.get('content-type')?.includes('application/x-ndjson')) {
    let buffer = '', result;
    for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
      buffer += text;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'acknowledgement') onAcknowledgement?.(event.message);
        if (event.type === 'error') throw new Error(event.data.error || 'The agent is unavailable. Please try again.');
        if (event.type === 'result') result = event.data;
      }
    }
    if (!result) throw new Error('The connection ended before Moe finished replying. Please try again.');
    return result;
  }
  const data = await response.json().catch(() => ({ error: 'The agent is unavailable. Please try again.' }));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function showError(error) {
  addMessage('Moe', error.message).dataset.error = '';
}
input.addEventListener('input', () => {
  form.toggleAttribute('data-expanded', Boolean(input.value));
  offer = null;
  result.querySelector('button.agent-build')?.remove();
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  if (event.key === 'Escape') input.blur();
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = input.value.trim();
  if (!prompt || submit.disabled) return;
  offer = null;
  result.querySelector('button.agent-build')?.remove();
  submit.disabled = true;
  input.readOnly = true;
  result.setAttribute('aria-busy', 'true');
  addMessage('You', prompt);
  const pending = addMessage('Moe', 'Thinking...');
  pending.classList.add('agent-status');
  let acknowledged = false;
  let replied = false;
  try {
    const data = await post('/agent/api/search', { prompt, history: conversation }, (message) => {
      pending.replaceChildren(moeMessage(message));
      acknowledged = true;
    });
    const answer = addMessage('Moe', data.message);
    conversation = [...conversation, { role: 'user', content: prompt.slice(0, 600) }, { role: 'assistant', content: data.message.slice(0, 600) }].slice(-4);
    input.value = '';
    form.removeAttribute('data-expanded');
    replied = true;
    for (const match of data.matches) {
      const link = document.createElement('a');
      link.className = 'agent-match';
      link.href = match.liveDemoUri;
      const title = document.createElement('strong');
      title.textContent = `${match.title} ↗`;
      link.append(title, document.createTextNode(match.reason));
      answer.append(link);
    }
    offer = data.offer;
    if (offer) {
      const build = document.createElement('button');
      build.type = 'button'; build.className = 'agent-build'; build.textContent = 'Build this demo ↗';
      build.addEventListener('click', async () => {
        if (build.disabled || !offer) return;
        // Open on the click, before async work, to avoid popup blockers.
        const preview = window.open('about:blank', '_blank');
        if (preview) { preview.opener = null; preview.document.title = 'Preparing your demo'; preview.document.body.textContent = 'Preparing your SuperDoc demo…'; }
        build.disabled = true; build.textContent = 'Starting your demo…';
        try {
          const project = await post('/agent/api/projects', { offer });
          offer = null;
          if (preview && !preview.closed) preview.location.replace(project.url);
          build.remove();
          const link = document.createElement('a');
          link.href = project.url; link.target = '_blank'; link.rel = 'noopener'; link.className = 'agent-build'; link.textContent = 'Open your demo ↗';
          addMessage('Moe', 'Your demo is building. Its one-hour lifetime starts when it is ready.').append(link);
        } catch (error) { preview?.close(); showError(error); }
      });
      answer.append(build, paragraph('One focused feature · 64 KB code limit · One-hour preview · Downloadable source + agent guidance', 'agent-limits'));
    }
  } catch (error) { showError(error); }
  finally {
    submit.disabled = false;
    input.readOnly = false;
    result.setAttribute('aria-busy', 'false');
    if (!acknowledged) pending.replaceChildren(moeMessage(replied ? 'Finished preparing the reply.' : 'The request could not be completed.'));
    if (replied && (document.activeElement === submit || document.activeElement === input)) input.focus();
  }
});
