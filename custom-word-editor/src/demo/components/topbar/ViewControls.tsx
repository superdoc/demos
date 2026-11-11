import { useState } from 'react';
import { useSuperDocCommand, useSuperDocDocument } from 'superdoc/ui/react';

export function ViewControls({ outlineVisible, onOutlineChange }: {
  outlineVisible: boolean;
  onOutlineChange: (visible: boolean) => void;
}) {
  const ruler = useSuperDocCommand('ruler');
  const document = useSuperDocDocument();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function toggleRuler() {
    if (pending || !ruler.enabled) return;
    setPending(true);
    setError('');
    try {
      const result = await ruler.executeAsync();
      if (result === false || (typeof result === 'object' && result !== null && 'success' in result && !result.success))
        setError('The ruler could not be toggled. Please try again.');
    } catch {
      setError('The ruler could not be toggled. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="document-view-controls" role="group" aria-label="View">
      <label><input type="checkbox" checked={Boolean(ruler.value ?? ruler.active)} disabled={!ruler.enabled || pending} onChange={() => void toggleRuler()} />Ruler</label>
      <label><input type="checkbox" checked={outlineVisible} disabled={!document.ready} aria-controls="document-outline-panel" onChange={(event) => onOutlineChange(event.target.checked)} />Outline</label>
      {error && <span className="document-view-error" role="alert">{error}</span>}
    </div>
  );
}
