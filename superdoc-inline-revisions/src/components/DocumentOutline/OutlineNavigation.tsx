"use client";
import { useEffect, useId, useState } from "react";
function ChevronRight({
  size,
  className,
}: {
  size: number;
  className: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
import {
  outlineTree,
  type OutlineLabel,
  type OutlineNode,
} from "../../superdoc/outline";
export default function OutlineNavigation({
  items,
  activeId,
  disabled,
  onNavigate,
}: {
  items: OutlineLabel[];
  activeId: string | null;
  disabled: boolean;
  onNavigate: (id: string) => void;
}) {
  const prefix = useId();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const index = items.findIndex((item) => item.id === activeId);
    if (index < 0) return;
    let level = items[index].level;
    const ancestors: string[] = [];
    for (let i = index - 1; i >= 0; i--) {
      if (items[i].level < level) {
        ancestors.push(items[i].id);
        level = items[i].level;
      }
    }
    setExpanded((current) => {
      if (ancestors.every((id) => current.has(id))) return current;
      return new Set([...current, ...ancestors]);
    });
  }, [activeId, items]);
  const nodes = outlineTree(items);
  const parents = new Set(
    items
      .filter((item, index) => items[index + 1]?.level > item.level)
      .map((item) => item.id),
  );
  const allOpen =
    parents.size > 0 && [...parents].every((id) => expanded.has(id));
  function branch(list: OutlineNode<OutlineLabel>[]) {
    return list.map(({ item, children }) => {
      const open = expanded.has(item.id),
        childId = `${prefix}-${item.id}`;
      return (
        <li key={item.id}>
          <div className="outline-row">
            {children.length ? (
              <button
                className="outline-toggle"
                aria-label={`${open ? "Collapse" : "Expand"} ${item.text}`}
                aria-expanded={open}
                aria-controls={childId}
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (open) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              >
                <ChevronRight size={14} className={open ? "expanded" : ""} />
              </button>
            ) : (
              <span className="outline-toggle-spacer" />
            )}
            <button
              className={`outline-item-label ${activeId === item.id ? "selected" : ""}`}
              disabled={disabled}
              aria-current={activeId === item.id ? "location" : undefined}
              title={item.text}
              onClick={() => onNavigate(item.id)}
            >
              {item.text}
            </button>
          </div>
          {children.length > 0 && (
            <ul id={childId} hidden={!open}>
              {branch(children)}
            </ul>
          )}
        </li>
      );
    });
  }
  return (
    <nav aria-label="Document sections">
      {parents.size > 0 && (
        <button
          className="outline-expand-all"
          onClick={() => setExpanded(allOpen ? new Set() : parents)}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      )}
      <ul className="outline-tree">{branch(nodes)}</ul>
    </nav>
  );
}
