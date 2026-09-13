import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { cancelJob, createJob, getChatHistory, getJob } from '../api';
import type { ChatMessage, Job } from '../types';

type ChatPanelProps = {
  roomId: string;
  disabled: boolean;
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

export function ChatPanel({ roomId, disabled }: ChatPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string>();
  const historyRef = useRef<HTMLDivElement>(null);
  const activeJob = jobs.find((job) => !TERMINAL.has(job.status));

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [jobs, messages]);

  async function refreshHistory() {
    try {
      setMessages(await getChatHistory(roomId));
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
      job = await getJob(roomId, job.id);
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
        const cancelled = await cancelJob(roomId, activeJob.id);
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
      const job = await createJob(roomId, message);
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
      <header>
        <p className="eyebrow">Replaceable interface</p>
        <h2>Document agent</h2>
        <p>This component only calls the public jobs API. Replace it with your own agent UI.</p>
      </header>

      <div ref={historyRef} className="chat-history">
        {messages.length === 0 && jobs.length === 0 && (
          <p className="empty">Ask the agent to edit the current document.</p>
        )}
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
            <span className={`job-status ${job.status}`}>{job.status.replace('_', ' ')}</span>
            {job.answer && <div className="answer"><MarkdownMessage content={job.answer} /></div>}
            {job.error && <p className="error">{job.error}</p>}
          </article>
        ))}
      </div>

      <form onSubmit={submit}>
        <label htmlFor="agent-prompt">Prompt</label>
        <textarea
          id="agent-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder="Add a short executive summary…"
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
