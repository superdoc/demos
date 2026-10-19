export class ToolInputError extends Error {
  constructor(code, issues, recovery) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join('; '));
    this.code = code;
    this.issues = issues;
    this.recovery = recovery;
  }
}

export function toolErrorResult(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    ...(error instanceof ToolInputError ? { issues: error.issues, recovery: error.recovery } : {}),
  };
}

export function parseToolArguments(json) {
  let args;
  try { args = JSON.parse(json || '{}'); }
  catch {
    throw new ToolInputError('INVALID_TOOL_ARGUMENTS', [{ path: 'arguments', message: 'Must be valid JSON.' }], {
      action: 'correct_arguments', inspectRequired: false,
    });
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolInputError('INVALID_TOOL_ARGUMENTS', [{ path: 'arguments', message: 'Must be a JSON object.' }], {
      action: 'correct_arguments', inspectRequired: false,
    });
  }
  return args;
}
