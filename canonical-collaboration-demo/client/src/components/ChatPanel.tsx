const demoMetric = (action: string, capability = 'document') => { try { window.dispatchEvent(new CustomEvent('superdoc:demo', { detail: { action, capability } })); } catch { /* Analytics must not affect the demo. */ } };
import { FormEvent, KeyboardEvent, PointerEvent, useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { SuperDoc } from 'superdoc';
import type { SelectionSlice, SelectionTarget } from 'superdoc/ui';
import { api } from '../api';
import type { AttachmentPreview, ChatMessage, Job, PromptDocumentTarget } from '../types';
import { AgentAttachment, encodeAttachment, type DraftAttachment } from './AgentAttachment';
import { AgentSelectionPreview } from './AgentSelectionPreview';
import { useAgentSpeech } from './useAgentSpeech';
import { usePromptDictation } from './usePromptDictation';

type ChatPanelProps = {
  hidden?: boolean;
  agentName?: string;
  agentModel?: string;
  roomId: string;
  disabled: boolean;
  unavailableReason?: string;
  width: number;
  onWidthChange: (width: number) => void;
  reservedWidth?: number;
  onDocumentUpdated?: () => void;
  superdoc?: SuperDoc;
  documentTarget?: Pick<PromptDocumentTarget, 'id' | 'generation'>;
  documentKey?: string;
};

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const MIN_CHAT_WIDTH = 280;
const MAX_CHAT_WIDTH = 720;
const DOCUMENT_RESIZE_SPACE = 680;

function MarkdownMessage({ content }: { content: string }) {
  return <div className="message-markdown"><Markdown>{content}</Markdown></div>;
}

function CopyMessageButton({ content }: { content: string }) {
  const [copiedAt, setCopiedAt] = useState<number>();
  const copied = copiedAt !== undefined;
  const label = copied ? 'Copied' : 'Copy message';

  useEffect(() => {
    if (copiedAt === undefined) return;
    const timer = window.setTimeout(() => setCopiedAt(undefined), Math.max(0, copiedAt + 1_000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [copiedAt]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedAt(Date.now());
    } catch {
      // Show confirmation only after a successful clipboard write.
    }
  }

  return (
    <button
      className="copy-message"
      type="button"
      aria-label={label}
      title={label}
      data-copied={copied || undefined}
      onClick={copy}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        {copied ? <path d="m5 12 4 4L19 6" />
          : <path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />}
      </svg>
    </button>
  );
}

const DEFAULT_AGENT_NAME = 'Agentic Collaborator';
function welcomeMessage(name?: string) {
  const greeting = name ? `Hi, I’m ${name}, your agentic collaborator.` : 'Hi, I’m your agentic collaborator.';
  return `${greeting} How would you like to work on this document? I can review it with you, suggest edits, or make changes directly.`;
}

function AttachmentThumbnail({ attachment }: { attachment: AttachmentPreview }) {
  return (
    <figure className="message-attachment">
      {attachment.thumbnail ? <img src={attachment.thumbnail} alt={attachment.name} />
        : <span className="message-attachment-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M13 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9L13 3.5Z" />
            <path d="M13 3.5v6h6M9 13.5h6M9 17h6" />
          </svg>
        </span>}
      <figcaption title={attachment.name}>{attachment.name}</figcaption>
    </figure>
  );
}

function ChatMessageBubble({ role, content, attachmentPreview, agentName = DEFAULT_AGENT_NAME, working }: ChatMessage & { agentName?: string; working?: boolean }) {
  return (
    <article className={`message ${role}`}>
      {content && <CopyMessageButton content={content} />}
      <span className="message-role">{role === 'user' ? 'You' : agentName}</span>
      {attachmentPreview && <AttachmentThumbnail attachment={attachmentPreview} />}
      {content && <MarkdownMessage content={content} />}
      {working && <div className="agent-working" role="status">
        <span className="visually-hidden">{agentName} is working.</span>
        <span className="agent-butterfly" aria-hidden="true">
          <span className="agent-butterfly-wing" />
          <span className="agent-butterfly-wing agent-butterfly-wing-right" />
          <span className="agent-butterfly-body" />
        </span>
      </div>}
    </article>
  );
}

function jobReply(job: Job) {
  if (job.status === 'failed') {
    return job.error && /^(Could not read the attachment|The attachment )/.test(job.error)
      ? job.error : 'I couldn’t finish that request. Please try again.';
  }
  if (job.status === 'cancelled') {
    return job.answer ? `${job.answer}\n\nI stopped here.` : 'I stopped working on that request.';
  }
  return job.answer;
}

function JobReply({ job, agentName }: { job: Job; agentName: string }) {
  return (
    <ChatMessageBubble role="assistant" agentName={agentName} content={jobReply(job) ?? ''}
      working={!TERMINAL.has(job.status)} />
  );
}

export function ChatPanel({ roomId, disabled, unavailableReason, width, onWidthChange, reservedWidth = 0, onDocumentUpdated, hidden = false, agentName, agentModel, superdoc, documentTarget, documentKey }: ChatPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [attachment, setAttachment] = useState<DraftAttachment>();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const cursorRef = useRef<SelectionTarget | null>(null);
  const [selection, setSelection] = useState<Pick<SelectionSlice, 'quotedText' | 'tableSelection' | 'selectionTarget'>>();
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, AttachmentPreview>>({});
  const attachmentStorageKey = `agent-attachment-previews:${roomId}:${documentKey ?? ''}`;
  const [error, setError] = useState<string>();
  const historyRef = useRef<HTMLDivElement>(null);
  const submittedPromptsRef = useRef<string[] | null>(null);
  const promptNavigationRef = useRef<{ prompts: string[]; index: number; draft: string } | null>(null);
  const resizeStartRef = useRef<{ x: number; width: number } | undefined>(undefined);
  const streamRef = useRef<AbortController | undefined>(undefined);
  const activeJob = jobs.find((job) => !TERMINAL.has(job.status));
  const reservedSpace = DOCUMENT_RESIZE_SPACE + reservedWidth;

  const speech = useAgentSpeech(roomId);
  const dictation = usePromptDictation(roomId, documentKey, (text) => {
    if (voiceModeRef.current) void sendPrompt(text, { fromVoice: true });
  }, (message) => {
    stopVoiceMode();
    setError(message);
  });
  const cancelDictation = dictation.cancel;
  const stopSpeech = speech.stop;
  const stopVoiceMode = useCallback(() => {
    voiceModeRef.current = false;
    setVoiceMode(false);
    cancelDictation();
    stopSpeech();
  }, [cancelDictation, stopSpeech]);

  const composerBusy = disabled || submitting || Boolean(activeJob);
  const canRecord = !composerBusy && !unavailableReason;
  const recordingStatus = {
    idle: undefined, requesting: 'Waiting for microphone access…', listening: 'Listening…', transcribing: 'Transcribing…',
  }[dictation.status];
  const voiceStatus = voiceMode && (speech.speaking ? `${agentName ?? DEFAULT_AGENT_NAME} is speaking…`
    : recordingStatus ?? (composerBusy ? 'Voice mode on' : 'Getting ready to listen…'));

  useLayoutEffect(() => { stopVoiceMode(); }, [roomId, documentKey, hidden, unavailableReason, stopVoiceMode]);

  const startVoiceRecording = useEffectEvent(() => { void dictation.start(); });
  useEffect(() => {
    if (!voiceMode) return;
    if (disabled && dictation.status !== 'idle') cancelDictation();
    if (canRecord && !speech.speaking && dictation.status === 'idle') startVoiceRecording();
  }, [voiceMode, disabled, canRecord, speech.speaking, dictation.status, cancelDictation]);

  function voiceError() {
    stopVoiceMode();
    setError('OpenAI voice playback is unavailable. You can keep chatting here.');
  }

  useEffect(() => {
    setAttachment(undefined);
    cursorRef.current = null;
    setSelection(undefined);
    if (!superdoc) return;
    const clear = () => { cursorRef.current = null; setSelection(undefined); };
    const unsubscribe = superdoc.ui.selection.subscribe(({ snapshot }) => {
      // Wait for the editor's plain-text read, and retain it when focus moves
      // into the prompt. A collapsed document selection clears the target.
      if (snapshot.status === 'ready') {
        if (snapshot.selectionTarget) cursorRef.current = snapshot.empty ? snapshot.selectionTarget : null;
        setSelection(snapshot.empty ? undefined : {
          quotedText: snapshot.quotedText,
          selectionTarget: snapshot.selectionTarget,
          tableSelection: snapshot.tableSelection?.selectionMode === 'cells' ? snapshot.tableSelection : undefined,
        });
      }
    });
    superdoc.on('document-replaced', clear);
    return () => {
      unsubscribe();
      superdoc.off('document-replaced', clear);
    };
  }, [superdoc, documentKey]);

  function startResize(event: PointerEvent<HTMLDivElement>) {
    resizeStartRef.current = { x: event.clientX, width: event.currentTarget.parentElement?.offsetWidth ?? width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    const maximum = Math.min(MAX_CHAT_WIDTH, window.innerWidth - reservedSpace);
    onWidthChange(Math.max(MIN_CHAT_WIDTH, Math.min(maximum, start.width + start.x - event.clientX)));
  }

  function stopResize(event: PointerEvent<HTMLDivElement>) {
    resizeStartRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [jobs, messages, hidden]);

  async function refreshHistory(signal: AbortSignal) {
    try {
      const history = await api.getChatHistory(roomId, signal);
      if (signal.aborted) return;
      setMessages(history);
      if (submittedPromptsRef.current === null) {
        submittedPromptsRef.current = history.filter((message) => message.role === 'user').map((message) => message.content);
      }
    } catch (caught) {
      if (!signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    setJobs([]);
    setMessages([]);
    setError(undefined);
    submittedPromptsRef.current = null;
    promptNavigationRef.current = null;
    return () => { streamRef.current?.abort(); streamRef.current = undefined; };
  }, [roomId, documentKey]);

  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    void refreshHistory(controller.signal);
    return () => controller.abort();
  }, [disabled, roomId, documentKey]);

  useEffect(() => {
    try {
      setAttachmentPreviews(JSON.parse(sessionStorage.getItem(attachmentStorageKey) ?? '{}') ?? {});
    } catch {
      setAttachmentPreviews({});
    }
  }, [attachmentStorageKey]);

  async function finishJob(job: Job, signal: AbortSignal) {
    onDocumentUpdated?.();
    if (job.status === 'failed') demoMetric('ai_failed', 'collaboration');
    if (job.status === 'completed') {
      demoMetric('ai_succeeded', 'collaboration');
      const history = await api.getChatHistory(roomId, signal);
      if (signal.aborted) return;
      setMessages(history);
      setJobs((current) => current.filter((candidate) => candidate.id !== job.id));
    }
  }

  async function watchJob(initialJob: Job) {
    let job = initialJob;
    let spokenPrefix = '';
    const controller = new AbortController();
    const { signal } = controller;
    streamRef.current = controller;
    function readReply(reply: string | null | undefined, final: boolean) {
      if (!voiceModeRef.current || !reply) return;
      const offset = reply.startsWith(spokenPrefix) ? spokenPrefix.length : 0;
      const unread = reply.slice(offset);
      // Play whole sentences as they arrive and read any remaining text at completion.
      const sentence = final ? undefined : [...unread.matchAll(/[.!?][”’"')\]]*(?=\s)/g)].at(-1);
      const boundary = final ? unread.length : sentence && sentence.index + sentence[0].length;
      if (!boundary) return;
      spokenPrefix = reply.slice(0, offset + boundary);
      speech.speak(job.id, unread.slice(0, boundary), voiceError);
    }
    function update(next: Job) {
      job = next;
      setJobs((current) => current.map((candidate) => (candidate.id === job.id ? job : candidate)));
      if (!TERMINAL.has(job.status)) readReply(job.answer, false);
    }

    try {
      update(initialJob);
      if (!TERMINAL.has(job.status)) {
        try {
          await api.watchJob(roomId, job.id, update, signal);
        } catch {
          // Poll if the connection drops or streaming is unavailable.
        }
      }
      while (!signal.aborted && !TERMINAL.has(job.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        if (!signal.aborted) update(await api.getJob(roomId, job.id, signal));
      }
      if (!signal.aborted) {
        readReply(jobReply(job), true);
        await finishJob(job, signal);
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      if (streamRef.current === controller) streamRef.current = undefined;
    }
  }

  async function captureDocumentTarget(): Promise<PromptDocumentTarget | undefined> {
    if (!documentTarget) return;
    const doc = superdoc?.activeEditor?.doc;
    if (!doc) return documentTarget;
    try {
      const selection = await doc.selection.current();
      const caret = selection.empty ? selection.selectionTarget ?? cursorRef.current : null;
      const point = caret?.end;
      if (point?.kind !== 'text' || caret?.coordinateSpace === 'tracked') return documentTarget;
      const story = point.story ?? caret?.story;
      if (story && story.storyType !== 'body') return documentTarget;
      const { node } = await doc.getNodeById({ nodeId: point.blockId });
      const inlines = node.kind === 'paragraph' ? node.paragraph.inlines : node.kind === 'heading' ? node.heading.inlines : undefined;
      if (!Array.isArray(inlines)) return documentTarget;
      const paragraph = JSON.stringify(inlines);
      if (paragraph.length > 100_000) return documentTarget;
      return { ...documentTarget, cursor: { blockId: point.blockId, offset: point.offset, paragraph } };
    } catch {
      return documentTarget;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (activeJob) {
      try {
        const cancelled = await api.cancelJob(roomId, activeJob.id);
        setJobs((current) => current.map((job) => (job.id === cancelled.id ? cancelled : job)));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      return;
    }
    await sendPrompt(prompt.trim());
  }

  async function sendPrompt(message: string, { fromVoice = false, reusablePrompt = false } = {}) {
    if (composerBusy || submittingRef.current || unavailableReason || !message) return;
    submittingRef.current = true;
    setError(undefined);
    setSubmitting(true);
    if (voiceModeRef.current) {
      cancelDictation();
      speech.clear();
    }
    let job: Job;
    try {
      const [target, encoded] = await Promise.all([
        reusablePrompt ? documentTarget : captureDocumentTarget(),
        !reusablePrompt && attachment ? encodeAttachment(attachment) : undefined,
      ]);
      demoMetric('ai_started', 'collaboration');
      job = await (reusablePrompt
        ? api.createJob(roomId, message, false, undefined, target, undefined, true)
        : api.createJob(roomId, message, isSuggesting, selection?.quotedText || undefined, target, encoded));
      if (encoded && !job.attachmentPreview) {
        const { name, kind, thumbnail } = encoded;
        const previews = { ...attachmentPreviews, [job.id]: { name, kind, thumbnail } };
        setAttachmentPreviews(previews);
        try {
          sessionStorage.setItem(attachmentStorageKey, JSON.stringify(previews));
        } catch { /* The preview still works in the open chat if storage is unavailable. */ }
      }
      if (!reusablePrompt) {
        submittedPromptsRef.current ??= messages.filter((entry) => entry.role === 'user').map((entry) => entry.content);
        submittedPromptsRef.current.push(message);
        promptNavigationRef.current = null;
        if (!fromVoice) setPrompt('');
        setAttachment(undefined);
      }
      setJobs((current) => [...current, job]);
    } catch (caught) {
      demoMetric('ai_failed', 'collaboration');
      if (fromVoice) {
        stopVoiceMode();
        setPrompt((current) => current.trim() ? `${current.trimEnd()} ${message}` : message);
      }
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    try {
      await watchJob(job);
    } catch (caught) {
      demoMetric('ai_failed', 'collaboration');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown')
      && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      let navigation = promptNavigationRef.current;
      if (!navigation) {
        if (prompt.trim() || event.key === 'ArrowDown') return;
        const prompts = (submittedPromptsRef.current ?? []).filter((value) => value.trim());
        if (!prompts.length) return;
        navigation = { prompts, index: prompts.length, draft: prompt };
        promptNavigationRef.current = navigation;
      }
      event.preventDefault();
      navigation.index = Math.max(0, Math.min(navigation.prompts.length, navigation.index + (event.key === 'ArrowUp' ? -1 : 1)));
      setPrompt(navigation.prompts[navigation.index] ?? navigation.draft);
      if (navigation.index === navigation.prompts.length) promptNavigationRef.current = null;
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) promptNavigationRef.current = null;
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <aside id="agent-panel" className="chat-panel" aria-label="Agent chat" hidden={hidden}
      style={{ width, maxWidth: `max(${MIN_CHAT_WIDTH}px, calc(100vw - ${reservedSpace}px))` }}>
      <div
        className="chat-resize-handle"
        role="separator"
        aria-label="Resize chat panel"
        aria-orientation="vertical"
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
      />
      <div ref={historyRef} className="chat-history">
        {(agentName || unavailableReason) && <ChatMessageBubble role="assistant" agentName={agentName} content={welcomeMessage(agentName)} />}
        {messages.map((message, index) => {
          // The room history stores the job ID on the reply after its user prompt.
          const reply = messages[index + 1];
          const jobId = message.role === 'user' && reply?.role === 'assistant' ? reply.id : undefined;
          const preview = message.attachmentPreview ?? (jobId ? attachmentPreviews[jobId] : undefined);
          return <ChatMessageBubble key={message.id ?? `${message.role}-${index}`} {...message} agentName={agentName} attachmentPreview={preview} />;
        })}
        {jobs.map((job) => (
          <div className="message-turn" key={job.id}>
            <ChatMessageBubble role="user" content={job.prompt} attachmentPreview={job.attachmentPreview ?? attachmentPreviews[job.id]} />
            <JobReply job={job} agentName={agentName ?? DEFAULT_AGENT_NAME} />
          </div>
        ))}
      </div>

      <form onSubmit={submit}>
        {unavailableReason && <p className="agent-unavailable" role="status">{unavailableReason}</p>}
        {selection && <AgentSelectionPreview doc={superdoc?.activeEditor?.doc} text={selection.quotedText}
          table={selection.tableSelection} target={selection.selectionTarget} onClear={() => setSelection(undefined)} />}
        <div className="prompt-options">
          <button type="button" className="reusable-prompt-button"
            disabled={composerBusy || Boolean(unavailableReason) || !documentTarget}
            onClick={() => void sendPrompt('Create a reusable prompt', { reusablePrompt: true })}>
            Create reusable prompt
          </button>
          <div className="agent-mode-select">
            <select
              aria-label="Agent edit mode"
              value={isSuggesting ? 'suggestion' : 'direct'}
              disabled={composerBusy}
              onChange={(event) => setIsSuggesting(event.target.value === 'suggestion')}
            >
              <option value="suggestion">Agent is reviewing</option>
              <option value="direct">Agent is editing</option>
            </select>
          </div>
        </div>
        <div className="agent-composer">
          {attachment && <div className="agent-attachment-chip">
            <span title={attachment.file.name}>{attachment.file.name}</span>
            <button type="button" aria-label="Remove attachment" disabled={composerBusy} onClick={() => setAttachment(undefined)}>×</button>
          </div>}
          <textarea
            aria-label="Prompt"
            value={prompt}
            onChange={(event) => { promptNavigationRef.current = null; setPrompt(event.target.value); }}
            onClick={() => { promptNavigationRef.current = null; }}
            onKeyDown={handlePromptKeyDown}
            placeholder={isSuggesting
              ? 'Enter a prompt for your agent to apply as a suggestion.'
              : 'Enter a prompt for your agent to apply as a direct edit.'}
            disabled={composerBusy}
          />
          <div className="agent-composer-actions">
            <AgentAttachment disabled={composerBusy} onChoose={(value) => { setAttachment(value); setError(undefined); }} onError={setError} />
            <button className={activeJob ? 'stop-agent' : undefined}
              disabled={disabled || (!activeJob && (submitting || Boolean(unavailableReason) || !prompt.trim()))}>
              {activeJob ? 'Stop' : 'Send'}
            </button>
            <div className="agent-composer-trailing">
              {agentModel && <span className="agent-model" title={agentModel}>{agentModel}</span>}
              <button type="button" className="agent-composer-icon agent-voice" aria-label="Voice mode"
                title={voiceMode ? 'Turn off voice mode' : 'Turn on voice mode with synthesized OpenAI speech'} aria-pressed={voiceMode}
                disabled={!voiceMode && !canRecord} data-speaking={voiceMode && speech.speaking}
                onClick={() => {
                  if (voiceMode) return stopVoiceMode();
                  if (!speech.supported) return setError('This browser does not support voice playback. You can still type a prompt.');
                  setError(undefined);
                  if (!speech.start(voiceError)) return;
                  voiceModeRef.current = true;
                  setVoiceMode(true);
                }}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 10v4M8 6.5v11M12 3v18M16 7.5v9M20 10v4" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {voiceStatus && <p className="agent-dictation-status" role="status">{voiceStatus}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </aside>
  );
}
