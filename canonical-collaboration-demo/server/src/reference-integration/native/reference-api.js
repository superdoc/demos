import { toolFailed } from '../agent/agent-run-progress.js';

export const sourceMutations = new Set(['doc.citations.sources.insert', 'doc.citations.sources.update', 'doc.citations.sources.remove']);
export const citationMutations = new Set(['doc.citations.insert', 'doc.citations.update', 'doc.citations.remove']);
export const bibliographyMutations = new Set(['doc.citations.bibliography.insert', 'doc.citations.bibliography.configure', 'doc.citations.bibliography.rebuild', 'doc.citations.bibliography.remove']);
export const nativeOperationId = value => typeof value === 'string' ? (value.trim().startsWith('doc.') ? value.trim() : `doc.${value.trim()}`) : '';
export const nativeCalls = args => Array.isArray(args?.calls) ? args.calls : [args];

export async function assertSourceUncited(handle, sourceId) {
  for (let offset = 0; ;) {
    const page = await handle.citations.list({ limit: 100, offset });
    if (page.items.some(item => item.sourceIds?.includes(sourceId))) throw new Error('This reference is still cited in the document. Remove its citations before deleting the source.');
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return;
  }
}

function guardedHandle(handle, onBibliographyFallback) {
  // Keep the SDK's ordered batch execution and validation. The removal policy
  // runs at invocation time, so an earlier citation in the same batch counts.
  const sources = new Proxy(handle.citations.sources, { get(target, key) {
    if (key === 'remove') return async (args, options) => {
      await assertSourceUncited(handle, args.target?.sourceId);
      return target.remove(args, options);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const bibliography = handle.citations.bibliography && new Proxy(handle.citations.bibliography, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (['configure', 'rebuild', 'remove'].includes(key)) return async (args, options) => {
      try { return await value.call(target, args, options); }
      catch (error) {
        // CSL rendering uses complex Word fields. The native API currently
        // refuses these before mutation; retain the proven app fallback here.
        if (error.code !== 'CAPABILITY_UNAVAILABLE' || !/requires an independent simple field|requires a paragraph containing only its generated field/.test(error.message)
          || args.dryRun || options?.dryRun) throw error;
        return onBibliographyFallback(key, args);
      }
    };
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const citations = new Proxy(handle.citations, { get(target, key) {
    const value = key === 'sources' ? sources : key === 'bibliography' ? bibliography : Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return new Proxy(handle, { get(target, key) {
    const value = key === 'citations' ? citations : Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

export function createReferenceApi({ handle, toolkit, withMutation, onChanged, onBibliographyFallback }) {
  return async (args, options) => {
    const calls = nativeCalls(args);
    const hasSources = calls.some(call => sourceMutations.has(nativeOperationId(call?.operationId)));
    const hasCitations = calls.some(call => citationMutations.has(nativeOperationId(call?.operationId)));
    const hasBibliographies = calls.some(call => bibliographyMutations.has(nativeOperationId(call?.operationId)));
    if (!hasSources && !hasBibliographies && !hasCitations) return toolkit.dispatch(handle, 'superdoc_api_call', args, options);
    return withMutation(async () => {
      let governed = structuredClone(args);
      let policy = options;
      if (hasSources) {
        for (const call of nativeCalls(governed)) {
          if (!sourceMutations.has(nativeOperationId(call?.operationId))) continue;
          call.changeMode = 'direct';
          call.args = { ...call.args, changeMode: 'direct' };
        }
        if (options?.enforceChangeMode === 'tracked') {
          // The SDK's direct-operation escape hatch is all-or-nothing. Admit
          // source metadata only after preflighting EVERY batch entry against
          // the SDK catalog; other direct-only operations must still be refused.
          for (const call of calls) {
            const operationId = nativeOperationId(call?.operationId);
            const { operation } = await toolkit.dispatch(handle, 'superdoc_api_search', { operationId });
            if (!operation) throw new Error(`Unknown native operation: ${operationId}`);
            if (operation.mutates && !operation.supportsTrackedMode && !sourceMutations.has(operationId)) {
              throw new Error(`${operationId} is refused under enforceChangeMode: "tracked". Nothing was changed.`);
            }
          }
          policy = { ...options, allowDirectActions: ['*'] };
        }
      }
      const guarded = hasSources || hasBibliographies ? guardedHandle(handle, onBibliographyFallback) : handle;
      const result = await toolkit.dispatch(guarded, 'superdoc_api_call', governed, policy);
      const changes = Array.isArray(result?.receipts)
        ? result.receipts.filter(receipt => receipt.ok && !toolFailed(receipt.result)).map(receipt => nativeCalls(governed)[receipt.index])
        : toolFailed(result) ? [] : nativeCalls(governed);
      const writes = changes.filter(call => call && call.dryRun !== true && call.args?.dryRun !== true
        && (sourceMutations.has(nativeOperationId(call.operationId)) || citationMutations.has(nativeOperationId(call.operationId)) || bibliographyMutations.has(nativeOperationId(call.operationId))));
      if (writes.length) {
        try { await onChanged(writes); }
        catch (error) {
          return { ...result, formattingWarning: `Native reference changes were applied, but formatting could not be refreshed: ${error.message}. Do not repeat a completed mutation.` };
        }
      }
      return result;
    });
  };
}
