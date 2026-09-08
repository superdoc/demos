import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { SuperDoc } from 'superdoc';
import type { SelectionCapture, TrackChangesItem } from 'superdoc/ui';
import { useSetSuperDoc, useSuperDocSelection, useSuperDocTrackChanges, useSuperDocUI } from 'superdoc/ui/react';

export function SuperDocEditor({
  onStartComment,
  commentDraftOpen,
  activeCommentId,
  onActiveComment,
  onHoverComment,
}: {
  onStartComment: (capture: SelectionCapture) => void;
  commentDraftOpen: boolean;
  activeCommentId: string | null;
  onActiveComment: (commentId: string | null) => void;
  onHoverComment: (commentId: string | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const setSuperDoc = useSetSuperDoc();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mountRef.current) return;

    const superdoc = new SuperDoc({
      selector: mountRef.current,
      document: `${import.meta.env.BASE_URL}review-sample.docx`,
      documentMode: 'suggesting',
      rulers: true,
      rulerContainer: rulerRef.current ?? undefined,
      ui: {
        toolbar: {
          container: '#default-toolbar',
          hideButtons: false,
          texts: {
            fontFamily: '',
            fontSize: '',
            clearFormatting: '',
            numberedList: '',
            bulletList: '',
            indentLeft: '',
            indentRight: '',
            lineHeight: '',
            formatText: '',
            linkedStyles: '',
          },
          groups: {
            center: [
              'clearFormatting',
              'numberedlist',
              'list',
              'indentleft',
              'indentright',
              'lineHeight',
            ],
          },
        },
        comments: false,
        contextMenu: false,
        loading: false,
        search: false,
        linkPopover: false,
        ruler: true,
        contentControls: false,
      },
      onReady: ({ superdoc: readySuperDoc }) => setSuperDoc(readySuperDoc),
      onException: ({ error: loadError }) => {
        console.error(loadError);
        setError('The review document could not be opened.');
      },
    });

    return () => superdoc.destroy();
  }, [setSuperDoc]);

  return (
    <main ref={stageRef} className="document-stage">
      {error ? <div className="error-banner">{error}</div> : null}
      <div ref={rulerRef} className="fixed-ruler" aria-label="Document ruler" />
      <RulerPositioner ruler={rulerRef} relativeTo={stageRef} />
      <div ref={mountRef} className="editor-mount" aria-label="Editable contract" />
      <CommentRangeActivation
        relativeTo={stageRef}
        activeCommentId={activeCommentId}
        onActiveComment={onActiveComment}
        onHoverComment={onHoverComment}
      />
      <SelectionCommentButton relativeTo={stageRef} onStartComment={onStartComment} hidden={commentDraftOpen} />
      <TrackedChangeClickPopover relativeTo={stageRef} />
    </main>
  );
}

function RulerPositioner({
  ruler,
  relativeTo,
}: {
  ruler: RefObject<HTMLDivElement | null>;
  relativeTo: RefObject<HTMLElement | null>;
}) {
  const ui = useSuperDocUI();

  const alignRuler = useCallback(() => {
    const stage = relativeTo.current;
    const rulerElement = ruler.current;
    const firstPage = stage?.querySelector<HTMLElement>('[data-page-index="0"]');
    if (!stage || !rulerElement || !firstPage) return;

    const stageBounds = stage.getBoundingClientRect();
    const pageBounds = firstPage.getBoundingClientRect();
    rulerElement.style.width = `${pageBounds.width}px`;
    rulerElement.style.marginLeft = `${pageBounds.left - stageBounds.left + stage.scrollLeft}px`;
  }, [relativeTo, ruler]);

  useEffect(() => {
    alignRuler();
    const stop = ui?.viewport.observe(alignRuler);
    const stage = relativeTo.current;
    window.addEventListener('resize', alignRuler);
    stage?.addEventListener('scroll', alignRuler);
    return () => {
      stop?.();
      window.removeEventListener('resize', alignRuler);
      stage?.removeEventListener('scroll', alignRuler);
    };
  }, [alignRuler, relativeTo, ui]);

  return null;
}

function CommentRangeActivation({
  relativeTo,
  activeCommentId,
  onActiveComment,
  onHoverComment,
}: {
  relativeTo: RefObject<HTMLElement | null>;
  activeCommentId: string | null;
  onActiveComment: (commentId: string | null) => void;
  onHoverComment: (commentId: string | null) => void;
}) {
  const ui = useSuperDocUI();

  useEffect(() => {
    const stage = relativeTo.current;
    if (!stage || !ui) return;

    const updateActiveComment = (event: PointerEvent) => {
      const hits = ui.viewport.entityAt({ x: event.clientX, y: event.clientY });
      const comment = hits.find((hit) => hit.type === 'comment');
      const commentId = comment?.type === 'comment' ? comment.id : null;
      onActiveComment(commentId);
      ui.comments.setActive(commentId);
    };

    const updateHoveredComment = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const highlight = target?.closest<HTMLElement>('[data-comment-ids]');
      const commentId = highlight?.dataset.commentIds?.split(',')[0]?.trim() || null;
      onHoverComment(commentId);
    };

    const clearHoveredComment = () => onHoverComment(null);

    stage.addEventListener('pointerup', updateActiveComment);
    stage.addEventListener('pointermove', updateHoveredComment);
    stage.addEventListener('pointerleave', clearHoveredComment);
    return () => {
      stage.removeEventListener('pointerup', updateActiveComment);
      stage.removeEventListener('pointermove', updateHoveredComment);
      stage.removeEventListener('pointerleave', clearHoveredComment);
    };
  }, [onActiveComment, onHoverComment, relativeTo, ui]);

  useEffect(() => {
    const stage = relativeTo.current;
    if (!stage) return;

    const syncHighlights = () => {
      const highlights = stage.querySelectorAll<HTMLElement>('.superdoc-comment-highlight, .sd-editor-comment-highlight');
      highlights.forEach((highlight) => {
        const ids = (highlight.dataset.commentIds ?? '').split(',').map((id) => id.trim());
        highlight.classList.toggle('custom-comment-active', activeCommentId !== null && ids.includes(activeCommentId));
      });
    };

    syncHighlights();
    const observer = new MutationObserver(syncHighlights);
    observer.observe(stage, { childList: true, subtree: true });
    const stop = ui?.viewport.observe(syncHighlights);
    return () => {
      observer.disconnect();
      stop?.();
    };
  }, [activeCommentId, relativeTo, ui]);

  return null;
}

function SelectionCommentButton({
  relativeTo,
  onStartComment,
  hidden,
}: {
  relativeTo: RefObject<HTMLElement | null>;
  onStartComment: (capture: SelectionCapture) => void;
  hidden: boolean;
}) {
  const ui = useSuperDocUI();
  const selection = useSuperDocSelection();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const refreshPosition = useCallback(() => {
    const stage = relativeTo.current;
    if (!ui || !stage || hidden || selection.empty || selection.status === 'pending') return setPosition(null);
    const firstLine = ui.selection.getRects({ relativeTo: stage })[0];
    if (!firstLine) return setPosition(null);

    const page = stage.querySelector<HTMLElement>(`[data-page-index="${firstLine.pageIndex}"]`);
    const pageBounds = page?.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    const marginLeft = pageBounds
      ? pageBounds.right - stageBounds.left + stage.scrollLeft - 106
      : firstLine.right + 10;
    setPosition({ left: marginLeft, top: firstLine.top + stage.scrollTop });
  }, [hidden, relativeTo, selection.empty, selection.status, ui]);

  useEffect(() => {
    refreshPosition();
    const stop = ui?.viewport.observe(refreshPosition);
    const stage = relativeTo.current;
    window.addEventListener('resize', refreshPosition);
    window.addEventListener('scroll', refreshPosition, true);
    stage?.addEventListener('scroll', refreshPosition, { passive: true });
    return () => {
      stop?.();
      window.removeEventListener('resize', refreshPosition);
      window.removeEventListener('scroll', refreshPosition, true);
      stage?.removeEventListener('scroll', refreshPosition);
    };
  }, [refreshPosition, relativeTo, ui]);

  useEffect(() => {
    if (!selection.empty) return;
    setPosition(null);
  }, [selection.empty]);

  if (!position) return null;

  const openComposer = () => {
    const frozen = ui?.selection.capture();
    if (!frozen) return;
    onStartComment(frozen);
    setPosition(null);
  };

  return (
    <div
      className="selection-comment-control"
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className="selection-comment-button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={openComposer}
        aria-label="Add comment"
        title="Add comment"
      >
        <svg aria-hidden="true" viewBox="0 0 640 640">
          <path className="comment-outline" d="M115.9 448.9C83.3 408.6 64 358.4 64 304C64 171.5 178.6 64 320 64C461.4 64 576 171.5 576 304C576 436.5 461.4 544 320 544C283.5 544 248.8 536.8 217.4 524L101 573.9C97.3 575.5 93.5 576 89.5 576C75.4 576 64 564.6 64 550.5C64 546.2 65.1 542 67.1 538.3L115.9 448.9zM153.2 418.7C165.4 433.8 167.3 454.8 158 471.9L140 505L198.5 479.9C210.3 474.8 223.7 474.7 235.6 479.6C261.3 490.1 289.8 496 319.9 496C437.7 496 527.9 407.2 527.9 304C527.9 200.8 437.8 112 320 112C202.2 112 112 200.8 112 304C112 346.8 127.1 386.4 153.2 418.7z" />
          <path className="comment-plus" d="M320 210v188M226 304h188" />
        </svg>
      </button>
    </div>
  );
}

const changeDescription = (item: TrackChangesItem) =>
  item.insertedText || item.deletedText || item.formattingDeltaSummary || item.excerpt || `${item.type} change`;

type ClickedChange = { item: TrackChangesItem; left: number; top: number };

function TrackedChangeClickPopover({ relativeTo }: { relativeTo: RefObject<HTMLElement | null> }) {
  const ui = useSuperDocUI();
  const changes = useSuperDocTrackChanges();
  const [clicked, setClicked] = useState<ClickedChange | null>(null);

  useEffect(() => {
    const stage = relativeTo.current;
    if (!stage || !ui) return;

    const showAtClick = (event: PointerEvent) => {
      const hit = ui.trackChanges.getAt({ x: event.clientX, y: event.clientY });
      if (!hit) return setClicked(null);
      const bounds = stage.getBoundingClientRect();
      ui.trackChanges.setActive(hit);
      setClicked({
        item: hit.item,
        left: event.clientX - bounds.left + stage.scrollLeft + 12,
        top: event.clientY - bounds.top + stage.scrollTop,
      });
    };

    stage.addEventListener('pointerup', showAtClick);
    return () => stage.removeEventListener('pointerup', showAtClick);
  }, [relativeTo, ui]);

  useEffect(() => {
    if (clicked && !changes.items.some((item) => item.id === clicked.item.id)) setClicked(null);
  }, [changes.items, clicked]);

  if (!clicked) return null;
  const author = clicked.item.author || 'Reviewer';

  return (
    <div className="tracked-change-popover" style={{ left: clicked.left, top: clicked.top }}>
      <span className={`change-dot ${clicked.item.deletedText ? 'deletion' : ''}`} />
      <span className="tracked-change-copy">
        <strong>{author}</strong>
        <span>{changeDescription(clicked.item)}</span>
      </span>
      <button aria-label={`Reject change by ${author}`} onClick={() => ui?.trackChanges.reject(clicked.item.id)}>×</button>
      <button className="accept-change" aria-label={`Accept change by ${author}`} onClick={() => ui?.trackChanges.accept(clicked.item.id)}>✓</button>
    </div>
  );
}
