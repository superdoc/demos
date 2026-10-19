import { useEffect } from 'react';
import type { SuperDoc } from 'superdoc';
import { applyFootnoteReviewLabel } from '../footnote-review-labels';

export function FootnoteReviewLabels({ superdoc }: { superdoc?: SuperDoc }) {
  useEffect(() => {
    const pane = superdoc?.ui.viewport.getHost()?.closest('.document-pane');
    if (!superdoc || !pane) return;
    let active = true;
    let frame = 0;

    function update() {
      frame = 0;
      if (!active) return;
      const ids = new Set(superdoc!.ui.trackChanges.list().map((item) => item.id));
      // Review cards can mount after the native list resolves, or on scrolling.
      for (const card of pane!.querySelectorAll('[data-comment-thread-id], [data-comment-id]')) {
        const id = card.getAttribute('data-comment-thread-id') || card.getAttribute('data-comment-id');
        if (id) ids.add(id);
      }
      for (const id of ids) applyFootnoteReviewLabel(superdoc!.getComment(id));
    }
    function schedule() {
      if (active && !frame) frame = window.requestAnimationFrame(update);
    }

    // The SDK exposes no caption setter. Keep this model compatibility adapter
    // isolated so it can be removed when native footnote captions are corrected.
    const observer = new MutationObserver(schedule);
    observer.observe(pane, { childList: true, subtree: true, characterData: true });
    const stop = superdoc.ui.trackChanges.observe(schedule);
    superdoc.on('comments-update', schedule);
    superdoc.on('document-replaced', schedule);
    schedule();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      stop();
      superdoc.off('comments-update', schedule);
      superdoc.off('document-replaced', schedule);
    };
  }, [superdoc]);
  return null;
}
