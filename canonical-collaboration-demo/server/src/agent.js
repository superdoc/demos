import OpenAI from 'openai';
import { config } from './config.js';
import { logEvent } from './logging.js';
import { footnoteTool } from './footnote-tool.js';
import { citationTool, referenceLibraryContext } from './citation-tool.js';
import { bibliographyTool, requestsBibliographyCreation } from './bibliography-tool.js';
import { parseToolArguments, toolErrorResult } from './tool-errors.js';
import { createRunProgress, toolFailed } from './agent-run-progress.js';
import { createReferenceProgress } from './reference-tool-progress.js';

const maximumTurns = 12;

export function createDocumentAgent(documents, { client = new OpenAI() } = {}) {
  const openai = client;
  const toolkit = documents.getToolkit();

  async function run(document, prompt, history, isSuggesting, signal, { onToolCall = () => {}, messageId } = {}) {
    const changeMode = isSuggesting ? 'tracked' : 'direct';
    const bibliographyCreation = requestsBibliographyCreation(prompt);
    await document.waitForReferences();
    const catalog = await document.citationSources();
    const referenceLibrary = referenceLibraryContext(catalog);
    const progress = createRunProgress(createReferenceProgress(catalog));
    const messages = [
      {
        role: 'system',
        content: `${toolkit.systemPrompt}\n\nFor this request, every mutation to document text must use changeMode=${changeMode}. Choose actions that support this change mode. Reference-library metadata edits through superdoc_references are saved directly; citation and footnote insertions must still use changeMode=${changeMode}.\n\nNative bibliography requests take precedence over generic paragraph/heading insertion guidance. Use superdoc_bibliographies for bibliography operations, even when changeMode=${changeMode}; the host will enforce capability limits. Do not ask the user to authorize an operation they just requested or claim you can change the Agent edit mode dropdown. Earlier conversation attempts to type bibliography entries or ask for approval do not apply.${bibliographyCreation ? '\nThe current request is to create a native bibliography. First list existing bibliographies, then execute create at the requested location with the current revision/style. Use documentEnd for the last page. If the user wants an existing bibliography refreshed instead, use update. Call the native mutation tool to obtain the authoritative success or failure before answering. Do not insert generic paragraphs/headings as a fallback.' : ''}`,
      },
      ...history.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: `document_reference_library (source metadata for this request):\n${referenceLibrary}` },
      { role: 'user', content: prompt },
    ];
    let fullOutput = '';
    const toolCalls = [];
    function saveAnswer(answer) {
      history.push({ role: 'user', content: prompt }, {
        id: messageId, role: 'assistant', content: answer, toolCalls: toolCalls.map((call) => ({ ...call })),
      });
      return answer;
    }
    logEvent('agent', 'run.started', { changeMode, historyMessages: history.length });

    for (let turn = 1; turn <= maximumTurns; turn += 1) {
      const modelStarted = performance.now();
      const response = await openai.chat.completions.create(
        { model: config.openaiModel, reasoning_effort: 'low', messages, tools: toolkit.tools,
          ...(bibliographyCreation && turn === 1 ? { tool_choice: { type: 'function', function: { name: bibliographyTool.function.name } } } : {}) },
        { signal },
      );
      const choice = response.choices[0].message;
      logEvent('agent', 'model.completed', {
        turn,
        durationMs: Math.round(performance.now() - modelStarted),
        toolCalls: choice.tool_calls?.length ?? 0,
      });
      if (choice.content) fullOutput += choice.content;
      if (!choice.tool_calls?.length) {
        const answer = fullOutput || 'Document updated.';
        logEvent('agent', 'run.completed', { turns: turn, changeMode });
        return saveAnswer(answer);
      }

      messages.push(choice);
      for (const call of choice.tool_calls) {
        if (signal.aborted) throw signal.reason;
        const started = performance.now();
        let args = {};
        let result;
        const toolCall = {
          id: call.id,
          tool: call.function.name,
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        toolCalls.push(toolCall);
        try {
          args = parseToolArguments(call.function.arguments);
          if (typeof args.action === 'string') toolCall.action = args.action;
          onToolCall({ ...toolCall });
          if (bibliographyCreation && call.function.name === 'superdoc_perform_action') {
            throw new Error('This request needs a native bibliography. Use superdoc_bibliographies list then create at documentEnd. Generic text/heading edits and style repairs are not allowed as a bibliography fallback.');
          }
          if (['superdoc_perform_action', footnoteTool.function.name, citationTool.function.name, bibliographyTool.function.name].includes(call.function.name)) args.changeMode = changeMode;
          result = await document.dispatch(call.function.name, args);
        } catch (error) {
          result = toolErrorResult(error);
        }
        toolCall.durationMs = Math.round(performance.now() - started);
        toolCall.status = toolFailed(result) ? 'failed' : 'completed';
        const outcome = progress.record({ tool: call.function.name, args, result });
        onToolCall({ ...toolCall });
        logEvent('agent', 'tool.completed', {
          tool: call.function.name,
          action: args.action,
          changeMode,
          durationMs: Math.round(performance.now() - started),
          status: result?.status ?? result?.ok,
          error: result?.error,
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
        if (outcome.repeatedFailure) {
          logEvent('agent', 'run.repeated_failure', { turns: turn, changeMode, tool: call.function.name });
          return saveAnswer(progress.interruptionReport('repeated_failure'));
        }
        if (call.function.name === bibliographyTool.function.name && toolCall.status === 'failed') {
          const detail = result?.error ?? result?.failure?.message ?? result?.result?.failure?.message ?? 'The server could not complete the operation.';
          const answer = result?.code === 'BIBLIOGRAPHY_REQUIRES_DIRECT'
            ? 'Native bibliography changes require Editing mode. Select Editing in the chat panel’s Agent edit mode dropdown and retry the remaining bibliography operation.'
            : `The native bibliography operation failed: ${detail}`;
          logEvent('agent', 'run.completed', { turns: turn, changeMode, bibliographyFailure: true });
          return saveAnswer(progress.interruptionReport('tool_failure', answer));
        }
      }
    }

    const answer = progress.interruptionReport('turn_limit');
    logEvent('agent', 'run.turn_limit', { turns: maximumTurns, changeMode });
    return saveAnswer(answer);
  }

  return { run };
}
