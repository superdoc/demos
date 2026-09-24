const signForm = document.querySelector('#sign-form');
const verifyForm = document.querySelector('#verify-form');
const download = document.querySelector('#download');
const signedResult = document.querySelector('#signed-result');
const pdfPreview = document.querySelector('#pdf-preview');
let downloadUrl;

function authHeaders() {
  const apiKey = document.querySelector('#api-key').value.trim();
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function toBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

async function post(path, payload, authenticated = false) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authenticated ? authHeaders() : {}),
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `Request failed with HTTP ${response.status}`);
  return result;
}

signForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('#sign-status');
  const file = document.querySelector('#sign-file').files[0];
  status.className = 'working';
  status.textContent = 'Signing…';
  download.hidden = true;
  signedResult.hidden = true;
  try {
    const timestamp = new Date().toISOString();
    const result = await post('/v1/sign', {
      eventId: crypto.randomUUID(),
      document: { base64: await toBase64(file), filename: file.name },
      signer: {
        name: document.querySelector('#signer-name').value,
        email: document.querySelector('#signer-email').value,
      },
      auditTrail: [
        { type: 'ready', timestamp },
        { type: 'submit', timestamp: new Date().toISOString() },
      ],
      certificate: { enabled: document.querySelector('#certificate').checked },
    }, true);
    const binary = atob(result.document.base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    download.href = downloadUrl;
    download.download = `${file.name.replace(/\.(pdf|docx)$/i, '')}-signed.pdf`;
    download.hidden = false;
    pdfPreview.src = downloadUrl;
    signedResult.hidden = false;
    requestAnimationFrame(() => signedResult.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    status.className = 'success';
    status.textContent = 'Document signed successfully.';
  } catch (error) {
    status.className = 'error';
    status.textContent = error.message;
  }
});

verifyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('#verify-status');
  const resultElement = document.querySelector('#verify-result');
  const file = document.querySelector('#verify-file').files[0];
  status.className = 'working';
  status.textContent = 'Verifying…';
  resultElement.hidden = true;
  try {
    const result = await post('/v1/verify', { document: { base64: await toBase64(file), filename: file.name } });
    status.className = result.valid ? 'success' : 'error';
    status.textContent = result.valid ? 'Signature is valid.' : 'Signature is not valid.';
    resultElement.textContent = JSON.stringify(result, null, 2);
    resultElement.hidden = false;
  } catch (error) {
    status.className = 'error';
    status.textContent = error.message;
  }
});
