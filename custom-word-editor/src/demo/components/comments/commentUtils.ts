import type { CommentInfo, WorkflowReceipt } from 'superdoc/ui';

export const resultSucceeded = (result: unknown) =>
  result === true || Boolean(result && typeof result === 'object' && 'success' in result && result.success);

export const receiptMessage = (result: WorkflowReceipt, successMessage: string) => {
  if (resultSucceeded(result)) return successMessage;
  if (result && typeof result === 'object' && 'failure' in result) return result.failure.message;
  return 'That action is not available right now.';
};

export const getCommentId = (comment: CommentInfo) => comment.address.entityId || comment.id;
