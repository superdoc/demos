import { useEffect, useState } from 'react';

export type User = { id: string; name: string; email: string };
export type RoomSession = { roomId: string; documentId: string; token: string; user: User; mode: 'create' | 'join'; snapshotId?: string };

const adjectives = ['Bright', 'Calm', 'Clever', 'Curious', 'Daring', 'Gentle', 'Happy', 'Jolly', 'Kind', 'Lucky', 'Merry', 'Nimble', 'Quiet', 'Sunny', 'Swift', 'Witty'];
const animals = ['Badger', 'Bear', 'Beaver', 'Dolphin', 'Eagle', 'Falcon', 'Fox', 'Gecko', 'Heron', 'Koala', 'Lemur', 'Lynx', 'Otter', 'Owl', 'Panda', 'Penguin', 'Puffin', 'Rabbit', 'Raven', 'Robin', 'Seal', 'Sparrow', 'Tiger', 'Toucan', 'Turtle', 'Whale', 'Wolf', 'Wombat', 'Yak', 'Zebra', 'Finch', 'Lark'];
const randomName = () => {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return `${adjectives[values[0] % adjectives.length]} ${animals[values[1] % animals.length]}`;
};

const url = new URL(window.location.href);
export const roomId = url.searchParams.get('room')?.trim() || crypto.randomUUID();
const name = url.searchParams.get('user')?.trim() || randomName();
url.searchParams.set('room', roomId);
url.searchParams.set('user', name);
if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
let clientId = sessionStorage.getItem('version-history-client');
if (!clientId) { clientId = crypto.randomUUID(); sessionStorage.setItem('version-history-client', clientId); }
const identity = { clientId, name };

const applicationUrl = new URL(import.meta.env.BASE_URL, window.location.href);
const roomApiPath = (room: string, suffix: string) => new URL(`api/rooms/${encodeURIComponent(room)}/${suffix}`, applicationUrl).pathname;
export const apiPath = (session: RoomSession, suffix: string) => roomApiPath(session.roomId, suffix);
export const authHeaders = (session: RoomSession) => ({ Authorization: `Bearer ${session.token}` });
export const collaborationUrl = (session?: RoomSession) => {
  const target = new URL('collaboration', applicationUrl);
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  if (session?.snapshotId) { target.searchParams.set('snapshot', session.snapshotId); target.searchParams.set('room', session.roomId); }
  return target.href;
};

export async function checked(response: Response): Promise<Response> {
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || `Request failed (${response.status})`);
  }
  return response;
}

export function useRoomSession() {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void (async () => {
      while (!controller.signal.aborted) {
        const response = await checked(await fetch(roomApiPath(roomId, 'session'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(identity), signal: controller.signal,
        }));
        if (response.status !== 202) {
          const result: RoomSession = await response.json();
          if (!controller.signal.aborted) setSession(result);
          return;
        }
        setWaiting(true);
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 1000);
          controller.signal.addEventListener('abort', done, { once: true });
        });
      }
    })().catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [attempt]);
  return { session, error, waiting, retry: () => setAttempt((value) => value + 1) };
}
