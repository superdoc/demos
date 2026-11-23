import { useEffect, useRef, useState } from 'react';
import type { PromptAttachment } from '../types';

export type DraftAttachment = { file: File; kind: PromptAttachment['kind'] };

async function makeThumbnail(file: File) {
  try {
    const image = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 192 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally {
      image.close();
    }
  } catch {
    // Keep the attachment usable if the browser cannot decode its preview.
  }
}

export async function encodeAttachment({ file, kind }: DraftAttachment): Promise<PromptAttachment> {
  const [base64, thumbnail] = await Promise.all([
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read the attachment.'));
      reader.readAsDataURL(file);
    }),
    kind === 'image' ? makeThumbnail(file) : undefined,
  ]);
  return { name: file.name, kind, base64, thumbnail };
}

export function AgentAttachment({ disabled, onChoose, onError }: {
  disabled: boolean;
  onChoose: (attachment: DraftAttachment) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const control = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const selectedKind = useRef<DraftAttachment['kind']>('image');

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !control.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function pick(kind: DraftAttachment['kind']) {
    const input = picker.current;
    if (!input) return;
    selectedKind.current = kind;
    input.accept = kind === 'image' ? '.png,.jpg,.jpeg,image/png,image/jpeg' : '.docx,.txt,.md,.markdown';
    input.click();
    setOpen(false);
    button.current?.focus();
  }

  return <div className="agent-attachment-control" ref={control} onKeyDown={(event) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  }}>
    <button type="button" ref={button} className="agent-composer-icon" aria-label="Add attachment"
      title={open ? undefined : 'Add attachment'} aria-expanded={open && !disabled} disabled={disabled} onClick={() => setOpen(!open)}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    {open && !disabled && <div className="agent-attachment-menu" role="group" aria-label="Attachment type">
      <button type="button" onClick={() => pick('image')}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
          <circle cx="9" cy="9" r="1.5" />
          <path d="m4 17 4-4 3.5 3.5 4.5-5 4 4.5" />
        </svg>
        Image
      </button>
      <button type="button" onClick={() => pick('file')}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M13 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9L13 3.5Z" />
          <path d="M13 3.5v6h6M9 13.5h6M9 17h6" />
        </svg>
        File
      </button>
    </div>}
    <input type="file" ref={picker} hidden onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      const kind = selectedKind.current;
      if (!file.size || file.size > 5 * 1024 * 1024) {
        onError('Choose a non-empty attachment up to 5 MB.');
      } else if (kind === 'image' ? !/\.(png|jpe?g)$/i.test(file.name) : !/\.(docx|txt|md|markdown)$/i.test(file.name)) {
        onError(kind === 'image' ? 'Choose a PNG or JPEG image.' : 'Choose a DOCX, TXT, or Markdown file.');
      } else {
        onChoose({ file, kind });
      }
    }} />
  </div>;
}
