import { getChangesApi, type ChangeRecord, type SnapshotEditor } from './change-records';

export class ChangeRecorder {
  private cursor: string | null = null;
  private stopped = false;
  private pending: Promise<unknown> = Promise.resolve();
  private controller = new AbortController();
  private gap = false;

  constructor(private source: SnapshotEditor, private persist: (records: ChangeRecord[], signal: AbortSignal) => Promise<void>, private onState: (error: string, changed: boolean) => void) {
    getChangesApi(source);
  }

  private queue<T>(work: () => Promise<T>): Promise<T> {
    const task = this.pending.catch(() => {}).then(work);
    this.pending = task;
    return task;
  }

  private async read(waitMs: number) {
    const page = await getChangesApi(this.source).list({ after: this.cursor ?? undefined, limit: 200, includeUpdate: true, waitMs });
    if (this.stopped) return 0;
    if (page.truncated) this.gap = true;
    if (page.identity !== 'configured') throw new Error('The document has no actor ID. Changes cannot be attributed.');
    if (page.items.length) {
      await this.persist(page.items, this.controller.signal);
    }
    if (this.stopped) return 0;
    this.cursor = page.cursor;
    this.onState(this.gap ? 'Some change records expired before they could be stored. Reloading will not recover that gap.' : '', page.items.length > 0);
    return page.items.length;
  }

  start() {
    void (async () => {
      while (!this.stopped) {
        // Short reads avoid keeping an API execution scope open across human input.
        try { if (!await this.queue(() => this.read(0))) await this.pause(500); }
        catch (error) {
          if (this.stopped) return;
          this.onState(error instanceof Error ? error.message : 'Edits could not be stored. Retrying…', false);
          await this.pause(1000);
        }
      }
    })();
  }

  private pause(ms: number) {
    if (this.stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); this.controller.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      this.controller.signal.addEventListener('abort', finish, { once: true });
    });
  }

  flush() {
    return this.queue(async () => {
      while (await this.read(0)) { /* Drain every page before taking a checkpoint. */ }
      if (this.stopped) throw new Error('The document was closed.');
      if (this.gap) throw new Error('This session has a gap in its change history. A complete version cannot be saved.');
    });
  }

  stop() { this.stopped = true; this.controller.abort(); }
}
