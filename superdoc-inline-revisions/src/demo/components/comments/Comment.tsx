import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { CommentInfo } from 'superdoc/ui';
import { useSuperDocUI } from 'superdoc/ui/react';
import { getCommentId, receiptMessage, resultSucceeded } from './commentUtils';

// Produces the short author label displayed inside each circular avatar.
const initials = (name?: string) =>
  (name || 'Reviewer').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

// Converts SuperDoc timestamps into the compact date shown beside an author.
const formatDate = (value?: number | string) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function CommentCard({
  item,
  replies,
  active,
  style,
  onActivate,
  onHover,
}: {
  item: CommentInfo;
  replies: readonly CommentInfo[];
  active: boolean;
  style?: CSSProperties;
  onActivate: (commentId: string) => void;
  onHover: (commentId: string | null) => void;
}) {
  const ui = useSuperDocUI();
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('');
  const name = item.creatorName || 'Reviewer';
  const commentId = getCommentId(item);

  // Reports which card was clicked. The rail owns document navigation,
  // card alignment, and synchronization with SuperDoc's active comment.
  const focus = () => {
    onActivate(commentId);
  };

  // Sends the reply text to SuperDoc, reports the result below the composer,
  // and clears the input only after a successful submission.
  const submitReply = async () => {
    if (!ui || !reply.trim()) return;
    const result = await Promise.resolve(ui.comments.reply(commentId, { text: reply.trim() }));
    setStatus(receiptMessage(result, 'Reply added.'));
    if (resultSucceeded(result)) setReply('');
  };

  // Controls the Resolve/Reopen action and updates the card feedback message
  // after SuperDoc finishes the requested thread status transition.
  const toggleResolved = async () => {
    if (!ui) return;
    const result = await Promise.resolve(
      item.status === 'resolved' ? ui.comments.reopen(commentId) : ui.comments.resolve(commentId),
    );
    setStatus(receiptMessage(result, item.status === 'resolved' ? 'Comment reopened.' : 'Comment resolved.'));
  };

  return (
    <article
      className={`review-card anchored-comment ${active ? 'is-active' : ''}`}
      data-comment-id={commentId}
      style={style}
      onClick={focus}
      onPointerEnter={() => onHover(commentId)}
      onPointerLeave={() => onHover(null)}
    >
      {/* Comment author, timestamp, and resolve action */}
      <div className="card-heading">
        <span className="avatar">{initials(name)}</span>

        <div className="identity">
          <strong>{name}</strong>
          <span>{formatDate(item.createdTime) || 'Open thread'}</span>
        </div>

        {/* Resolve or reopen button */}
        <button
          className="quiet-button"
          onClick={(event) => {
            event.stopPropagation();
            void toggleResolved();
          }}
        >
          {item.status === 'resolved' ? 'Reopen' : 'Resolve'}
        </button>
      </div>

      {/* Text range in the document associated with this thread */}
      {item.anchoredText ? <blockquote>{item.anchoredText}</blockquote> : null}

      {/* Parent comment message */}
      <p>{item.text || 'Untitled comment'}</p>

      {/* Replies displayed under the parent comment */}
      {replies.length ? (
        <div className="thread-replies">
          {replies.map((threadReply) => {
            const replyName = threadReply.creatorName || 'Reviewer';

            return (
              <div className="thread-reply" key={getCommentId(threadReply)}>
                <span className="avatar">{initials(replyName)}</span>

                <div>
                  <strong>{replyName}</strong>
                  <span>{formatDate(threadReply.createdTime)}</span>
                  <p>{threadReply.text || 'Untitled reply'}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Reply composer */}
      <div className="reply-row" onClick={(event) => event.stopPropagation()}>
        {/* Reply text input */}
        <input
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void submitReply(); }}
          placeholder="Reply"
          aria-label={`Reply to ${name}`}
        />

        {/* Send reply button */}
        <button
          onClick={() => void submitReply()}
          disabled={!reply.trim()}
          aria-label="Send reply"
        >
          ↗
        </button>
      </div>

      {/* Success or failure feedback for comment actions */}
      {status ? <span className="action-status">{status}</span> : null}
    </article>
  );
}
