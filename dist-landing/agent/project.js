let id = location.pathname.match(/\/projects\/([a-f0-9]{32})/)?.[1];
const message = document.querySelector('#project-message');
const frame = document.querySelector('#project-preview');
const download = document.querySelector('#project-download');
const form = document.querySelector('#project-refine-form');
const prompt = document.querySelector('#project-prompt');
const update = document.querySelector('#project-update');
const feedback = document.querySelector('#project-refine-status');
let expiryTimer;
let pending = true;
let canRefine = false;

function controls() {
  form.closest('.project-refine').hidden = pending || !canRefine;
  prompt.disabled = pending || !canRefine;
  update.disabled = pending || !canRefine;
  update.textContent = pending ? 'Building…' : 'Update demo ↑';
  form.setAttribute('aria-busy', String(pending));
}
function note(text, error = false) {
  feedback.textContent = text;
  feedback.toggleAttribute('data-error', error);
}
function identify() {
  document.querySelector('#project-id').textContent = `temp / ${id?.slice(0, 8) || 'unknown'}`;
}
function stop(title, detail, expired = false) {
  clearTimeout(expiryTimer);
  frame.hidden = true;
  frame.removeAttribute('src');
  download.removeAttribute('href');
  download.setAttribute('aria-disabled', 'true');
  message.hidden = false;
  const heading = document.createElement('h2'); heading.textContent = title;
  const text = document.createElement('p'); text.textContent = detail;
  const link = document.createElement('a'); link.href = '/'; link.textContent = 'Return to SuperDoc Demos';
  message.replaceChildren(heading, text, link);
  canRefine = !expired && Boolean(id);
  controls();
}
function show(project) {
  clearTimeout(expiryTimer);
  id = project.id;
  identify();
  history.replaceState(null, '', `/agent/projects/${id}/`);
  document.title = `${project.title} · SuperDoc Demos`;
  document.querySelector('#project-title').textContent = project.title;
  document.querySelector('#project-summary').textContent = project.summary;
  document.querySelector('.project-description').hidden = false;
  document.querySelector('#project-notes').textContent = project.guidance;
  document.querySelector('#project-guidance').hidden = false;
  download.href = `/agent/projects/${id}/download`;
  download.setAttribute('aria-disabled', 'false');
  frame.src = `/agent/projects/${id}/preview`;
  frame.hidden = false;
  message.hidden = true;
  canRefine = true;
  expiryTimer = setTimeout(() => {
    stop('This demo has expired', 'Return to the gallery to build another. Your downloaded copy is yours to keep.', true);
    note('This preview is no longer available. Start a new demo from the gallery.', true);
  }, Math.max(0, project.expiresAt - Date.now()));
}
async function poll(targetId, revision = false) {
  try {
    const response = await fetch(`/agent/api/projects/${targetId}`, { cache: 'no-store' });
    const project = await response.json();
    if (!response.ok || project.state === 'failed') {
      const detail = project.error || 'The demo could not be loaded. Please try again.';
      if (revision) note(`${detail} Your previous version has been kept. You can adjust your request and try again.`, true);
      else {
        stop(response.status === 410 ? 'This demo has expired' : 'The demo could not be built', detail, response.status === 410 || response.status === 404);
        note(canRefine ? 'Describe what went wrong below and ask the agent to try again.' : detail, true);
      }
      return false;
    }
    if (project.state === 'building') {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return poll(targetId, revision);
    }
    if (project.state !== 'ready' || project.id !== targetId) throw new Error('The demo server returned an unexpected response.');
    show(project);
    note(revision ? 'Your updated demo is ready. Keep refining it or download the latest source.' : 'Ask for a change, a fix, or the next feature.');
    return true;
  } catch {
    if (revision) note('Could not reach the demo server. Your previous version has been kept. Try your request again.', true);
    else {
      stop('Could not reach the demo server', 'Refresh this page to reconnect.');
      canRefine = false;
      note('Refresh this page to reconnect before requesting changes.', true);
    }
    return false;
  }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!id || pending || !canRefine || !text) return;
  pending = true;
  controls();
  note('Updating your demo… Your current preview stays available while the agent works.');
  try {
    const response = await fetch(`/agent/api/projects/${id}/revisions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text }),
    });
    const project = await response.json();
    if (!response.ok) throw new Error(project.error || 'The update could not be started. Try again.');
    if (!/^[a-f0-9]{32}$/.test(project.id)) throw new Error('The demo server returned an unexpected response.');
    if (await poll(project.id, true)) prompt.value = '';
  } catch (error) {
    note(error.message || 'Could not request an update. Your previous version has been kept.', true);
  } finally {
    pending = false;
    controls();
  }
});
identify();
controls();
if (id) {
  poll(id).finally(() => { pending = false; controls(); });
} else {
  pending = false;
  stop('Demo not found', 'Return to the gallery to find or create a demo.', true);
}
