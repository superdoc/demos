'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import type { OutlineSkeleton } from '../../outline/types';
import './OutlineNavigation.css';

export type OutlineNavigationProps = {
  skeleton: OutlineSkeleton;
  activeId?: string | null;
  disabled?: boolean;
  onNavigate: (id: string) => void;
};

/** Renders a supplied outline skeleton. Does not read or mutate a document. */
export default function OutlineNavigation({ skeleton, activeId = null, disabled = false, onNavigate }: OutlineNavigationProps) {
  const prefix = useId();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const { parents, activeAncestors } = useMemo(() => {
    const parents = new Set<string>();
    let activeAncestors: string[] = [];
    function visit(nodes: OutlineSkeleton, ancestors: string[]) {
      for (const node of nodes) {
        if (node.id === activeId) activeAncestors = ancestors;
        if (node.children.length) {
          parents.add(node.id);
          visit(node.children, [...ancestors, node.id]);
        }
      }
    }
    visit(skeleton, []);
    return { parents, activeAncestors };
  }, [skeleton, activeId]);

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set([...current].filter((id) => parents.has(id)));
      for (const id of activeAncestors) next.add(id);
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [parents, activeAncestors]);

  const allOpen = parents.size > 0 && [...parents].every((id) => expanded.has(id));
  function branch(nodes: OutlineSkeleton) {
    return nodes.map(({ id, text, children }) => {
      const open = expanded.has(id);
      const childId = `${prefix}-${id}`;
      return <li key={id}>
        <div className="outline-row">
          {children.length ? <button
            type="button"
            className="outline-toggle"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${text}`}
            aria-expanded={open}
            aria-controls={childId}
            onClick={() => setExpanded((current) => {
              const next = new Set(current);
              if (open) next.delete(id);
              else next.add(id);
              return next;
            })}
          >
            <svg width="14" height="14" className={open ? 'expanded' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button> : <span className="outline-toggle-spacer" />}
          <button
            type="button"
            className={`outline-item-label ${activeId === id ? 'selected' : ''}`}
            disabled={disabled}
            aria-current={activeId === id ? 'location' : undefined}
            title={text}
            onClick={() => onNavigate(id)}
          >{text}</button>
        </div>
        {children.length > 0 && <ul id={childId} hidden={!open}>{branch(children)}</ul>}
      </li>;
    });
  }

  return <nav aria-label="Document sections">
    {parents.size > 0 && <button type="button" className="outline-expand-all" onClick={() => setExpanded(allOpen ? new Set() : parents)}>{allOpen ? 'Collapse all' : 'Expand all'}</button>}
    <ul className="outline-tree">{branch(skeleton)}</ul>
  </nav>;
}
