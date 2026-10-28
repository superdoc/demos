import { useState } from 'react';
import { useSuperDocCommand } from 'superdoc/ui/react';
import './TrackedChangesControls.css';

/** Bulk review actions sharing the live SuperDoc custom UI command controller. */
export function TrackedChangesControls() {
  const acceptAll = useSuperDocCommand('acceptAllChanges');
  const rejectAll = useSuperDocCommand('rejectAllChanges');
  const [pending, setPending] = useState<'accept' | 'reject' | null>(null);
  const [error, setError] = useState('');

  const decideAll = async (action: 'accept' | 'reject') => {
    if (pending) return;
    const command = action === 'accept' ? acceptAll : rejectAll;
    if (!command.enabled) return;
    setPending(action);
    setError('');
    try {
      const result = await command.executeAsync();
      if (result === false || (typeof result === 'object' && result !== null && 'success' in result && !result.success)) {
        setError(`Could not ${action} all tracked changes.`);
      }
    } catch {
      setError(`Could not ${action} all tracked changes.`);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="document-toolbar-tracked-changes-controls" role="group" aria-label="Tracked changes" aria-busy={pending !== null}>
      <span className="document-toolbar-tracked-changes-label">Tracked changes</span>
      <button
        type="button"
        className="document-toolbar-tracked-changes-accept"
        disabled={!acceptAll.enabled || pending !== null}
        title="Accept all tracked changes"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void decideAll('accept')}
      >
        {pending === 'accept' ? 'Accepting…' : 'Accept all'}
      </button>
      <button
        type="button"
        className="document-toolbar-tracked-changes-reject"
        disabled={!rejectAll.enabled || pending !== null}
        title="Reject all tracked changes"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void decideAll('reject')}
      >
        {pending === 'reject' ? 'Rejecting…' : 'Reject all'}
      </button>
      {error ? <span className="document-toolbar-tracked-changes-error" role="status">{error}</span> : null}
    </div>
  );
}
