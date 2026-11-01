import { configureAnalyser } from "./live-frame";

// The player bar owns the app's single <audio> element; the Video Studio's live preview listens
// to it through a Web Audio analyser. createMediaElementSource can be called once per element,
// and from then on the element plays through the graph, so the graph is made once, on the first
// studio open (a click, which lets the AudioContext start), and kept for the page's life: the
// song keeps playing while presets change, and the studio can close and open again.

type Tap = {
  context: AudioContext;
  analyser: AnalyserNode;
};

let element: HTMLAudioElement | null = null;
const taps = new WeakMap<HTMLAudioElement, Tap>();

export function registerPlayerAudio(el: HTMLAudioElement | null): void {
  if (el) element = el;
}

export function playerAudio(): HTMLAudioElement | null {
  return element;
}

// The analyser of the player's audio, made on first use; null without an element or Web Audio.
export function playerAnalyser(): AnalyserNode | null {
  const el = element;
  if (!el) return null;
  const known = taps.get(el);
  if (known) {
    if (known.context.state === "suspended") void known.context.resume();
    return known.analyser;
  }
  const Context =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);
  if (!Context) return null;
  try {
    const context = new Context();
    const source = context.createMediaElementSource(el);
    const analyser = context.createAnalyser();
    configureAnalyser(analyser);
    source.connect(analyser);
    analyser.connect(context.destination);
    taps.set(el, { context, analyser });
    if (context.state === "suspended") void context.resume();
    return analyser;
  } catch {
    return null;
  }
}

// Test hook: forget the element (the WeakMap keeps no other reference).
export function resetPlayerAudio(): void {
  element = null;
}
