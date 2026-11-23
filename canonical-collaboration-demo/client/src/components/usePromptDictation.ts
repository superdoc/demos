import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';

type Status = 'idle' | 'requesting' | 'listening' | 'transcribing';
const silenceMs = 500;
const initialWaitMs = 8_000;
const maximumRecordingMs = 60_000;
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function usePromptDictation(roomId: string, documentKey: string | undefined,
  onText: (text: string, handsFree: boolean) => void, onError: (message: string, handsFree: boolean) => void) {
  const [status, setStatus] = useState<Status>('idle');
  const session = useRef<{ cancel: () => void; stop: () => void } | null>(null);
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

  async function start(handsFree: boolean) {
    if (session.current) return;
    const report = (message: string) => handlers.current.onError(message, handsFree);
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
      stop() {
        if (recorder?.state === 'recording') {
          recorder.stop();
          release();
          setStatus('transcribing');
        } else if (!recorder) {
          active.cancel();
          setStatus('idle');
        }
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
          if (controller.signal.aborted) return;
          if (handsFree && !heardSpeech) return;
          if (!heardSpeech || !chunks.length) {
            report('No speech detected. Try the microphone again.');
            return;
          }
          const format = mimeType.split(';')[0];
          const { text } = await api.transcribePrompt(roomId, new Blob(chunks, { type: format }), controller.signal);
          if (!controller.signal.aborted) {
            if (text.trim()) handlers.current.onText(text.trim(), handsFree);
            else if (!handsFree) report('No speech was transcribed. Try the microphone again.');
          }
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
        if ((heardSpeech && now - lastSpeech >= silenceMs)
          || (!handsFree && !heardSpeech && now - started >= initialWaitMs)
          || now - started >= maximumRecordingMs) active.stop();
      }, 20);
    } catch (caught) {
      if (!controller.signal.aborted) report(caught instanceof Error ? caught.message : String(caught));
      finish();
    } finally {
      if (controller.signal.aborted) release();
    }
  }

  function toggle() {
    if (session.current) session.current.stop();
    else void start(false);
  }

  return { status, start, toggle, cancel };
}
