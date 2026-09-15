import { FormEvent, KeyboardEvent, PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { api } from '../api';
import type { ChatMessage, Job } from '../types';

type ChatPanelProps = {
  roomId: string;
  disabled: boolean;
  width: number;
  onWidthChange: (width: number) => void;
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

export function ChatPanel({ roomId, disabled, width, onWidthChange }: ChatPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string>();
  const historyRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ x: number; width: number } | undefined>(undefined);
  const activeJob = jobs.find((job) => !TERMINAL.has(job.status));

  function startResize(event: PointerEvent<HTMLDivElement>) {
    resizeStartRef.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    const maximum = Math.max(280, Math.min(720, window.innerWidth - 680));
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
      setMessages(await api.getChatHistory(roomId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    setJobs([]);
    setMessages([]);
    setError(undefined);
    if (!disabled) void refreshHistory();
  }, [disabled, roomId]);

  async function poll(job: Job) {
    while (!TERMINAL.has(job.status)) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      job = await api.getJob(roomId, job.id);
      setJobs((current) => current.map((candidate) => (candidate.id === job.id ? job : candidate)));
    }
    if (job.status === 'completed') {
      setJobs((current) => current.filter((candidate) => candidate.id !== job.id));
      await refreshHistory();
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
    const message = prompt.trim();
    if (!message) return;
    setError(undefined);
    setPrompt('');
    try {
      const job = await api.createJob(roomId, message, isSuggesting);
      setJobs((current) => [...current, job]);
      await poll(job);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <aside className="chat-panel" aria-label="Agent chat">
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
        {messages.map((message, index) => (
          <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
            <CopyMessageButton content={message.content} />
            <span className="message-role">{message.role === 'user' ? 'You' : 'Agent'}</span>
            <MarkdownMessage content={message.content} />
          </article>
        ))}
        {jobs.map((job) => (
          <article className="message" key={job.id}>
            <CopyMessageButton content={job.answer ?? job.prompt} />
            <MarkdownMessage content={job.prompt} />
            <JobStatus job={job} />
            {job.answer && <div className="answer"><MarkdownMessage content={job.answer} /></div>}
            {job.error && <p className="error">{job.error}</p>}
          </article>
        ))}
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
          onChange={(event) => setPrompt(event.target.value)}
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
