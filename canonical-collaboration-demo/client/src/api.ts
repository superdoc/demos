import type { ChatMessage, Job, Room } from './types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

async function checked<T>(responsePromise: Promise<Response>): Promise<T> {
  const response = await responsePromise;
  if (response.ok) return response.status === 204 ? (undefined as T) : response.json();
  const payload = await response.json().catch(() => ({ detail: response.statusText }));
  throw new Error(payload.detail ?? payload.error ?? `Request failed (${response.status})`);
}

export async function getRoom(roomId: string): Promise<Room | undefined> {
  const state = await checked<{ document?: Room }>(fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}`));
  return state.document;
}

export async function uploadDocument(roomId: string, file: File): Promise<Room> {
  const body = new FormData();
  body.append('file', file);
  return checked(
    fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}/document`, { method: 'PUT', body }),
  );
}

export async function createBlankDocument(roomId: string): Promise<Room> {
  return checked(fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}/document`, { method: 'POST' }));
}

export async function deleteDocument(roomId: string): Promise<void> {
  return checked(fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}/document`, { method: 'DELETE' }));
}

export function documentDownloadUrl(roomId: string): string {
  return `${API_URL}/api/rooms/${encodeURIComponent(roomId)}/document`;
}

export async function getDocumentBlob(roomId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(documentDownloadUrl(roomId), { signal });
  if (!response.ok) throw new Error(`Document download failed (${response.status})`);
  return response.blob();
}

export async function touchRoom(room: Room): Promise<void> {
  return checked(
    fetch(`${API_URL}/api/rooms/${encodeURIComponent(room.room_id)}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation: room.generation }),
    }),
  );
}

export async function createJob(roomId: string, prompt: string, isSuggesting: boolean): Promise<Job> {
  return checked(
    fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, isSuggesting }),
    }),
  );
}

export async function getJob(roomId: string, jobId: string): Promise<Job> {
  return checked(fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}/jobs/${encodeURIComponent(jobId)}`));
}

export async function cancelJob(roomId: string, jobId: string): Promise<Job> {
  return checked(
    fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    }),
  );
}

export async function getChatHistory(roomId: string): Promise<ChatMessage[]> {
  const history = await checked<{ messages: ChatMessage[] }>(
    fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}/chat`),
  );
  return history.messages;
}
