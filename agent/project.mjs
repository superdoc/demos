import { zip } from './zip.mjs';
import { Script } from 'node:vm';

export const SUPERDOC_VERSION = '2.31.0';
export const MAX_CODE_BYTES = 64 * 1024;
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function validateProject(project) {
  for (const key of ['title', 'summary', 'javascript', 'css', 'guidance']) {
    if (typeof project?.[key] !== 'string' || !project[key].trim()) throw new Error(`Missing project ${key}`);
  }
  if (project.title.length > 100 || project.summary.length > 1000 || project.guidance.length > 6000
    || Buffer.byteLength(project.javascript + project.css) > MAX_CODE_BYTES) {
    throw new Error('Generated project exceeds the size limit. Try a smaller feature.');
  }
  if (!/\bexport\s+(?:async\s+)?function\s+setupDemo\s*\(/.test(project.javascript)) throw new Error('Missing setupDemo export');
  // Parse without executing untrusted code. The supported module has one named export.
  new Script(project.javascript.replace(/\bexport\s+(?=(?:async\s+)?function\s+setupDemo\b)/, ''));
  return project;
}

export function sampleDocument() {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SuperDoc playground</w:t></w:r></w:p><w:p><w:r><w:t>This is your sample document. Select text, edit content, or try the demo controls.</w:t></w:r></w:p><w:p><w:r><w:t>Customer: Acme Inc. — Project: Document workspace</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
  });
}

export const baseCss = `*{box-sizing:border-box}body{margin:0;color:#172033;background:#f5f6fa;font:14px/1.5 system-ui,sans-serif}button,input,select,textarea{font:inherit}button{cursor:pointer;padding:9px 14px;border:1px solid #dce2ee;border-radius:8px;background:white;color:#1355ff}button:hover{background:#eef3ff}#demo-heading{margin:0;font-size:20px}#demo-intro{margin:5px 0 16px;color:#64748b}#demo-panel{padding:20px;background:white;border-bottom:1px solid #e2e8f0}#demo-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center}#demo-status{white-space:pre-wrap;color:#64748b}#superdoc-toolbar{position:sticky;top:0;z-index:2;background:white}#superdoc-editor{padding:24px;overflow:auto;min-height:700px}#demo-output{white-space:pre-wrap} `;

export function projectHtml(project, { preview = false } = {}) {
  const css = preview ? `<style>${baseCss}</style><link rel="stylesheet" href="data:text/css;base64,${Buffer.from(project.css).toString('base64')}">` : '<link rel="stylesheet" href="./base.css"><link rel="stylesheet" href="./app.css">';
  const script = preview ? `data:text/javascript;base64,${Buffer.from(project.javascript).toString('base64')}` : './app.js';
  const doc = preview ? `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${sampleDocument().toString('base64')}` : './sample.docx';
  const documentSource = preview ? JSON.stringify(doc) : 'new URL("./sample.docx", import.meta.url).href';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(project.title)}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/superdoc@${SUPERDOC_VERSION}/dist-cdn/superdoc.min.css">${css}</head><body>
<section id="demo-panel">${preview ? '' : `<h1 id="demo-heading">${escape(project.title)}</h1><p id="demo-intro">${escape(project.summary)}</p>`}<div id="demo-controls"></div><p id="demo-status" role="status">Loading editor…</p><div id="demo-output"></div></section><div id="superdoc-toolbar"></div><div id="superdoc-editor"></div>
<script src="https://cdn.jsdelivr.net/npm/superdoc@${SUPERDOC_VERSION}/dist-cdn/superdoc.min.js"></script>
<script type="module">
(async () => {
const status = document.querySelector('#demo-status');
try {
  const { setupDemo } = await import(${JSON.stringify(script)});
  if (typeof setupDemo !== 'function') throw new Error('The demo must export setupDemo. Download the project to adjust it with your agent.');
  const superdoc = new SuperDoc({selector:'#superdoc-editor',toolbar:'#superdoc-toolbar',document:${documentSource},documentMode:'editing',user:{name:'Demo User',email:'demo@example.com'},
    onReady:async({superdoc})=>{try{status.textContent='Ready';await setupDemo({superdoc,controls:document.querySelector('#demo-controls'),output:document.querySelector('#demo-output'),status,readText:()=>superdoc.activeEditor.doc.getText({})});}catch(error){status.textContent='Demo error: '+error.message;}},
    onException:()=>{status.textContent='The editor could not load. Download the project to continue locally.';}});
} catch(error) {status.textContent='Demo error: '+error.message;}
})();
</script></body></html>`;
}

export function projectFiles(project) {
  const requestContext = [project.prompt, ...(project.refinements || []).map((prompt, index) => `Follow-up ${index + 1}: ${prompt}`)].join("\n\n");
  return {
    'index.html': projectHtml(project), 'app.js': project.javascript, 'app.css': project.css,
    'base.css': baseCss, 'sample.docx': sampleDocument(),
    'package.json': JSON.stringify({ name: 'superdoc-agent-demo', version: '0.0.0', private: true, type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build' }, devDependencies: { vite: '6.4.5' } }, null, 2),
    'README.md': `# ${project.title}\n\n${project.summary}\n\n## Run locally\n\nRequires Node.js 22.12+ and internet access for the pinned SuperDoc CDN assets.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\nOpen the URL Vite prints. Run \`npm run build\` to build.\n\n## Your request\n\n${requestContext}\n\n## Agent guidance\n\n${project.guidance}\n\nThis is an AI-generated starting point. The preview expires one hour after creation; the download is yours to keep. No API keys are needed to run this project.\n`,
    'AGENTS.md': `# Continue this SuperDoc demo\n\nRead README.md and app.js first. Run npm install and npm run dev. Use browser checks to confirm each requested behavior.\n\nThe host creates SuperDoc ${SUPERDOC_VERSION}, then calls the named export setupDemo({ superdoc, controls, output, status, readText }) in app.js when ready. Read document text with await readText(). Browser Document API calls are asynchronous. Use superdoc.activeEditor.doc; do not use legacy TipTap editor.state, commands, or on(). Customize app.js and app.css. Use documented public APIs; inspect https://docs.superdoc.dev before extending features. Keep the pinned CDN version unless deliberately upgrading. Never add API keys to browser code.\n\nOriginal request:\n${requestContext}\n\nImplementation notes, limitations, and suggested next steps:\n${project.guidance}\n`,
    '.gitignore': 'node_modules/\ndist/\n.env*\n',
  };
}
