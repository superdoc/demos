import { useState, type CSSProperties } from 'react';
import { useSuperDocCommand } from 'superdoc/ui/react';
import type { OutlineMode } from '../superdoc/outline';
import { DocumentOutlinePanel } from '../components/DocumentOutline/DocumentOutlinePanel';
import { ViewControls } from './components/topbar/ViewControls';
import type { SelectionCapture } from 'superdoc/ui';
import { SuperDocEditor } from '../superdoc/SuperDocEditor';
import { CommentsRail } from './components/comments/CommentsRail';
import { Topbar } from './components/topbar/Topbar';

export default function App() {
  const [documentVersion, setDocumentVersion] = useState(0);
  const [outlineMode, setOutlineMode] = useState<OutlineMode>('headings');
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [outlineWidth, setOutlineWidth] = useState(360);
  const [resizing, setResizing] = useState(false);
  const ruler = useSuperDocCommand('ruler');
  const rulerVisible = Boolean(ruler.value ?? ruler.active);
  const [pendingComment, setPendingComment] = useState<SelectionCapture | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const highlightedCommentId = hoveredCommentId ?? activeCommentId;

  return (
    <div className="app-shell">
      <Topbar onDocumentReplaced={() => setDocumentVersion((version) => version + 1)} viewControls={<ViewControls outlineVisible={outlineVisible} onOutlineChange={setOutlineVisible} />} />
      <div className={`workspace ${outlineVisible ? 'with-outline' : ''} ${rulerVisible ? '' : 'ruler-hidden'} ${resizing ? 'resizing-outline' : ''}`} style={{ '--outline-width': `${outlineWidth}px` } as CSSProperties}>
        {outlineVisible && <DocumentOutlinePanel mode={outlineMode} onModeChange={setOutlineMode} documentVersion={documentVersion} width={outlineWidth} onResize={setOutlineWidth} onResizing={setResizing} onClose={() => setOutlineVisible(false)} /> }
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
