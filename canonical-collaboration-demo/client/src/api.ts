import type { ChatMessage, Job, Room, RoomStatus } from './types';
import type { BrowserDocumentApi, TextTarget } from 'superdoc/ui';
import type { BibliographyStyle, CitationSource, CitationInsertResult } from './references';

type ResponseParser<T> = (response: Response) => Promise<T>;

export class ApiClient {
  constructor(private readonly baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000') {}

  private roomPath(roomId: string): string {
    return `/api/rooms/${encodeURIComponent(roomId)}`;
  }

  private documentRequest<T>(
    roomId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    init?: Omit<RequestInit, 'method'>,
    parse?: ResponseParser<T>,
  ): Promise<T> {
    return this.request(`${this.roomPath(roomId)}/document`, { ...init, method }, parse);
  }

  private async request<T>(path: string, init?: RequestInit, parse?: ResponseParser<T>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = await response.json() as { detail?: string; error?: string };
        throw new Error(payload.detail ?? payload.error ?? `Request failed (${response.status})`);
      }
      const message = (await response.text()).trim();
      throw new Error(message || response.statusText || `Request failed (${response.status})`);
    }

    if (response.status === 204) return undefined as T;
    return parse ? parse(response) : response.json() as Promise<T>;
  }

  async getRoom(roomId: string): Promise<Room | undefined> {
    const state = await this.request<{ document?: Room }>(this.roomPath(roomId));
    return state.document;
  }

  async initializeRoom(roomId: string): Promise<Room | undefined> {
    const state = await this.request<{ document: Room | null }>(`${this.roomPath(roomId)}/initialize`, { method: 'POST' });
    return state.document ?? undefined;
  }

  uploadDocument(roomId: string, file: File): Promise<Room> {
    const body = new FormData();
    body.append('file', file);
    return this.documentRequest(roomId, 'PUT', { body });
  }

  createBlankDocument(roomId: string): Promise<Room> {
    return this.documentRequest(roomId, 'POST');
  }

  deleteDocument(roomId: string): Promise<void> {
    return this.documentRequest(roomId, 'DELETE');
  }

  documentDownloadUrl(roomId: string): string {
    return `${this.baseUrl}${this.roomPath(roomId)}/document`;
  }

  getDocumentBlob(roomId: string, signal?: AbortSignal, fieldCodes = false): Promise<Blob> {
    return this.request(`${this.roomPath(roomId)}/document${fieldCodes ? '?fieldCodes=true' : ''}`, { signal }, (response) => response.blob());
  }

  async getCollaborationToken(roomId: string, userId: string): Promise<string> {
    const result = await this.request<{ token: string }>(`${this.roomPath(roomId)}/collaboration-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return result.token;
  }

  getRoomStatus(roomId: string, generation?: number): Promise<RoomStatus> {
    return this.request(`${this.roomPath(roomId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation }),
    });
  }

  createJob(roomId: string, prompt: string, isSuggesting: boolean, selectedText?: string): Promise<Job> {
    return this.request(`${this.roomPath(roomId)}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, isSuggesting, selectedText }),
    });
  }

  getJob(roomId: string, jobId: string): Promise<Job> {
    return this.request(`${this.roomPath(roomId)}/jobs/${encodeURIComponent(jobId)}`);
  }

  jobEventsUrl(roomId: string, jobId: string): string {
    return `${this.baseUrl}${this.roomPath(roomId)}/jobs/${encodeURIComponent(jobId)}/events`;
  }

  cancelJob(roomId: string, jobId: string): Promise<Job> {
    return this.request(`${this.roomPath(roomId)}/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
  }

  async getChatHistory(roomId: string): Promise<ChatMessage[]> {
    const history = await this.request<{ messages: ChatMessage[] }>(`${this.roomPath(roomId)}/chat`);
    return history.messages;
  }

  getCitationSources(roomId: string): Promise<{ items: CitationSource[]; evaluatedRevision: string; bibliographyStyle: BibliographyStyle; fieldCodes: boolean }> {
    return this.request(`${this.roomPath(roomId)}/citation-sources`);
  }

  insertFootnote(room: Room, at: TextTarget, changeMode: 'tracked' | 'direct', expectedRevision: string): ReturnType<BrowserDocumentApi['footnotes']['insert']> {
    return this.request(`${this.roomPath(room.room_id)}/footnotes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: room.generation, input: { at, changeMode, expectedRevision } }),
    });
  }

  createCitationSource(room: Room, input: Parameters<BrowserDocumentApi['citations']['sources']['insert']>[0], expectedRevision: string | undefined): ReturnType<BrowserDocumentApi['citations']['sources']['insert']> {
    return this.request(`${this.roomPath(room.room_id)}/citation-sources`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: room.generation, input: { ...input, expectedRevision } }),
    });
  }

  insertCitation(room: Room, input: Parameters<BrowserDocumentApi['citations']['insert']>[0], changeMode: 'tracked' | 'direct', expectedRevision: string | undefined): Promise<CitationInsertResult> {
    return this.request(`${this.roomPath(room.room_id)}/citations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: room.generation, input: { ...input, changeMode, expectedRevision } }),
    });
  }

  removeCitation(room: Room, input: { target: Parameters<BrowserDocumentApi['citations']['remove']>[0]['target']; instruction: string; displayText: string; changeMode: 'direct' | 'tracked'; expectedRevision: string }): Promise<{ success: boolean; caret: { blockId: string; offset: number } }> {
    return this.request(`${this.roomPath(room.room_id)}/citations`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: room.generation, input }),
    });
  }

  setBibliographyStyle(room: Room, style: BibliographyStyle, expectedRevision: string): Promise<{ success: boolean; bibliographyStyle: BibliographyStyle }> {
    return this.request(`${this.roomPath(room.room_id)}/bibliography-style`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: room.generation, style, expectedRevision }),
    });
  }

  insertBibliography(room: Room, expectedRevision: string): Promise<Awaited<ReturnType<BrowserDocumentApi['citations']['bibliography']['insert']>> & { formattingWarning?: string }> {
    return this.request(`${this.roomPath(room.room_id)}/bibliographies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: room.generation, expectedRevision }),
    });
  }

  removeEmptyBibliography(room: Room, bibliographyId: string, expectedRevision: string): Promise<{ success: boolean; removed: boolean; caret?: { blockId: string; offset: number } }> {
    return this.request(`${this.roomPath(room.room_id)}/bibliographies/${encodeURIComponent(bibliographyId)}/empty`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: room.generation, expectedRevision }),
    });
  }

  setReferenceDisplay(room: Room, fieldCodes: boolean, expectedRevision: string): Promise<{ success: boolean; fieldCodes: boolean }> {
    return this.request(`${this.roomPath(room.room_id)}/reference-display`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: room.generation, fieldCodes, expectedRevision }),
    });
  }
}

export const api = new ApiClient();
