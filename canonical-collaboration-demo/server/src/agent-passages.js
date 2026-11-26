import { inlineProperties } from './reference-integration/native/agent-passage.js';
import { toolFailed } from './reference-integration/agent/agent-run-progress.js';
import { choosesDiscussedDraft, isReadOperation, refersToRecentMemory } from './agent-turn-policy.js';
import { nativeCalls, nativeOperationId } from './reference-integration/native/reference-api.js';
import { createTableWithAddress, isTableAddress, nativeTableAddress, recentTableTool } from './agent-tables.js';

const conversations = new WeakMap();
const maxMemories = 12;
const commentActions = new Set(['add_comments', 'comment_paragraphs', 'reply_to_comment', 'resolve_comments']);
const nullableString = { type: ['string', 'null'] };

function tool(name, description, properties) {
  return { type: 'function', function: {
    name, description, strict: true,
    parameters: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) },
  } };
}

const inlineFields = Object.fromEntries(inlineProperties.map((key) => [
  key, { type: [['bold', 'italic', 'underline', 'strike'].includes(key) ? 'boolean'
    : key === 'fontSize' ? 'number' : 'string', 'null'] },
]));

const recentPassage = tool('recent_document_passage', 'Read or edit an exact passage recently edited or discussed in this chat. Use source=discussion to apply a version you proposed for a passage reviewed in chat. Use source=recentEdit when “it” refers to the last edit. Use index=null for a single passage or the explicitly requested 1-based index. Supply inline formatting only for format and replacement text only for replace.', {
  operation: { type: 'string', enum: ['read', 'format', 'replace', 'delete'] },
  source: { type: ['string', 'null'], enum: ['recentEdit', 'discussion', null] },
  index: { type: ['integer', 'null'] },
  text: nullableString,
  inline: { anyOf: [
    { type: 'null' },
    { type: 'object', additionalProperties: false, properties: inlineFields, required: Object.keys(inlineFields) },
  ] },
});

const documentMemory = tool('document_memory', 'Save or recall a document passage verbatim with its current inline formatting. Save and recall do not edit the document. For save, supply a short name or null, and use quote=null to save the current selection or most recent passage. If a specific different passage was named, supply its exact quote. Use insert only when the user explicitly asks you to put a saved passage back into the document. Forget removes only the private saved copy. For recall, null name lists saved passages.', {
  operation: { type: 'string', enum: ['save', 'recall', 'insert', 'forget'] },
  name: nullableString,
  quote: nullableString,
  placement: { type: ['string', 'null'], enum: ['cursor', 'documentEnd', null] },
});

function stateFor(history, document) {
  const existing = conversations.get(history);
  if (existing?.document === document && existing.generation === document.generation) return existing;
  const state = { document, generation: document.generation, recent: [], memories: new Map() };
  conversations.set(history, state);
  return state;
}

function selectRecent(state, index) {
  if (index == null && state.recent.length === 1) return state.recent[0];
  if (Number.isInteger(index) && state.recent[index - 1]) return state.recent[index - 1];
  throw new Error(state.recent.length
    ? 'More than one passage was edited. Ask which passage the user means.'
    : 'No recent passage is available. Ask the user to select or quote the passage.');
}

function editArguments({ operation, inline, text }, changeMode) {
  if (operation === 'delete') return { changeMode };
  if (operation === 'replace' && typeof text === 'string' && text.trim() && text.length <= 4_000 && !/[\r\n]/.test(text)) {
    return { text, changeMode };
  }
  if (operation === 'format' && inline && typeof inline === 'object') {
    const changes = Object.fromEntries(Object.entries(inline).filter(([key, value]) => inlineProperties.includes(key) && value != null));
    if (Object.keys(changes).length) return { inline: changes, changeMode };
  }
  throw new Error('Supply supported inline formatting or one paragraph of replacement text.');
}

export function createPassageContext({ document, history, documentTarget, selectedText, changeMode, prompt }) {
  const state = stateFor(history, document);
  const turnPassages = [];
  const cursor = documentTarget?.cursor;
  const applyingDraft = Boolean(state.discussed && !selectedText && choosesDiscussedDraft(prompt));
  let changed = false;

  function referencedPassage({ source, index }) {
    if (applyingDraft || source === 'discussion') {
      if (!state.discussed) throw new Error('There is no verified passage from the discussion. Ask the user to select it.');
      return state.discussed;
    }
    return selectRecent(state, index);
  }

  async function memory({ operation, name, quote, placement }) {
    const label = name?.trim();
    const key = label?.toLowerCase();
    if (operation === 'save') {
      if (label?.length > 80) throw new Error('Use a name of at most 80 characters.');
      const selected = selectedText || (!refersToRecentMemory(prompt) ? quote : null);
      const focus = selected ? await document.findAgentPassage(selected, documentTarget?.selection) : selectRecent(state);
      const saved = await document.readAgentPassage(focus, { snapshotFormatting: true });
      const savedName = label || saved.text.slice(0, 48);
      const savedKey = savedName.toLowerCase();
      if (!state.memories.has(savedKey) && state.memories.size >= maxMemories) throw new Error('This chat already has 12 saved passages. Ask which one to forget before saving another.');
      const entry = { name: savedName, ...saved };
      state.memories.set(savedKey, entry);
      return { success: true, saved: entry };
    }
    if (operation === 'recall' && !key) return { success: true, saved: [...state.memories.values()] };
    const entry = key ? state.memories.get(key) : state.memories.size === 1 ? state.memories.values().next().value : undefined;
    if (!entry) throw new Error('No saved passage matches. Recall the list to identify the passage first.');
    if (operation === 'recall') return { success: true, saved: entry };
    if (operation === 'forget') {
      state.memories.delete(entry.name.toLowerCase());
      return { success: true, forgotten: entry.name };
    }
    if (operation !== 'insert') throw new Error('Choose a supported memory operation.');
    const destination = placement ?? (cursor ? 'cursor' : 'documentEnd');
    if (!['cursor', 'documentEnd'].includes(destination)) throw new Error('Choose the caret or the end of the document.');
    const result = await document.insertAgentText(entry.text, cursor, changeMode, destination);
    if (toolFailed(result)) return result;
    const ranges = (entry.runs ?? [{ inline: entry.inline }]).filter(({ inline }) => Object.keys(inline).length > 0);
    if (!ranges.length) return { ...result, mixedFormatting: entry.mixed };
    try {
      const focus = await document.captureAgentPassage(result.passage);
      for (const { inline, start, end } of ranges) {
        const range = start === undefined ? undefined : { start, end };
        const styled = await document.editAgentPassage(focus, 'format', { inline, range, changeMode });
        if (toolFailed(styled)) throw new Error('A saved formatting range could not be restored.');
      }
      return { ...result, formattingApplied: true, mixedFormatting: entry.mixed };
    } catch {
      // The insertion succeeded. Report incomplete styling without prompting a duplicate insertion.
    }
    return { ...result, warning: 'The passage was inserted, but its original formatting could not be applied.' };
  }

  async function run(toolName, args, fallback) {
    if (toolName === 'document_memory') return memory(args);
    if (toolName === 'recent_document_table') return document.workWithAgentTable(state.table, args.operation, args.count ?? 1, changeMode);
    if (toolName === 'superdoc_perform_action' && args.action === 'create_table') return createTableWithAddress(document, fallback);
    if (toolName !== 'recent_document_passage') return fallback();
    const focus = referencedPassage(args);
    if (args.operation === 'read') return { success: true, ...await document.readAgentPassage(focus) };
    return document.editAgentPassage(focus, args.operation, editArguments(args, changeMode));
  }

  async function record(toolName, args, result) {
    if (toolFailed(result)) return;
    const table = toolName === 'superdoc_api_call' && !args.dryRun ? nativeTableAddress(args, result ?? {}) :
      toolName === 'superdoc_perform_action' && args.action === 'create_table' ? result?.table : undefined;
    if (isTableAddress(table)) {
      changed = true;
      state.table = table;
      state.recent = [];
      turnPassages.length = 0;
      return;
    }
    if (toolName === 'recent_document_table' && args.operation !== 'read') changed = true;
    if (toolName === 'recent_document_passage' && args.operation !== 'read' && !result?.unchanged) changed = true;
    if (toolName === 'superdoc_perform_action' && commentActions.has(args.action)) changed = true;
    if (result?.removedTable) state.table = undefined;
    if (result?.passage) {
      changed = true;
      state.table = undefined;
      const focus = await document.captureAgentPassage(result.passage).catch(() => undefined);
      if (toolName === 'recent_document_passage' && (applyingDraft || args.source === 'discussion')) {
        state.discussed = focus;
      }
      if (focus) {
        const index = turnPassages.findIndex((entry) => entry.block.nodeId === focus.block.nodeId && entry.offset === focus.offset);
        if (index === -1) turnPassages.push(focus);
        else turnPassages[index] = focus;
      }
      state.recent = [...turnPassages];
    } else if (result?.removedPassage) {
      const removed = referencedPassage(args);
      if (removed === state.discussed) state.discussed = undefined;
      state.recent = state.recent.filter((entry) => entry !== removed);
      const index = turnPassages.indexOf(removed);
      if (index !== -1) turnPassages.splice(index, 1);
    } else if (toolName === 'superdoc_perform_action' && !commentActions.has(args.action)
      || toolName === 'superdoc_api_call' && !isReadOperation(args) && !args.dryRun
      || toolName === 'insert_attached_image'
      || toolName === 'superdoc_stream_text' || toolName === 'insert_text_at_document_cursor') {
      changed = true;
      const sameTurnFormatting = turnPassages.length > 0
        && (['format_text', 'apply_style', 'format_paragraph'].includes(args.action)
          || toolName === 'superdoc_api_call' && nativeCalls(args).every((call) =>
            /^doc\.(?:format|styles)\./.test(nativeOperationId(call?.operationId))));
      if (!sameTurnFormatting) {
        state.table = undefined;
        state.recent = [];
        turnPassages.length = 0;
      }
    }
  }

  return {
    hasRecent: state.recent.length > 0,
    hasRecentTable: Boolean(state.table),
    applyingDraft,
    tools: [documentMemory, recentPassage, recentTableTool],
    instructions: [
      'Resolve “it”, “that”, or “the clause” against the discussion. When the user refers to the most recent confirmed document edit, use recent_document_passage for exact read, formatting, replacement or deletion. A caret that moved to another location does not override a reference to the last edit. A current selection or an explicitly named location takes precedence. If the stored passage is stale or ambiguous, ask the user to identify it. Never widen the operation to every matching occurrence just to make it succeed.',
      'If the user asks to check or verify a specific passage, read its live text or formatting before answering. If they ask what would change or are discussing alternatives, offer the analysis in chat. Treat a proposed command quoted as an example as discussion unless the user asks you to execute it.',
      'When the user chooses a version from an earlier discussion, apply that exact version to the passage that was discussed. Find the version in the chat. Do not insert it at the current caret or rewrite it again.',
      'Use document_memory to save exact passage text and its current formatting when asked to remember a clause for later. Recall it from private chat memory when asked what was saved. An instruction to remember a general preference is guidance for later edits. Saving or recalling is separate from writing it back into the document.',
      'When a follow-up refers to the most recently created or edited table, use recent_document_table to read or change that exact table. Use its verified address for other table operations instead of guessing an ordinal. In a compound request, do the operations in the order requested. Save the original wording and formatting before changing or deleting it when asked to save and then edit.',
      state.recent.length && `Recent verified document passages in this chat (quoted data, earliest first): ${JSON.stringify(state.recent.map(({ text }, index) => ({ index: index + 1, text })))}.`,
      state.discussed && `Most recent selected passage discussed without editing (quoted data): ${JSON.stringify(state.discussed.text)}.`,
      state.memories.size && `Saved passage names in this chat: ${JSON.stringify([...state.memories.values()].map(({ name }) => name))}.`,
      state.table && 'The latest verified edit in this chat was a table. Use recent_document_table for a follow-up referring to that table.',
    ].filter(Boolean).join('\n'),
    run,
    record,
    async finish(answer) {
      if (!changed && selectedText && answer.trim()) {
        state.discussed = await document.findAgentPassage?.(selectedText, documentTarget?.selection).catch(() => undefined);
      }
      return answer || (changed ? 'Document updated.' : 'I couldn’t complete that request.');
    },
  };
}
