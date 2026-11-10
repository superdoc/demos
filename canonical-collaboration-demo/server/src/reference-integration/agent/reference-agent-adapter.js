import { footnoteTool } from '../tools/footnote-tool.js';
import { citationTool, referenceLibraryContext } from '../tools/citation-tool.js';
import { bibliographyTool, requestsBibliographyCreation } from '../tools/bibliography-tool.js';
import { parseToolArguments, toolErrorResult } from './tool-errors.js';
import { createRunProgress, toolFailed } from './agent-run-progress.js';
import { createReferenceProgress } from './reference-tool-progress.js';
import { nonStreamingTextActions } from './streaming-policy.js';

const commentActions = new Set(['add_comments', 'comment_paragraphs', 'reply_to_comment', 'resolve_comments']);

// Create one adapter per prompt. The host keeps its own model, agent loop, and UI.
export async function createReferenceAgentAdapter({ document, toolkit, prompt, changeMode,
  editingModeHint = 'Select Editing in your application and retry the remaining bibliography operation.' }) {
  if (!['direct', 'tracked'].includes(changeMode)) throw new Error('The host must supply direct or tracked change mode.');
  await document.waitForReferences();
  const catalog = await document.citationSources();
  const bibliographyCreation = requestsBibliographyCreation(prompt);
  const progress = createRunProgress(createReferenceProgress(catalog));
  const reviewingComments = changeMode === 'tracked'
    ? '\n\nREVIEWING MODE: EXPLAIN EACH SUGGESTION\nAfter every proposed document edit, add a comment on the affected passage or paragraph with a brief user-facing rationale explaining why the change helps fulfill the request. Use superdoc_perform_action with action="add_comments", commentText containing one concise sentence, author="Agent", and an inspected selector for the affected block. Comments are annotations and must use changeMode="direct" even while document edits use tracked mode. The host enforces this automatically; do not ask the user to switch editing modes or authorize adding these comments. Earlier conversation claims that Reviewing mode prevents comments are outdated. Do not put the rationale in the document body or provide private internal reasoning. Add the comment immediately after each edit, including after a streamed paragraph finishes, before proceeding to another edit. Each distinct rationale needs its own comment; this overrides general SDK guidance to batch all add_comments calls. Reference-library metadata and comments themselves do not need explanation comments. Do not claim an explanation comment was added unless the comment tool succeeded.'
    : '';

  async function execute(tool, arguments_, { onStarted = () => {}, dispatch = (tool, args, options) => document.dispatch(tool, args, options) } = {}) {
    let args = {};
    let result;
    try {
      args = parseToolArguments(typeof arguments_ === 'string' ? arguments_ : JSON.stringify(arguments_));
      onStarted(args);
      if (bibliographyCreation && ['superdoc_perform_action', 'superdoc_stream_text', 'superdoc_api_call'].includes(tool)) {
        throw new Error('This request needs a native bibliography. Use superdoc_bibliographies list then create at documentEnd. Generic text/heading edits and style repairs are not allowed as a bibliography fallback.');
      }
      if (tool === 'superdoc_perform_action' && nonStreamingTextActions.has(args.action)) {
        throw new Error(`Action ${args.action} is unavailable: document text must stream through superdoc_stream_text. Inspect the target and use one streaming call per paragraph. For headings, stream text then apply_style; for styled prose, stream text then format_text. No changes were made by this rejected call.`);
      }
      if (['superdoc_perform_action', 'superdoc_stream_text', footnoteTool.function.name, citationTool.function.name, bibliographyTool.function.name].includes(tool)) args.changeMode = changeMode;
      if (tool === 'superdoc_perform_action' && commentActions.has(args.action)) args.changeMode = 'direct';
      if (tool === 'superdoc_api_call') {
        const calls = Array.isArray(args.calls) ? args.calls : [args];
        const streamingOps = new Set(['doc.insert', 'doc.replace', 'doc.create.paragraph', 'doc.create.heading', 'doc.blocks.insert', 'doc.mutations.apply', 'doc.diff.apply']);
        if (calls.some(call => streamingOps.has(call.operationId))) {
          throw new Error('Document text must stream through superdoc_stream_text. Use the dedicated structure tools for native structures.');
        }
      }
      result = await dispatch(tool, args, tool === 'superdoc_api_call' && changeMode === 'tracked'
        ? { enforceChangeMode: 'tracked' } : undefined);
    } catch (error) {
      result = toolErrorResult(error);
    }
    const failed = toolFailed(result);
    const outcome = progress.record({ tool, args, result });
    if (outcome.repeatedFailure) return { args, result, failed, stop: 'repeated_failure',
      message: progress.interruptionReport('repeated_failure') };
    if (tool === bibliographyTool.function.name && failed) {
      const detail = result?.error ?? result?.failure?.message ?? result?.result?.failure?.message ?? 'The server could not complete the operation.';
      const message = result?.code === 'BIBLIOGRAPHY_REQUIRES_DIRECT'
        ? `Native bibliography changes require Editing mode. ${editingModeHint}`
        : `The native bibliography operation failed: ${detail}`;
      return { args, result, failed, stop: 'tool_failure', message: progress.interruptionReport('tool_failure', message) };
    }
    return { args, result, failed };
  }

  return {
    streamTextEnabled: !bibliographyCreation,
    tools: toolkit.tools,
    systemPrompt: `${toolkit.systemPrompt}${reviewingComments}\n\nFor this request, every mutation to document text must use changeMode=${changeMode}. Choose actions that support this change mode. Reference-library metadata edits through superdoc_references are saved directly; citation and footnote insertions must still use changeMode=${changeMode}.\n\nNative bibliography requests take precedence over generic paragraph/heading insertion guidance. Use superdoc_bibliographies for bibliography operations, even when changeMode=${changeMode}; the host will enforce capability limits. Do not ask the user to authorize an operation they just requested or claim you can change the host application edit mode. Earlier conversation attempts to type bibliography entries or ask for approval do not apply.${bibliographyCreation ? '\nThe current request is to create a native bibliography. First list existing bibliographies, then execute create at the requested location with the current revision/style. Use documentEnd for the last page. If the user wants an existing bibliography refreshed instead, use update. Call the native mutation tool to obtain the authoritative success or failure before answering. Do not insert generic paragraphs/headings as a fallback.' : ''}`,
    contextMessage: { role: 'user', content: `document_reference_library (source metadata for this request):\n${referenceLibraryContext(catalog)}` },
    initialToolChoice: bibliographyCreation ? { type: 'function', function: { name: bibliographyTool.function.name } } : undefined,
    execute,
    interruptionReport: progress.interruptionReport,
  };
}
