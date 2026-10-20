import { useId, useState } from 'react';
import type { ToolCall } from '../types';

export function ToolCallsBubble({ calls }: { calls?: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!calls?.length) return null;
  const canExpand = calls.length > 4;

  return (
    <button type="button" className={`tool-calls-bubble${canExpand ? ' is-expandable' : ''}`}
      aria-expanded={canExpand ? expanded : undefined} aria-controls={listId}
      aria-label={canExpand ? `${expanded ? 'Collapse' : 'Expand'} ${calls.length} tool calls` : `${calls.length} tool calls`}
      onClick={() => { if (canExpand) setExpanded((current) => !current); }}>
      <span className="tool-calls-heading">
        <span>Tool calls <span className="tool-calls-count">{calls.length}</span></span>
        {canExpand && <svg aria-hidden="true" viewBox="0 0 20 20" className={expanded ? 'is-expanded' : undefined}>
          <path d="m5 7.5 5 5 5-5" />
        </svg>}
      </span>
      <span id={listId} role="list" aria-label="Tool calls, newest first"
        className={`tool-calls-list${canExpand && !expanded ? ' is-clipped' : ''}`}>
        {[...calls].reverse().map((call) => (
          <span role="listitem" className="tool-call-row" key={call.id}>
            <span className={`tool-call-icon ${call.status}`} aria-hidden="true">
              {call.status === 'running' ? <span className="spinner" /> : <svg viewBox="0 0 20 20">
                {call.status === 'failed' ? <path d="m6 6 8 8M14 6l-8 8" /> : <path d="m4 10 4 4 8-8" />}
              </svg>}
            </span>
            <span className="tool-call-detail">
              <span className="tool-call-name" title={call.action ? `${call.tool}: ${call.action}` : call.tool}>{call.action || call.tool}</span>
              <span className="tool-call-meta">
                {call.status === 'running' ? 'Running' : call.status === 'failed' ? 'Failed' : 'Completed'}
                {call.durationMs !== undefined && ` · ${call.durationMs < 1000 ? `${call.durationMs} ms` : `${(call.durationMs / 1000).toFixed(1)} s`}`}
              </span>
            </span>
          </span>
        ))}
      </span>
    </button>
  );
}
