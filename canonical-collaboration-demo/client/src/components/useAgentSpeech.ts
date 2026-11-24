import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

function speechPhrases(markdown: string) {
  const text = markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*(?:#{1,6}|>|[-*+] |\d+\. )\s*/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.match(/.{1,400}(?=\s|$)|.{1,400}/g) ?? [];
}

function newPlayback() {
  return {
    controller: new AbortController(),
    sources: new Set<AudioBufferSourceNode>(),
    pending: 0,
    nextStart: 0,
    requests: Promise.resolve(),
  };
}

function cancelPlayback(playback: ReturnType<typeof newPlayback>) {
  playback.controller.abort();
  for (const source of playback.sources) source.stop();
  playback.sources.clear();
}

export function useAgentSpeech(roomId: string) {
  const [speaking, setSpeaking] = useState(false);
  const session = useRef<{ context: AudioContext; playback: ReturnType<typeof newPlayback> } | null>(null);

  const dispose = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (!current) return;
    cancelPlayback(current.playback);
    void current.context.close().catch(() => {});
  }, []);
  useEffect(() => dispose, [dispose]);

  const stop = useCallback(() => {
    dispose();
    setSpeaking(false);
  }, [dispose]);

  function start(onError: () => void) {
    try {
      const context = new AudioContext();
      session.current = { context, playback: newPlayback() };
      void context.resume().catch(() => {
        if (session.current?.context === context) onError();
      });
      return true;
    } catch {
      onError();
      return false;
    }
  }

  function clear() {
    const current = session.current;
    if (!current) return;
    cancelPlayback(current.playback);
    current.playback = newPlayback();
    setSpeaking(false);
  }

  function speak(jobId: string, text: string, onError: () => void) {
    const current = session.current;
    const phrases = speechPhrases(text);
    if (!current || !phrases.length) return;
    const { context, playback } = current;
    const { signal } = playback.controller;
    const settle = () => {
      if (!signal.aborted && !playback.pending && !playback.sources.size) setSpeaking(false);
    };
    setSpeaking(true);
    for (const phrase of phrases) {
      playback.pending++;
      playback.requests = playback.requests.then(async () => {
        if (signal.aborted) return;
        const audio = await api.synthesizeReply(roomId, jobId, phrase.trim(), signal);
        if (signal.aborted) return;
        const buffer = await context.decodeAudioData(audio);
        if (signal.aborted) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const startsAt = Math.max(context.currentTime, playback.nextStart);
        source.onended = () => {
          source.disconnect();
          playback.sources.delete(source);
          settle();
        };
        source.start(startsAt);
        playback.nextStart = startsAt + buffer.duration;
        playback.sources.add(source);
      }).catch(() => {
        if (!signal.aborted) onError();
      }).finally(() => {
        playback.pending--;
        settle();
      });
    }
  }

  return { supported: typeof AudioContext !== 'undefined', speaking, start, speak, clear, stop };
}
