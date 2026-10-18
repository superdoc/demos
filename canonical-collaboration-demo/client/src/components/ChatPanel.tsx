import { FormEvent, KeyboardEvent, PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { api } from '../api';
import type { ChatMessage, Job } from '../types';
import { ToolCallsBubble } from './ToolCallsBubble';

type ChatPanelProps = {
  roomId: string;
  disabled: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  reservedWidth?: number;
  onDocumentUpdated?: () => void;
};

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function MarkdownMessage({ content }: { content: string }) {
  return <div className="message-markdown"><Markdown>{content}</Markdown></div>;
}

function CopyMessageButton({ content }: { content: string }) {
  return (
    <button
      className="copy-message"
      type="button"
      aria-label="Copy message"
      title="Copy message"
      onClick={() => void navigator.clipboard.writeText(content)}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
      </svg>
    </button>
  );
}

function JobStatus({ job }: { job: Job }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (job.status !== 'running') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [job.status, job.updated_at]);

  const elapsedSeconds = job.status === 'running'
    ? Math.max(0, Math.floor((now - new Date(job.updated_at).getTime()) / 1_000))
    : undefined;
  const elapsedTime = elapsedSeconds === undefined
    ? undefined
    : `${Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`;

  return (
    <span className={`job-status ${job.status}`}>
      {job.status.replace('_', ' ')}
      {elapsedTime !== undefined && ` ${elapsedTime}`}
    </span>
  );
}

export function ChatPanel({ roomId, disabled, width, onWidthChange, reservedWidth = 0, onDocumentUpdated }: ChatPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string>();
  const historyRef = useRef<HTMLDivElement>(null);
  const submittedPromptsRef = useRef<string[] | null>(null);
  const promptNavigationRef = useRef<{ prompts: string[]; index: number; draft: string } | null>(null);
  const resizeStartRef = useRef<{ x: number; width: number } | undefined>(undefined);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const activeJob = jobs.find((job) => !TERMINAL.has(job.status));

  function startResize(event: PointerEvent<HTMLDivElement>) {
    resizeStartRef.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    const maximum = Math.max(280, Math.min(720, window.innerWidth - 680 - reservedWidth));
    onWidthChange(Math.max(280, Math.min(maximum, start.width + start.x - event.clientX)));
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
  }, [jobs, messages]);

  async function refreshHistory() {
    try {
      const history = await api.getChatHistory(roomId);
      setMessages(history);
      if (submittedPromptsRef.current === null) {
        submittedPromptsRef.current = history.filter((message) => message.role === 'user').map((message) => message.content);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    setJobs([]);
    setMessages([]);
    setError(undefined);
    submittedPromptsRef.current = null;
    promptNavigationRef.current = null;
    return () => { streamRef.current?.close(); streamRef.current = undefined; };
  }, [roomId]);

  useEffect(() => {
    if (!disabled) void refreshHistory();
  }, [disabled, roomId]);

  async function finishJob(job: Job) {
    onDocumentUpdated?.();
    if (job.status === 'completed') {
      const history = await api.getChatHistory(roomId);
      setMessages(history);
      setJobs((current) => current.filter((candidate) => candidate.id !== job.id));
    }
  }

  async function poll(job: Job) {
    while (!TERMINAL.has(job.status)) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      job = await api.getJob(roomId, job.id);
      setJobs((current) => current.map((candidate) => (candidate.id === job.id ? job : candidate)));
    }
    await finishJob(job);
  }

  function watchJob(initialJob: Job): Promise<void> {
    if (TERMINAL.has(initialJob.status)) return finishJob(initialJob);
    return new Promise((resolve, reject) => {
      let job = initialJob;
      const stream = new EventSource(api.jobEventsUrl(roomId, job.id));
      streamRef.current = stream;
      const close = () => {
        stream.onmessage = null; stream.onerror = null; stream.close();
        if (streamRef.current === stream) streamRef.current = undefined;
      };
      stream.onmessage = (event) => {
        try {
          job = JSON.parse(event.data) as Job;
          setJobs((current) => current.map((candidate) => candidate.id === job.id ? job : candidate));
          if (TERMINAL.has(job.status)) {
            close();
            void finishJob(job).then(resolve, reject);
          }
        } catch (caught) { close(); reject(caught); }
      };
      stream.onerror = () => {
        close();
        void poll(job).then(resolve, reject);
      };
    });
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
    const message = prompt.trim();
    if (!message) return;
    setError(undefined);
    submittedPromptsRef.current ??= messages.filter((entry) => entry.role === 'user').map((entry) => entry.content);
    submittedPromptsRef.current.push(message);
    promptNavigationRef.current = null;
    setPrompt('');
    try {
      const job = await api.createJob(roomId, message, isSuggesting);
      setJobs((current) => [...current, job]);
      await watchJob(job);
    } catch (caught) {
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
    <aside className="chat-panel" aria-label="Agent chat" style={{ width }}>
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
      <header>
        <h2>Document agent</h2>
        <p>Ask the agent to edit the current document.</p>
      </header>

      <div ref={historyRef} className="chat-history">
        {[...messages.map((message, index) => (
          <div className="message-turn" key={message.id ?? `${message.role}-${index}`}>
            {message.role === 'assistant' && <ToolCallsBubble key="tools" calls={message.toolCalls} />}
            <article className={`message ${message.role}`}>
              <CopyMessageButton content={message.content} />
              <span className="message-role">{message.role === 'user' ? 'You' : 'Agent'}</span>
              <MarkdownMessage content={message.content} />
            </article>
          </div>
        )), ...jobs.map((job) => (
          <div className="message-turn" key={job.id}>
            <article className="message user">
              <CopyMessageButton content={job.prompt} />
              <span className="message-role">You</span>
              <MarkdownMessage content={job.prompt} />
              <JobStatus job={job} />
            </article>
            <ToolCallsBubble key="tools" calls={job.toolCalls} />
            {(job.answer || job.error) && <article className="message assistant">
              <CopyMessageButton content={job.answer ?? job.error ?? ''} />
              <span className="message-role">Agent</span>
              {job.answer && <MarkdownMessage content={job.answer} />}
              {job.error && <p className="error">{job.error}</p>}
            </article>}
          </div>
        ))]}
      </div>

      <form onSubmit={submit}>
        <div className="prompt-options">
          <label htmlFor="agent-prompt">Prompt</label>
          <select
            aria-label="Agent edit mode"
            value={isSuggesting ? 'suggestion' : 'direct'}
            disabled={disabled || Boolean(activeJob)}
            onChange={(event) => setIsSuggesting(event.target.value === 'suggestion')}
          >
            <option value="suggestion">Reviewing</option>
            <option value="direct">Editing</option>
          </select>
        </div>
        <textarea
          id="agent-prompt"
          value={prompt}
          onChange={(event) => { promptNavigationRef.current = null; setPrompt(event.target.value); }}
          onClick={() => { promptNavigationRef.current = null; }}
          onKeyDown={handlePromptKeyDown}
          placeholder={isSuggesting
            ? 'Enter a prompt for the agent to apply as a suggestion.'
            : 'Enter a prompt for the agent to apply as a direct edit.'}
          disabled={disabled || Boolean(activeJob)}
        />
        {error && <p className="error">{error}</p>}
        <button className={activeJob ? 'stop-agent' : undefined} disabled={disabled || (!activeJob && !prompt.trim())}>
          {activeJob ? 'Stop agent' : 'Run agent'}
        </button>
      </form>
    </aside>
  );
}
