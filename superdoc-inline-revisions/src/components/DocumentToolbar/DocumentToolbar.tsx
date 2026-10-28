import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { SuperDocUIProvider, useSetSuperDoc } from 'superdoc/ui/react';
import type { SuperDocHost } from 'superdoc/ui/react';
import { FormattingControls } from './FormattingControls';
import { StyleGallery } from './StyleGallery';
import { TrackedChangesControls } from './TrackedChangesControls';
import { FormattingShortcuts } from './FormattingShortcuts';
import './DocumentToolbar.css';

export interface DocumentToolbarProps {
  /** Pass an editor instance to use the toolbar without an existing UI provider. */
  superdoc?: SuperDocHost | null;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

type ToolbarContentsProps = Omit<DocumentToolbarProps, 'superdoc'>;

function ToolbarContents({ className = '', style, 'aria-label': label = 'Document toolbar' }: ToolbarContentsProps) {
  return (
    <div className={`document-toolbar ${className}`.trim()} style={style} role="toolbar" aria-label={label}>
      {/* Mount editor interactions here so consumers get them with the toolbar. */}
      <FormattingShortcuts />
      <FormattingControls />
      <StyleGallery />
      <TrackedChangesControls />
    </div>
  );
}

function BoundToolbar({ superdoc, ...props }: ToolbarContentsProps & { superdoc: SuperDocHost }) {
  const setSuperDoc = useSetSuperDoc();
  useEffect(() => { setSuperDoc(superdoc); }, [setSuperDoc, superdoc]);
  return <ToolbarContents {...props} />;
}

/**
 * Complete toolbar: formatting, styles, and bulk tracked-change decisions.
 * Includes mutation planning, locked-control selection, and formatting shortcuts.
 * Pass `superdoc` for standalone use, or omit it inside SuperDocUIProvider.
 * CSS is imported automatically. The editor instance remains owned by the app.
 */
export function DocumentToolbar({ superdoc, ...props }: DocumentToolbarProps) {
  if (superdoc === undefined) return <ToolbarContents {...props} />;

  return (
    <SuperDocUIProvider key={superdoc === null ? 'unbound' : 'bound'}>
      {superdoc === null ? <ToolbarContents {...props} /> : <BoundToolbar superdoc={superdoc} {...props} />}
    </SuperDocUIProvider>
  );
}
