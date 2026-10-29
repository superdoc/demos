const pauseCodes = new Set(['STREAM_TARGET_CHANGED', 'STREAM_DOCUMENT_BUSY']);

export class StreamPauseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StreamPauseError';
    this.code = code;
  }
}

export function isStreamPauseError(error) {
  return pauseCodes.has(error?.code);
}

export function targetChanged() {
  return new StreamPauseError('STREAM_TARGET_CHANGED',
    'Agent paused because its target text was changed, deleted, or became ambiguous. Your edits and text already streamed remain in the document. Select the passage you want to continue editing and run the prompt again.');
}
