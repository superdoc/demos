import { useEffect, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useSuperDocUI, type useSuperDocDocumentApi } from 'superdoc/ui/react';
import type { TextAddress, ViewportRect } from 'superdoc/ui';
import type { DocumentEditor } from './DocumentEditor';
import { getChangesApi, type ChangeRecord, type SnapshotEditor } from './change-records';
import {
  changeAuthor, changeDate, changeKey, changeLabel, changeText,
  locationKey, nodeText, orderChanges, recordChanges,
  type Change, type ChangeOrder, type Location,
} from './changes';

export type { SnapshotEditor } from './change-records';
export type { Change, ChangeOrder } from './changes';

type SnapshotApi = NonNullable<ReturnType<typeof useSuperDocDocumentApi>>;
type Highlight = { change: Change; rect: ViewportRect };
type Hover = { change: Change; x: number; y: number };
type ChangelogProps = {
  changes: Change[];
  ready: boolean;
  active: string | null;
  onSelect: (change: Change) => Promise<void>;
};
type HighlightProps = {
  changes: Change[];
  active: string | null;
  stage: RefObject<HTMLElement | null>;
};

// Storage and room selection belong to the host application. These operations
// capture and present versions without changing the live document.

/** Flush records, then capture matching DOCX and Yjs state without changing the document. */
export async function captureSnapshot(source: SnapshotEditor, flush: () => Promise<void>) {
  const changes = getChangesApi(source);
  for (let attempt = 0; attempt < 3; attempt++) {
    await flush();
    const checkpoint = await changes.snapshot({ includeState: true });
    if (!checkpoint.state) throw new Error('The Changes API did not return snapshot state.');
    const blob = await source.export({
      exportType: ['docx'],
      triggerDownload: false,
      policies: { trackedChanges: 'review-preserving' },
    });
    if (!(blob instanceof Blob) || !blob.size) throw new Error('Empty DOCX export');
    await flush();
    const after = await changes.snapshot();
    // Remote edits can arrive while the local UI is locked. Never associate a
    // DOCX with a different checkpoint or accept/delete any live changes.
    const unchanged = checkpoint.revision === after.revision
      && checkpoint.stateVector === after.stateVector;
    if (unchanged) return { blob, checkpoint };
  }
  throw new Error('The shared document kept changing during export. Please save again.');
}

export type SnapshotViewProps = Omit<ComponentProps<typeof DocumentEditor>, 'readOnly' | 'onChange'> & {
  editor: typeof DocumentEditor;
};

/** Mount a saved document using the host's editor component in read-only mode. */
export function SnapshotView({ editor: Editor, ...props }: SnapshotViewProps) {
  return <Editor {...props} readOnly />;
}

/** Render entries and sort controls; the host handles scrolling when an entry is selected. */
export function Changelog({ changes, ready, active, onSelect }: ChangelogProps) {
  const [order, setOrder] = useState<ChangeOrder>('newest');
  const [navigationError, setNavigationError] = useState('');
  const [navigating, setNavigating] = useState(false);
  const sorted = orderChanges(changes, order);

  async function showChange(change: Change) {
    setNavigating(true);
    setNavigationError('');
    try {
      await onSelect(change);
    } catch {
      setNavigationError('This edit has no remaining text location in this version.');
    } finally {
      setNavigating(false);
    }
  }

  return (
    <section className="changes-panel" aria-label="Version edits" aria-busy={!ready}>
      <div className="changes-heading">
        <h2>Edits in this version</h2>
        <span className="change-count">{changes.length}</span>
      </div>
      <label className="change-sort">
        Sort edits
        <select value={order} onChange={(event) => setOrder(event.target.value as ChangeOrder)}>
          <option value="newest">Most recent first</option>
          <option value="oldest">Oldest first</option>
          <option value="author">Author (A–Z)</option>
        </select>
      </label>
      {!ready && <p className="changes-message" role="status">Locating edits…</p>}
      {navigationError && <p className="changes-message error" role="alert">{navigationError}</p>}
      {ready && !changes.length && <p className="changes-message">No recorded edits in this version.</p>}
      <ol className="change-list" aria-label="Recorded edits">
        {sorted.map((change) => (
          <li key={changeKey(change)}>
            <button
              className={`change-card ${active === change.id ? 'selected' : ''}`}
              aria-current={active === change.id ? 'true' : undefined}
              disabled={!ready || navigating}
              onClick={() => void showChange(change)}
            >
              <span className="change-card-heading">
                <strong>{changeAuthor(change)}</strong>
                <span className={`change-kind ${change.change.kind}`}>{changeLabel(change)}</span>
              </span>
              <span className="change-excerpt">{changeText(change)}</span>
              {change.members && (
                <span className="change-location-note">{change.members.length} edits in this paragraph</span>
              )}
              <time dateTime={change.record.at.declared || change.record.at.observed}>
                {changeDate(change)}
              </time>
              {!change.targets.length && <span className="change-location-note">No remaining text range</span>}
              {change.contextOnly && <span className="change-location-note">Affected paragraph</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Draw snapshot highlights and author bubbles without adding marks to the document. */
export function ChangeHighlights({ changes, active, stage }: HighlightProps) {
  const ui = useSuperDocUI();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const [hover, setHover] = useState<Hover | null>(null);

  // Recompute screen rectangles after scrolling, zooming or document layout changes.
  useEffect(() => {
    if (!ui) return;
    let frame = 0;

    function paint() {
      frame = 0;
      const bounds = stage.current?.getBoundingClientRect();
      if (!bounds || !ui) return;

      const visible: Highlight[] = [];
      for (const change of changes) {
        for (const target of change.targets) {
          for (const rect of ui.viewport.getRect({ target }).rects) {
            const clipped = clipToStage(rect, bounds);
            if (clipped) visible.push({ change, rect: clipped });
          }
        }
      }
      setHighlights(visible);
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const stop = ui.viewport.observe(schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      stop();
    };
  }, [ui, changes, stage]);

  // Listen on the stage so overlays never intercept editor pointer events.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    let frame = 0;

    const clear = () => {
      cancelAnimationFrame(frame);
      setHover(null);
    };
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      const { clientX: x, clientY: y } = event;
      frame = requestAnimationFrame(() => {
        const change = findHoveredChange(highlightsRef.current, x, y);
        setHover(change ? { change, x, y } : null);
      });
    };

    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', clear);
    element.addEventListener('scroll', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      clear();
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', clear);
      element.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, [stage]);

  return createPortal(
    <>
      <div className="change-highlights" aria-hidden="true">
        {highlights.map(({ change, rect }, index) => (
          <span
            key={`${change.id}:${index}`}
            className={`change-highlight ${active === change.id ? 'active' : ''}`}
            data-change-id={change.id}
            style={{ left: rect.left, top: rect.top, width: Math.max(3, rect.width), height: rect.height }}
          />
        ))}
      </div>
      {hover && (
        <div
          className="change-tooltip"
          role="tooltip"
          style={{
            left: Math.max(8, Math.min(hover.x + 16, window.innerWidth - 288)),
            top: Math.max(8, Math.min(hover.y + 18, window.innerHeight - 142)),
          }}
        >
          <strong>{changeAuthor(hover.change)}</strong>
          {hover.change.record.actor?.email && <span>{hover.change.record.actor.email}</span>}
          <span>{changeLabel(hover.change)} · {changeDate(hover.change)}</span>
          {hover.change.contextOnly && <span>Affected paragraph</span>}
        </div>
      )}
    </>,
    document.body,
  );
}

/** Group a version's edits by paragraph and actor; raw records remain unchanged. */
export function groupChanges(
  changes: readonly Change[],
  textAt: (target: TextAddress) => string | null,
): Change[] {
  const groups = new Map<string, Change[]>();
  for (const change of changes) {
    const key = paragraphGroupKey(change);
    const members = groups.get(key) ?? [];
    members.push(change);
    groups.set(key, members);
  }
  return [...groups.values()].map((members) => combineParagraphChanges(members, textAt));
}

/** Validate recorded locations in the saved document, then group the resolved edits. */
export async function resolveSnapshotChanges(
  api: SnapshotApi,
  records: readonly ChangeRecord[],
): Promise<Change[]> {
  const changes = recordChanges(records);
  const blockText = new Map<string, string | null>();

  for (const change of changes) {
    for (const location of change.locations) {
      const key = locationKey(location);
      if (!blockText.has(key)) {
        blockText.set(key, await readBlockText(api, location));
      }
      const content = blockText.get(key);
      if (content === null || content === undefined) continue;

      let range = location.range ?? { start: 0, end: content.length };
      const outsideBlock = range.end > content.length || range.start > content.length;
      const differentText = change.change.kind === 'text' && change.change.inserted
        && content.slice(range.start, range.end) !== change.change.inserted;

      // A removed or replaced span may leave only paragraph context. Never
      // present unrelated characters as an exact match for the original edit.
      if (!location.range || outsideBlock || differentText) {
        range = { start: 0, end: content.length };
        change.contextOnly = true;
      }
      change.targets.push({ kind: 'text', blockId: location.blockId, story: location.story, range });
    }
  }

  return groupChanges(changes, (target) => {
    const content = blockText.get(locationKey(target));
    return content?.slice(target.range.start, target.range.end) ?? null;
  });
}

async function readBlockText(api: SnapshotApi, location: Location): Promise<string | null> {
  for (const nodeType of ['paragraph', 'heading', 'listItem'] as const) {
    try {
      const result = await api.getNode({
        kind: 'block', nodeType, nodeId: location.blockId, story: location.story,
      });
      return nodeText(result.node);
    } catch {
      // Try the other supported text block types before treating it as removed.
    }
  }
  return null;
}

function paragraphGroupKey({ id, record, change }: Change): string {
  if (!('blockId' in change)) return id;

  // Names can collide. Use actor IDs and the complete contributor set.
  const actor = record.actor?.id ?? ['unknown', record.session.id, record.session.clientId];
  const contributors = (record.contributors ?? [])
    .map((actor) => actor.id ?? actor.email ?? actor.name ?? 'unknown')
    .sort();
  return JSON.stringify([actor, contributors, locationKey(change)]);
}

function combineParagraphChanges(members: Change[], textAt: (target: TextAddress) => string | null): Change {
  if (members.length === 1) return members[0];

  const latest = orderChanges(members, 'newest')[0];
  const targets = mergeTargets(members.flatMap((member) => member.targets));
  return {
    ...latest,
    id: members[0].id,
    members,
    targets,
    summary: summarizeChanges(members, targets, textAt),
    locations: members.flatMap((member) => member.locations),
    contextOnly: members.some((member) => member.contextOnly),
  };
}

function mergeTargets(targets: TextAddress[]): TextAddress[] {
  const sorted = [...targets].sort((a, b) => {
    const blockOrder = locationKey(a).localeCompare(locationKey(b));
    return blockOrder || a.range.start - b.range.start;
  });
  const merged: TextAddress[] = [];

  for (const target of sorted) {
    const previous = merged.at(-1);
    const overlaps = previous && locationKey(previous) === locationKey(target)
      && target.range.start <= previous.range.end;
    if (overlaps) {
      previous.range.end = Math.max(previous.range.end, target.range.end);
    } else {
      merged.push({ ...target, range: { ...target.range } });
    }
  }
  return merged;
}

function summarizeChanges(
  members: Change[],
  targets: TextAddress[],
  textAt: (target: TextAddress) => string | null,
): string {
  const visible = targets.map(textAt).filter(Boolean).join(' … ');
  const removed = deletedText(members);
  let excerpt = visible || removed || [...new Set(members.map(changeText))].join(' · ');
  if (visible && removed) excerpt = `${visible} · Deleted: “${removed}”`;

  const details = members
    .filter((member) => member.change.kind === 'format' || member.change.kind === 'paragraph')
    .map(changeText);
  const extraDetails = [...new Set(details)].filter((detail) => !excerpt.includes(detail));
  return [excerpt, ...extraDetails].join(' · ');
}

function deletedText(members: Change[]): string {
  const fragments: string[] = [];
  let previousStart: number | null = null;

  for (const { change } of members) {
    if (change.kind !== 'text' || !change.deleted) {
      previousStart = null;
      continue;
    }
    // Backspace moves left; Delete stays at the same offset. Reassemble both
    // in text order instead of displaying individual deleted characters.
    const last = fragments.length - 1;
    if (previousStart !== null && change.range.start + change.deleted.length === previousStart) {
      fragments[last] = change.deleted + fragments[last];
    } else if (previousStart === change.range.start) {
      fragments[last] += change.deleted;
    } else {
      fragments.push(change.deleted);
    }
    previousStart = change.range.start;
  }
  return fragments.join(' … ');
}

function clipToStage(rect: ViewportRect, bounds: DOMRect): ViewportRect | null {
  const left = Math.max(rect.left, bounds.left);
  const right = Math.min(rect.right, bounds.right);
  const top = Math.max(rect.top, bounds.top);
  const bottom = Math.min(rect.bottom, bounds.bottom);
  if (right < left || bottom <= top) return null;
  return { ...rect, left, right, top, bottom, width: right - left, height: bottom - top };
}

function findHoveredChange(highlights: Highlight[], x: number, y: number): Change | null {
  // Prefer the smallest region when highlights overlap.
  let closest: Highlight | null = null;
  for (const highlight of highlights) {
    const { rect } = highlight;
    const inside = x >= rect.left - 3 && x <= rect.right + 3
      && y >= rect.top - 2 && y <= rect.bottom + 2;
    if (!inside) continue;
    if (!closest || rect.width * rect.height < closest.rect.width * closest.rect.height) {
      closest = highlight;
    }
  }
  return closest?.change ?? null;
}

