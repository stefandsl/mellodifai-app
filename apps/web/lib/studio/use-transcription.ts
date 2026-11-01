"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type Transcript, transcribe } from "./transcribe";

// One transcription at a time, cancellable: run() resolves with the transcript, or null when it
// was cancelled; it throws when the transcription failed.
export function useTranscription(send: typeof transcribe = transcribe): {
  busy: boolean;
  run: (audio: Blob, lang: string) => Promise<Transcript | null>;
  cancel: () => void;
} {
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  const run = useCallback(
    async (audio: Blob, lang: string) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setBusy(true);
      try {
        const result = await send(audio, lang, current.signal);
        return current.signal.aborted ? null : result;
      } catch (error) {
        if (current.signal.aborted) return null;
        throw error;
      } finally {
        if (controller.current === current) {
          controller.current = null;
          setBusy(false);
        }
      }
    },
    [send],
  );
  return { busy, run, cancel };
}
