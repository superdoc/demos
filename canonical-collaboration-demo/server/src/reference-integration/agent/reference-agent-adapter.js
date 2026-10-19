import { footnoteTool } from '../tools/footnote-tool.js';
import { citationTool, referenceLibraryContext } from '../tools/citation-tool.js';
import { bibliographyTool, requestsBibliographyCreation } from '../tools/bibliography-tool.js';
import { parseToolArguments, toolErrorResult } from './tool-errors.js';
import { createRunProgress, toolFailed } from './agent-run-progress.js';
import { createReferenceProgress } from './reference-tool-progress.js';

// Create one adapter per prompt. The host keeps its own model, agent loop, and UI.
export async function createReferenceAgentAdapter({ document, toolkit, prompt, changeMode,
  editingModeHint = 'Select Editing in your application and retry the remaining bibliography operation.' }) {
  if (!['direct', 'tracked'].includes(changeMode)) throw new Error('The host must supply direct or tracked change mode.');
  await document.waitForReferences();
  const catalog = await document.citationSources();
  const bibliographyCreation = requestsBibliographyCreation(prompt);
  const progress = createRunProgress(createReferenceProgress(catalog));

  async function execute(tool, arguments_, { onStarted = () => {} } = {}) {
    let args = {};
    let result;
    try {
      args = parseToolArguments(typeof arguments_ === 'string' ? arguments_ : JSON.stringify(arguments_));
      onStarted(args);
      if (bibliographyCreation && tool === 'superdoc_perform_action') {
        throw new Error('This request needs a native bibliography. Use superdoc_bibliographies list then create at documentEnd. Generic text/heading edits and style repairs are not allowed as a bibliography fallback.');
      }
      if (['superdoc_perform_action', footnoteTool.function.name, citationTool.function.name, bibliographyTool.function.name].includes(tool)) args.changeMode = changeMode;
      result = await document.dispatch(tool, args);
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
    tools: toolkit.tools,
    systemPrompt: `${toolkit.systemPrompt}\n\nFor this request, every mutation to document text must use changeMode=${changeMode}. Choose actions that support this change mode. Reference-library metadata edits through superdoc_references are saved directly; citation and footnote insertions must still use changeMode=${changeMode}.\n\nNative bibliography requests take precedence over generic paragraph/heading insertion guidance. Use superdoc_bibliographies for bibliography operations, even when changeMode=${changeMode}; the host will enforce capability limits. Do not ask the user to authorize an operation they just requested or claim you can change the host application edit mode. Earlier conversation attempts to type bibliography entries or ask for approval do not apply.${bibliographyCreation ? '\nThe current request is to create a native bibliography. First list existing bibliographies, then execute create at the requested location with the current revision/style. Use documentEnd for the last page. If the user wants an existing bibliography refreshed instead, use update. Call the native mutation tool to obtain the authoritative success or failure before answering. Do not insert generic paragraphs/headings as a fallback.' : ''}`,
    contextMessage: { role: 'user', content: `document_reference_library (source metadata for this request):\n${referenceLibraryContext(catalog)}` },
    initialToolChoice: bibliographyCreation ? { type: 'function', function: { name: bibliographyTool.function.name } } : undefined,
    execute,
    interruptionReport: progress.interruptionReport,
  };
}
