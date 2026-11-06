import { useRef, useState } from 'react';
import buildCommand from './build-app.sh?raw';

export function BuildThis() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  return <>
    <button className="primary-button build-this-button" type="button" onClick={() => dialog.current?.showModal()}>Build this</button>
    <dialog ref={dialog} className="build-dialog" aria-labelledby="build-dialog-title"
      onClose={() => { setCopied(false); setError(''); }}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="build-dialog-header">
        <div><h2 id="build-dialog-title">Build this app</h2><p>Copy this Bash snippet to clone and run the Version History editor and backend locally.</p></div>
        <button className="build-dialog-close" type="button" aria-label="Close" onClick={() => dialog.current?.close()}>×</button>
      </div>
      <div className="build-dialog-body">
        <pre><code>{buildCommand}</code></pre>
        <div className="build-dialog-actions">
          <button className="build-command-copy" type="button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildCommand);
              setCopied(true);
              setError('');
            } catch { setError('Could not access the clipboard. Select the commands above and copy them.'); }
          }}>{copied ? 'Copied' : 'Copy all commands'}</button>
          <a href="https://github.com/superdoc/demos/blob/main/version-history/README.md" target="_blank" rel="noreferrer">View the README on GitHub</a>
        </div>
        <p className="build-dialog-note" role="status">{error || (copied ? 'Commands copied to clipboard.' : 'Requires Node.js 22.12+ and Git. Starts the editor on :5173 and the collaboration/version backend on :4191. No API keys needed.')}</p>
      </div>
    </dialog>
  </>;
}
