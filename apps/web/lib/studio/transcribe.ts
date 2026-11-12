import { encodeWav } from "./audio-edit";

// What the transcription route answers.
export type Transcript = {
  lyrics: string;
  words: { word: string; start: number; end: number }[];
};

const SPEECH_RATE = 16_000;

// A 16 kHz mono WAV of a recording: what Whisper hears anyway, about 2 MB a minute, so even a
// 50 MB WAV upload fits Groq's 25 MB limit.
export async function speechWav(audio: Blob): Promise<Blob> {
  const context = new AudioContext();
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await audio.arrayBuffer());
  } finally {
    void context.close();
  }
  const offline = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil(buffer.duration * SPEECH_RATE)),
    SPEECH_RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Blob(
    [encodeWav([rendered.getChannelData(0)], SPEECH_RATE) as BlobPart],
    {
      type: "audio/wav",
    },
  );
}

// Sends a recording to the studio's transcription route; `signal` cancels it.
export async function transcribe(
  audio: Blob,
  lang: string,
  signal?: AbortSignal,
  prepare: (audio: Blob) => Promise<Blob> = speechWav,
): Promise<Transcript> {
  const wav = await prepare(audio);
  signal?.throwIfAborted();
  const form = new FormData();
  form.append("file", wav, "audio.wav");
  form.append("lang", lang);
  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: form,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`transcription ${response.status}`);
  return (await response.json()) as Transcript;
}
