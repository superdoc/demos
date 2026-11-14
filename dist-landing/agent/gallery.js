const form = document.querySelector('#agent-form');
const input = document.querySelector('#agent-prompt');
const result = document.querySelector('#agent-result');
const submit = form.querySelector('button');
let offer = null;

function paragraph(text, className) {
  const element = document.createElement('p');
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({ error: 'The agent is unavailable. Please try again.' }));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function showError(error) {
  result.dataset.error = '';
  result.replaceChildren(paragraph(error.message));
}
input.addEventListener('input', () => {
  form.toggleAttribute('data-expanded', Boolean(input.value));
  offer = null;
  result.querySelector('.agent-build')?.remove();
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
  delete result.dataset.error;
  submit.disabled = true;
  input.readOnly = true;
  result.setAttribute('aria-busy', 'true');
  result.replaceChildren(paragraph('Finding the right demo for you…'));
  try {
    const data = await post('/agent/api/search', { prompt });
    result.replaceChildren(paragraph(data.message));
    for (const match of data.matches) {
      const link = document.createElement('a');
      link.className = 'agent-match';
      link.href = match.liveDemoUri;
      const title = document.createElement('strong');
      title.textContent = `${match.title} ↗`;
      link.append(title, document.createTextNode(match.reason));
      result.append(link);
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
          result.append(link, paragraph('Your demo is building. Its one-hour lifetime starts when it is ready.', 'agent-limits'));
        } catch (error) { preview?.close(); showError(error); }
      });
      result.append(build, paragraph('One focused feature · 64 KB code limit · One-hour preview · Downloadable source + agent guidance', 'agent-limits'));
    }
  } catch (error) { showError(error); }
  finally { submit.disabled = false; input.readOnly = false; result.setAttribute('aria-busy', 'false'); }
});
