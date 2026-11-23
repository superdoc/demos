import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';

type Status = 'idle' | 'requesting' | 'listening' | 'transcribing';
const silenceMs = 500;
const maximumRecordingMs = 60_000;
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function usePromptDictation(roomId: string, documentKey: string | undefined,
  onText: (text: string) => void, onError: (message: string) => void) {
  const [status, setStatus] = useState<Status>('idle');
  const session = useRef<{ cancel: () => void } | null>(null);
  const handlers = useRef({ onText, onError });

  useLayoutEffect(() => { handlers.current = { onText, onError }; }, [onText, onError]);

  useEffect(() => {
    setStatus('idle');
    return () => session.current?.cancel();
  }, [roomId, documentKey]);

  const cancel = useCallback(() => {
    session.current?.cancel();
    setStatus('idle');
  }, []);

  async function start() {
    if (session.current) return;
    const report = (message: string) => handlers.current.onError(message);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined') {
      report('Microphone dictation requires a browser with audio recording enabled.');
      return;
    }

    const mimeType = formats.find((format) => MediaRecorder.isTypeSupported(format));
    if (!mimeType) {
      report('This browser has no supported microphone recording format.');
      return;
    }

    const controller = new AbortController();
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let recorder: MediaRecorder | undefined;
    let timer: number | undefined;
    let heardSpeech = false;
    const chunks: Blob[] = [];

    function release() {
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    }

    function finish() {
      release();
      if (session.current !== active) return;
      session.current = null;
      if (!controller.signal.aborted) setStatus('idle');
    }

    const active = {
      cancel() {
        controller.abort();
        if (recorder?.state === 'recording') recorder.stop();
        finish();
      },
    };

    session.current = active;
    setStatus('requesting');
    try {
      context = new AudioContext();
      await context.resume();
      if (controller.signal.aborted) return;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (controller.signal.aborted) return;
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        if (!controller.signal.aborted) report('The microphone recording failed.');
        active.cancel();
        setStatus('idle');
      };
      recorder.onstop = async () => {
        try {
          if (controller.signal.aborted || !heardSpeech || !chunks.length) return;
          const format = mimeType.split(';')[0];
          const { text } = await api.transcribePrompt(roomId, new Blob(chunks, { type: format }), controller.signal);
          if (!controller.signal.aborted && text.trim()) handlers.current.onText(text.trim());
        } catch (caught) {
          if (!controller.signal.aborted) report(caught instanceof Error ? caught.message : String(caught));
        } finally {
          finish();
        }
      };
      recorder.start();
      setStatus('listening');
      const started = performance.now();
      let lastSpeech = started;
      timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const power = samples.reduce((total, sample) => total + sample * sample, 0) / samples.length;
        const now = performance.now();
        if (power >= 0.0001) {
          heardSpeech = true;
          lastSpeech = now;
        }
        if ((heardSpeech && now - lastSpeech >= silenceMs) || now - started >= maximumRecordingMs) {
          if (recorder?.state !== 'recording') return;
          recorder.stop();
          release();
          setStatus('transcribing');
        }
      }, 20);
    } catch (caught) {
      if (!controller.signal.aborted) report(caught instanceof Error ? caught.message : String(caught));
      finish();
    } finally {
      if (controller.signal.aborted) release();
    }
  }

  return { status, start, cancel };
}
