import { toolFailed } from './agent-run-progress.js';
import { nativeCalls, nativeOperationId } from '../native/reference-api.js';
const quote = value => typeof value === 'string' && value ? JSON.stringify(value) : '(unspecified)';

export function createReferenceProgress(catalog) {
  const titles = new Map(catalog.items.map(source => [source.sourceId, source.fields.title]));
  function describe(call, result) {
    const id = nativeOperationId(call?.operationId);
    const args = call?.args ?? {};
    if (id.startsWith('doc.citations.sources.')) {
      const sourceId = result?.source?.sourceId ?? args.target?.sourceId;
      const title = args.fields?.title ?? args.patch?.title ?? titles.get(sourceId) ?? sourceId;
      if (sourceId && title) titles.set(sourceId, title);
      const verb = { insert: 'Saved', update: 'Updated', remove: 'Deleted' }[id.split('.').at(-1)];
      return { operation: `${id} ${quote(title)}`, completed: verb ? `${verb} reference ${quote(title)}.` : undefined };
    }
    if (id.startsWith('doc.citations.bibliography.')) {
      const verb = { insert: 'Created', configure: 'Updated', rebuild: 'Updated', remove: 'Deleted' }[id.split('.').at(-1)];
      return { operation: id, completed: verb ? `${verb} bibliography.` : undefined };
    }
    return { operation: id || 'superdoc_api_call' };
  }
  return ({ tool, args, result }) => {
    if (tool !== 'superdoc_api_call') return { operation: tool };
    if (Array.isArray(result?.receipts)) {
      const calls = nativeCalls(args);
      const applied = result.receipts.filter(receipt => receipt.ok && !toolFailed(receipt.result)
        && !calls[receipt.index]?.dryRun && !calls[receipt.index]?.args?.dryRun)
        .map(receipt => describe(calls[receipt.index], receipt.result).completed).filter(Boolean);
      const failure = result.receipts.find(receipt => !receipt.ok || toolFailed(receipt.result));
      return { operation: failure ? describe(calls[failure.index], failure.result).operation : 'superdoc_api_call', applied };
    }
    const description = describe(args, result);
    if (toolFailed(result) || args.dryRun || args.args?.dryRun) delete description.completed;
    return description;
  };
}
