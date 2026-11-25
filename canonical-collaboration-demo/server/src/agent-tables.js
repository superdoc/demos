import { toolFailed } from './reference-integration/agent/agent-run-progress.js';
import { nativeCalls, nativeOperationId } from './reference-integration/native/reference-api.js';

export const recentTableTool = {
  type: 'function',
  function: {
    name: 'recent_document_table',
    description: 'Read, append blank rows to, or delete the last table this chat created or edited. Use when “it” refers to that table. Read also returns its exact native address for other table operations. Use count=null for read/delete or to add one row.',
    strict: true,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        operation: { type: 'string', enum: ['read', 'addRows', 'delete'] },
        count: { type: ['integer', 'null'] },
      },
      required: ['operation', 'count'],
    },
  },
};

export function isTableAddress(address) {
  return address?.kind === 'block' && address.nodeType === 'table' && typeof address.nodeId === 'string' && Boolean(address.nodeId);
}

export function nativeTableAddress(args, result) {
  const calls = nativeCalls(args);
  const addresses = calls.map((call, index) => {
    if (call?.dryRun || call?.args?.dryRun) return;
    const operation = nativeOperationId(call?.operationId);
    const receipt = Array.isArray(result.receipts) ? result.receipts[index]?.result : result;
    if (!receipt || toolFailed(receipt)) return;
    if (operation === 'doc.create.table') return receipt.table;
    if (operation.startsWith('doc.tables.') && !/\.(?:get\w*|list|delete)$/.test(operation)) return call.args?.target;
  }).filter(isTableAddress);
  return addresses.length === 1 ? addresses[0] : undefined;
}

export async function createTableWithAddress(document, fallback) {
  const before = await document.listAgentTables?.().catch(() => undefined);
  const result = await fallback();
  if (!before || toolFailed(result) || result.preSnapshot?.revision !== before.revision) return result;
  const after = await document.listAgentTables().catch(() => undefined);
  if (!after || result.postSnapshot?.revision !== after.revision) return result;
  const added = after.blocks.filter(({ nodeId }) => !before.blocks.some((block) => block.nodeId === nodeId));
  if (added.length !== 1) return result;
  return { ...result, table: { kind: 'block', nodeType: 'table', nodeId: added[0].nodeId } };
}
