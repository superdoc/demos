const id = location.pathname.match(/\/projects\/([a-f0-9]{32})/)?.[1];
const message = document.querySelector('#project-message');
const frame = document.querySelector('#project-preview');
const download = document.querySelector('#project-download');
const progress = document.querySelector('#project-progress-text');
let expiryTimer;
function identify() {
  document.querySelector('#project-id').textContent = `temp / ${id?.slice(0, 8) || 'unknown'}`;
}
function stop(title, detail) {
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
}
function show(project) {
  clearTimeout(expiryTimer);
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
  expiryTimer = setTimeout(() => {
    stop('This demo has expired', 'Return to the gallery to build another. Your downloaded copy is yours to keep.');
  }, Math.max(0, project.expiresAt - Date.now()));
}
async function poll() {
  try {
    const response = await fetch(`/agent/api/projects/${id}`, { cache: 'no-store' });
    const project = await response.json();
    if (!response.ok || project.state === 'failed') {
      const detail = project.error || 'The demo could not be loaded. Please try again.';
      stop(response.status === 410 ? 'This demo has expired' : 'The demo could not be built', detail);
      return;
    }
    if (project.state === 'building') {
      progress.textContent = project.progress || 'Building your demo…';
      setTimeout(poll, 1000);
      return;
    }
    if (project.state !== 'ready' || project.id !== id) throw new Error('The demo server returned an unexpected response.');
    show(project);
  } catch {
    stop('Could not reach the demo server', 'Refresh this page to reconnect.');
  }
}
identify();
if (id) poll(); else stop('Demo not found', 'Return to the gallery to find or create a demo.');
