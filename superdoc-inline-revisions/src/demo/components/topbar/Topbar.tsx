import { useRef, useState } from 'react';
import { BlankDOCX } from 'superdoc';
import { useSuperDocDocument, useSuperDocHost, useSuperDocUI } from 'superdoc/ui/react';
import { Ribbon } from './Ribbon';

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
};

export function Topbar() {
  const host = useSuperDocHost();
  const ui = useSuperDocUI();
  const document = useSuperDocDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  const exportDocument = async (exportedName = 'reviewed-contract') => {
    if (!host || !('export' in host) || typeof host.export !== 'function') return;
    setSaving(true);
    try {
      await host.export({ exportType: ['docx'], exportedName });
    } finally {
      setSaving(false);
    }
  };

  const importDocument = async (file: File | undefined) => {
    if (!file || !ui) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setImportError('Choose a .docx file.');
      return;
    }

    setImporting(true);
    setImportError('');
    try {
      await ui.document.replaceFile(file);
    } catch (error) {
      console.error(error);
      setImportError('The document could not be imported.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const createNewDocument = async () => {
    if (!ui) return;
    setImporting(true);
    setImportError('');
    try {
      const response = await fetch(BlankDOCX);
      if (!response.ok) throw new Error('Blank document template could not be loaded.');
      await ui.document.replaceFile(await response.blob());
    } catch (error) {
      console.error(error);
      setImportError('A new document could not be created.');
    } finally {
      setImporting(false);
    }
  };

  const saveDocumentAs = async () => {
    if (!ui) return;
    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (!picker) {
      const name = window.prompt('Save document as', 'reviewed-contract');
      if (name?.trim()) await exportDocument(name.trim().replace(/\.docx$/i, ''));
      return;
    }

    try {
      const handle = await picker({
        suggestedName: 'reviewed-contract.docx',
        types: [{
          description: 'Word document',
          accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
        }],
      });
      setSaving(true);
      const result = await ui.document.export({ exportType: ['docx'], triggerDownload: false });
      if (!(result instanceof Blob)) throw new Error('SuperDoc did not return a DOCX file.');
      const writable = await handle.createWritable();
      await writable.write(result);
      await writable.close();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error(error);
      setImportError('The document could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const chooseFileAction = (action: string) => {
    if (action === 'new') void createNewDocument();
    if (action === 'open') fileInputRef.current?.click();
    if (action === 'save-as') void saveDocumentAs();
  };

  return (
    <header className="topbar">
      <div className="ribbon-tabs-row">
        <div className="file-title">
          <strong>Mutual NDA — review copy</strong>
          <span>{document.ready ? (document.dirty ? 'Unsaved changes' : 'Saved locally') : 'Opening document…'}</span>
        </div>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => void importDocument(event.target.files?.[0])}
        />
        <select
          className="file-menu"
          aria-label="File"
          value=""
          onChange={(event) => chooseFileAction(event.target.value)}
          disabled={!document.ready || importing}
          title={importError || undefined}
        >
          <option value="" disabled>{importing ? 'Working…' : 'File'}</option>
          <option value="new">New Document</option>
          <option value="open">Open…</option>
          <option value="save-as">Save As…</option>
        </select>
        <a className="more-demos-button" href="/">Demos</a>
        <label className="mode-select">
          <select
            aria-label="Document mode"
            value={document.mode ?? 'suggesting'}
            onChange={(event) => host?.setDocumentMode?.(event.target.value as 'suggesting' | 'editing' | 'viewing')}
          >
            <option value="suggesting">Reviewing</option>
            <option value="editing">Editing</option>
            <option value="viewing">Viewing</option>
          </select>
        </label>
      </div>
      <Ribbon />
    </header>
  );
}
