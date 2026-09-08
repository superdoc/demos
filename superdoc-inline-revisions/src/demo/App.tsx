import { useState } from 'react';
import type { SelectionCapture } from 'superdoc/ui';
import { SuperDocEditor } from '../superdoc/SuperDocEditor';
import { CommentsRail } from './components/comments/CommentsRail';
import { Topbar } from './components/topbar/Topbar';

export default function App() {
  const [pendingComment, setPendingComment] = useState<SelectionCapture | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const highlightedCommentId = hoveredCommentId ?? activeCommentId;

  return (
    <div className="app-shell">
      <Topbar />
      <div className="workspace">
        <SuperDocEditor
          onStartComment={setPendingComment}
          commentDraftOpen={pendingComment !== null}
          activeCommentId={highlightedCommentId}
          onActiveComment={setActiveCommentId}
          onHoverComment={setHoveredCommentId}
        />
        <CommentsRail
          pending={pendingComment}
          onClosePending={() => setPendingComment(null)}
          activeCommentId={highlightedCommentId}
          focusedCommentId={activeCommentId}
          onActiveComment={setActiveCommentId}
          onHoverComment={setHoveredCommentId}
        />
      </div>
    </div>
  );
}
