import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SelectionCapture } from 'superdoc/ui';
import { useSuperDocComments, useSuperDocUI } from 'superdoc/ui/react';
import { CommentCard } from './Comment';
import { getCommentId, receiptMessage, resultSucceeded } from './commentUtils';

function CommentsPanel({
  pending,
  onClosePending,
  activeCommentId,
  focusedCommentId,
  onActiveComment,
  onHoverComment,
}: {
  pending: SelectionCapture | null;
  onClosePending: () => void;
  activeCommentId: string | null;
  focusedCommentId: string | null;
  onActiveComment: (commentId: string | null) => void;
  onHoverComment: (commentId: string | null) => void;
}) {
  const ui = useSuperDocUI();
  const comments = useSuperDocComments();
  const feedRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');
  const roots = useMemo(
    () => comments.items.filter((item) => !item.parentCommentId && !item.trackedChange),
    [comments.items],
  );

  // Converts every visible document comment range into a vertical coordinate
  // inside the rail so its card follows the corresponding text while scrolling.
  const positionComments = useCallback(() => {
    const feed = feedRef.current;
    if (!ui || !feed) return setPositions({});

    // Both rectangles use viewport coordinates. Subtracting the rail's top from
    // a document range's top produces the card's rail-relative CSS `top` value.
    const feedBounds = feed.getBoundingClientRect();
    const stage = feed.closest('.workspace')?.querySelector<HTMLElement>('.document-stage');
    const stageBounds = stage?.getBoundingClientRect();

    // Ask SuperDoc for the first painted rectangle of each root comment. Ignore
    // comments outside the visible document stage; the extra 25px excludes the
    // sticky ruler that sits over the top edge of the document viewport.
    const anchored = roots.flatMap((item) => {
      const target = item.target ?? item.address;
      const result = ui.viewport.getRect({ target });
      const rect = result.rects[0];
      const isVisible = rect && stageBounds
        ? rect.bottom >= stageBounds.top + 25 && rect.top <= stageBounds.bottom
        : Boolean(rect);
      return rect && isVisible ? [{ id: getCommentId(item), top: rect.top - feedBounds.top }] : [];
    });

    // The new-comment composer uses the same geometry calculation, but remains
    // independent of existing-card collision spacing so it may overlap them.
    const pendingTarget = pending?.target ?? pending?.selectionTarget;
    let pendingTop: number | undefined;
    if (pendingTarget) {
      const pendingRect = ui.viewport.getRect({ target: pendingTarget }).rects[0];
      if (pendingRect) pendingTop = pendingRect.top - feedBounds.top;
    }

    // Process cards in document order from top to bottom.
    anchored.sort((left, right) => left.top - right.top);

    // Keep each card aligned to its document range when space permits. For
    // nearby ranges, move later cards down into 176px slots to limit overlap.
    let nextAvailableTop = 8;
    const nextPositions = Object.fromEntries(anchored.map(({ id, top }) => {
      const positionedTop = Math.max(top, nextAvailableTop);
      nextAvailableTop = positionedTop + 176;
      return [id, positionedTop];
    }));

    // Anchor the pending composer directly to its selection, above the rail's
    // small top inset, without shifting the existing comment stack.
    if (pendingTop !== undefined) nextPositions.__pending__ = Math.max(8, pendingTop);

    // Avoid a state update when viewport observation reports identical geometry.
    setPositions((current) => {
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextPositions);
      const unchanged = currentKeys.length === nextKeys.length
        && nextKeys.every((key) => current[key] === nextPositions[key]);
      return unchanged ? current : nextPositions;
    });
  }, [pending, roots, ui]);

  useEffect(() => {
    positionComments();
    const stop = ui?.viewport.observe(positionComments);
    window.addEventListener('resize', positionComments);
    window.addEventListener('scroll', positionComments, true);
    return () => {
      stop?.();
      window.removeEventListener('resize', positionComments);
      window.removeEventListener('scroll', positionComments, true);
    };
  }, [positionComments, ui]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || !ui || !focusedCommentId) return;

    const activeComment = roots.find((item) => getCommentId(item) === focusedCommentId);
    const activeCard = Array.from(feed.querySelectorAll<HTMLElement>('[data-comment-id]'))
      .find((card) => card.dataset.commentId === focusedCommentId);
    if (!activeComment || !activeCard) return;

    const anchorRect = ui.viewport.getRect({ target: activeComment.target ?? activeComment.address }).rects[0];
    if (!anchorRect) return;

    const cardRect = activeCard.getBoundingClientRect();
    feed.scrollTo({
      top: feed.scrollTop + cardRect.top - anchorRect.top,
      behavior: 'smooth',
    });
  }, [focusedCommentId, positions, roots, ui]);

  // Owns cross-surface focus behavior after a comment card is clicked: update
  // app state, activate the SuperDoc range, and navigate the document to it.
  const activateComment = useCallback((commentId: string) => {
    onActiveComment(commentId);
    ui?.comments.setActive(commentId);
    void ui?.comments.scrollTo(commentId);
  }, [onActiveComment, ui]);

  const submitDraft = async () => {
    if (!ui || !pending || !draft.trim()) return;
    const result = await Promise.resolve(ui.comments.createFromCapture(pending, { text: draft.trim() }));
    if (resultSucceeded(result)) {
      if (pending.selectionTarget) {
        ui.selection.apply({
          ...pending.selectionTarget,
          start: pending.selectionTarget.end,
          end: pending.selectionTarget.end,
        });
      }
      ui.comments.setActive(null);
      onActiveComment(null);
      setDraft('');
      setDraftError('');
      onClosePending();
    } else {
      setDraftError(receiptMessage(result, ''));
    }
  };

  const cancelDraft = () => {
    setDraft('');
    setDraftError('');
    onClosePending();
  };

  let draftErrorFeedback: ReactNode;
  if (draftError) {
    draftErrorFeedback = <span className="action-status">{draftError}</span>;
  } else {
    draftErrorFeedback = null;
  }

  let pendingCommentComposer: ReactNode;
  if (pending) {
    pendingCommentComposer = (
      <article className="review-card anchored-comment new-comment-card" style={{ top: positions.__pending__ ?? 8 }}>
        {/* Composer heading */}
        <strong>New comment</strong>

        {/* New comment text input */}
        <textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a comment…"
        />

        {/* Comment creation failure feedback */}
        {draftErrorFeedback}

        {/* Cancel and submit actions for the pending comment */}
        <div className="new-comment-actions">
          <button onClick={cancelDraft}>Cancel</button>

          <button
            className="submit-comment"
            onClick={() => void submitDraft()}
            disabled={!draft.trim()}
          >
            Comment
          </button>
        </div>
      </article>
    );
  } else {
    pendingCommentComposer = null;
  }

  return (
    // Defines the accessible comments region displayed beside the document.
    <section className="panel-content floating-comments-panel" aria-label="Document comments">
      {/* Scrollable positioning surface for composers and existing comment cards. */}
      <div ref={feedRef} className="feed anchored-feed">
        {/* Show the new-comment composer at the selected document range. */}
        {pendingCommentComposer}

        {/* Render one standalone CommentCard component for each visible root thread. */}
        {roots.filter((item) => positions[getCommentId(item)] !== undefined).map((item) => {
          const commentId = getCommentId(item);
          const replies = comments.items.filter((candidate) =>
            candidate.parentCommentId === commentId || candidate.rootCommentId === commentId && getCommentId(candidate) !== commentId,
          );
          return (
            <CommentCard
              key={commentId}
              item={item}
              replies={replies}
              active={activeCommentId === commentId}
              onActivate={activateComment}
              onHover={onHoverComment}
              style={{ top: positions[commentId] }}
            />
          );
        })}
      </div>
    </section>
  );
}

export function CommentsRail({
  pending,
  onClosePending,
  activeCommentId,
  focusedCommentId,
  onActiveComment,
  onHoverComment,
}: {
  pending: SelectionCapture | null;
  onClosePending: () => void;
  activeCommentId: string | null;
  focusedCommentId: string | null;
  onActiveComment: (commentId: string | null) => void;
  onHoverComment: (commentId: string | null) => void;
}) {
  return (
    <aside className="review-sidebar floating-comments-rail">
      <CommentsPanel
        pending={pending}
        onClosePending={onClosePending}
        activeCommentId={activeCommentId}
        focusedCommentId={focusedCommentId}
        onActiveComment={onActiveComment}
        onHoverComment={onHoverComment}
      />
    </aside>
  );
}
