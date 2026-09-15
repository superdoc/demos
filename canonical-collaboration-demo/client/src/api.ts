import type { ChatMessage, Job, Room, RoomStatus } from './types';

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

  getDocumentBlob(roomId: string, signal?: AbortSignal): Promise<Blob> {
    return this.documentRequest(roomId, 'GET', { signal }, (response) => response.blob());
  }

  getRoomStatus(roomId: string, generation?: number): Promise<RoomStatus> {
    return this.request(`${this.roomPath(roomId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation }),
    });
  }

  createJob(roomId: string, prompt: string, isSuggesting: boolean): Promise<Job> {
    return this.request(`${this.roomPath(roomId)}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, isSuggesting }),
    });
  }

  getJob(roomId: string, jobId: string): Promise<Job> {
    return this.request(`${this.roomPath(roomId)}/jobs/${encodeURIComponent(jobId)}`);
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
}

export const api = new ApiClient();
