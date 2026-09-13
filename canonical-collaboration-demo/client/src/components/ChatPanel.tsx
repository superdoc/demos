import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createJob, getChatHistory, getJob } from '../api';
import type { ChatMessage, Job } from '../types';

type ChatPanelProps = {
  roomId: string;
  disabled: boolean;
};

const TERMINAL = new Set(['completed', 'failed']);

export function ChatPanel({ roomId, disabled }: ChatPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string>();
  const historyRef = useRef<HTMLDivElement>(null);

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
    const message = prompt.trim();
    if (!message) return;
    setError(undefined);
    setPrompt('');
    try {
      const job = await createJob(roomId, message);
      setJobs((current) => [job, ...current]);
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
            <span className="message-role">{message.role === 'user' ? 'You' : 'Agent'}</span>
            <p>{message.content}</p>
          </article>
        ))}
        {jobs.map((job) => (
          <article className="message" key={job.id}>
            <p>{job.prompt}</p>
            <span className={`job-status ${job.status}`}>{job.status.replace('_', ' ')}</span>
            {job.answer && <p className="answer">{job.answer}</p>}
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
          disabled={disabled}
        />
        {error && <p className="error">{error}</p>}
        <button disabled={disabled || !prompt.trim()}>Run agent</button>
      </form>
    </aside>
  );
}
