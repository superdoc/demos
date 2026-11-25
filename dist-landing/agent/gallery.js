const form = document.querySelector('#agent-form');
const input = document.querySelector('#agent-prompt');
const result = document.querySelector('#agent-result');
const submit = form.querySelector('button');
let offer = null;
let conversation = [];

function resizePrompt() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(216, Math.max(56, input.scrollHeight))}px`;
  input.style.overflowY = input.scrollHeight > 216 ? 'auto' : 'hidden';
}
globalThis.addEventListener?.('resize', resizePrompt);

function paragraph(text, className) {
  const element = document.createElement('p');
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function chatMessage(name, text, className) {
  const element = paragraph('', className);
  const speaker = document.createElement('span');
  speaker.className = name === 'You' ? 'you-speaker' : 'demo-bot-speaker';
  speaker.textContent = name;
  element.append(speaker, document.createTextNode(` ${text}`));
  return element;
}
function botMessage(text, className) {
  return chatMessage('Demo Bot', text, className);
}
function addMessage(name, text) {
  const card = document.createElement('div');
  card.className = 'agent-message';
  card.append(chatMessage(name, text));
  result.prepend(card);
  return card;
}
async function post(url, body, { onAcknowledgement, onProgress } = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(onAcknowledgement || onProgress ? { Accept: 'application/x-ndjson' } : {}) }, body: JSON.stringify(body) });
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
        if (event.type === 'progress') onProgress?.(event);
        if (event.type === 'error') throw new Error(event.data.error || 'The agent is unavailable. Please try again.');
        if (event.type === 'result') result = event.data;
      }
    }
    if (!result) throw new Error('The connection ended before Demo Bot finished replying. Please try again.');
    return result;
  }
  const data = await response.json().catch(() => ({ error: 'The agent is unavailable. Please try again.' }));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function showError(error) {
  addMessage('Demo Bot', error.message).dataset.error = '';
}
input.addEventListener('input', () => {
  resizePrompt();
  offer = null;
  result.querySelector('.agent-build-options')?.remove();
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
  result.querySelector('.agent-build-options')?.remove();
  submit.disabled = true;
  input.readOnly = true;
  result.setAttribute('aria-busy', 'true');
  addMessage('You', prompt);
  const pending = addMessage('Demo Bot', 'Thinking...');
  pending.classList.add('agent-status');
  const steps = document.createElement('ol');
  steps.className = 'agent-search-steps';
  pending.append(steps);
  function finishSteps(failed = false) {
    for (const step of steps.children) if (step.dataset.state === 'active') step.dataset.state = failed ? 'failed' : 'complete';
  }
  let acknowledged = false;
  let replied = false;
  try {
    const data = await post('/agent/api/search', { prompt, history: conversation }, {
      onAcknowledgement(message) {
        pending.firstElementChild.replaceWith(botMessage(message));
        acknowledged = true;
      },
      onProgress(event) {
        finishSteps();
        const step = document.createElement('li');
        step.textContent = event.message;
        step.dataset.state = 'active';
        steps.append(step);
      },
    });
    finishSteps();
    const answer = addMessage('Demo Bot', data.message);
    conversation = data.history || [...conversation, { role: 'user', content: prompt.slice(0, 600) }, { role: 'assistant', content: data.message.slice(0, 600) }].slice(-4);
    input.value = '';
    resizePrompt();
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
        const buildOffer = offer;
        // Open on the click, before async work, to avoid popup blockers.
        const preview = window.open('about:blank', '_blank');
        if (preview) {
          preview.opener = null;
          preview.document.title = 'Creating your custom demo';
          const style = preview.document.createElement('link');
          style.rel = 'stylesheet'; style.href = new URL('/agent/agent.css', location.origin).href;
          preview.document.head.append(style);
          preview.document.body.className = 'project-page';
          const loading = preview.document.createElement('section'); loading.className = 'project-message';
          const heading = preview.document.createElement('h2'); heading.textContent = 'Creating a custom demo for you';
          const detail = preview.document.createElement('p'); detail.textContent = 'This usually takes a minute or two.';
          loading.append(heading, detail); preview.document.body.append(loading);
        }
        build.disabled = true; build.textContent = 'Starting your demo…';
        try {
          const project = await post('/agent/api/projects', { offer: buildOffer });
          if (offer === buildOffer) offer = null;
          if (preview && !preview.closed) preview.location.replace(project.url);
          options.remove();
          const link = document.createElement('a');
          link.href = project.url; link.target = '_blank'; link.rel = 'noopener'; link.className = 'agent-build'; link.textContent = 'Open your demo ↗';
          addMessage('Demo Bot', 'Your demo is building. Its one-hour lifetime starts when it is ready.').append(link);
        } catch (error) {
          preview?.close(); showError(error);
          build.disabled = false; build.textContent = 'Build this demo ↗';
        }
      });
      const options = document.createElement('div'); options.className = 'agent-build-options';
      options.append(build, paragraph('One focused feature · 64 KB code limit · One-hour preview · Downloadable source + agent guidance', 'agent-limits'));
      answer.append(options);
    }
  } catch (error) { finishSteps(true); showError(error); }
  finally {
    submit.disabled = false;
    input.readOnly = false;
    result.setAttribute('aria-busy', 'false');
    if (!acknowledged) pending.firstElementChild.replaceWith(botMessage(replied ? 'Your results are ready.' : 'The request could not be completed.'));
    if (replied && (document.activeElement === submit || document.activeElement === input)) input.focus();
  }
});

// Keep the gallery usable before the backend is provisioned or while it is unavailable.
try {
  const health = await fetch('/agent/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (health.ok && (await health.json()).configured === true) {
    form.closest('.agent').hidden = false;
    resizePrompt();
  }
} catch { /* Demo Bot stays hidden until a later page load reports readiness. */ }
