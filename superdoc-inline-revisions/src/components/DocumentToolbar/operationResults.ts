export function checkReceipt(result: unknown) {
  if (result === false) throw new Error('This operation is unavailable.');
  if (result && typeof result === 'object' && 'success' in result && result.success === false) {
    const failure = 'failure' in result ? result.failure as { code?: string; message?: string } : undefined;
    if (failure?.code !== 'NO_OP') throw new Error(failure?.message ?? 'The operation could not be applied.');
  }
}
