import { useState } from 'react';
import type { SuperDoc } from 'superdoc';

export function TrackedChangeActions({ superdoc, disabled, onUpdated }: {
  superdoc?: SuperDoc;
  disabled: boolean;
  onUpdated: () => void;
}) {
  const [pending, setPending] = useState<'accept' | 'reject'>();
  const [error, setError] = useState('');

  async function decideAll(action: 'accept' | 'reject') {
    if (disabled || pending || !superdoc) return;
    setPending(action);
    setError('');
    try {
      const result = await (action === 'accept'
        ? superdoc.ui.trackChanges.acceptAllAsync()
        : superdoc.ui.trackChanges.rejectAllAsync());
      if (!result || (typeof result === 'object' && !result.success)) {
        throw new Error(typeof result === 'object' && 'failure' in result
          ? result.failure.message : 'The editor could not apply the tracked-change decision.');
      }
      onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(undefined);
    }
  }

  return (
    <div className="tracked-change-actions" role="group" aria-label="Tracked changes">
      <span className="tracked-change-label">Tracked changes</span>
      <button type="button" className="tracked-change-command accept-all" disabled={disabled || !!pending || !superdoc}
        aria-busy={pending === 'accept'} aria-label="Accept all tracked changes" title="Accept all tracked changes in the document"
        onPointerDown={(event) => event.preventDefault()} onClick={() => void decideAll('accept')}>
        {pending === 'accept' && <span className="spinner" aria-hidden="true" />}
        Accept all
      </button>
      <button type="button" className="tracked-change-command reject-all" disabled={disabled || !!pending || !superdoc}
        aria-busy={pending === 'reject'} aria-label="Reject all tracked changes" title="Reject all tracked changes in the document"
        onPointerDown={(event) => event.preventDefault()} onClick={() => void decideAll('reject')}>
        {pending === 'reject' && <span className="spinner" aria-hidden="true" />}
        Reject all
      </button>
      {error && <p className="reference-status error" role="alert">{error}</p>}
    </div>
  );
}
