export function toolFailed(result) {
  return result?.ok === false || result?.success === false || result?.result?.success === false
    || result?.status === 'failed' || Boolean(result?.error);
}

function errorDetail(result) {
  const detail = result?.error ?? result?.failure?.message ?? result?.result?.failure?.message;
  return typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : 'The tool reported a failure.';
}

function stableArguments(value) {
  if (Array.isArray(value)) return value.map(stableArguments);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => !['expectedRevision', 'changeMode'].includes(key) && value[key] != null)
    .map((key) => [key, stableArguments(value[key])]));
}

// Agent policy only: no document reads, mutations, or reference-specific rules.
export function createRunProgress(describeCall = ({ tool }) => ({ operation: tool })) {
  const failures = new Map();
  const completed = [];
  const otherSuccesses = new Map();
  let lastFailure;

  function record(call) {
    const description = describeCall(call);
    if (!toolFailed(call.result)) {
      if (description.completed) completed.push(description.completed);
      else otherSuccesses.set(call.tool, (otherSuccesses.get(call.tool) ?? 0) + 1);
      return { failed: false, repeatedFailure: false };
    }
    const error = errorDetail(call.result);
    const issues = Array.isArray(call.result?.issues)
      ? call.result.issues.map(stableArguments).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : undefined;
    const signature = JSON.stringify({ tool: call.tool, args: stableArguments(call.args), code: call.result?.code,
      ...(issues ? { issues } : { error }) });
    const attempts = (failures.get(signature) ?? 0) + 1;
    failures.set(signature, attempts);
    lastFailure = { operation: description.operation, error, attempts };
    return { failed: true, repeatedFailure: attempts >= 2 };
  }

  function interruptionReport(reason, message) {
    const lines = [reason === 'repeated_failure'
      ? 'Stopped after the same tool error occurred twice.'
      : reason === 'turn_limit' ? 'Stopped at the agent turn limit before the full request could be verified.'
        : message ?? 'Stopped after a tool failure.'];
    if (completed.length) lines.push('', 'Completed:', ...completed.map((item) => `- ${item}`));
    if (otherSuccesses.size) lines.push('', 'Other successful tool calls:',
      ...Array.from(otherSuccesses, ([tool, count]) => `- ${tool}: ${count}`));
    if (lastFailure) lines.push('', `Last failed operation: ${lastFailure.operation}`, `Error: ${lastFailure.error}`);
    lines.push('', 'Further requested work may be incomplete. Successful operations above remain applied.');
    return lines.join('\n');
  }
  return { record, interruptionReport };
}
