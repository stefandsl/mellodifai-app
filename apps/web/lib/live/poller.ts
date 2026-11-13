// Live updates without a push channel: every consumer watches a small read (a "cursor") and is
// told when its value changes. One scheduler runs all of them, so the pages poll on one clock:
// fast while there is work in progress, slow when idle, not at all while the tab is hidden.

export const FAST_MS = 2_000;
export const IDLE_MS = 15_000;
export const MAX_BACKOFF_MS = 60_000;
export const READ_TIMEOUT_MS = 10_000;

export type Watch<T> = {
  // Names the read: watches with the same key share one request per tick.
  key: string;
  // One small read under the signed-in user's RLS. It returns plain JSON data, rejects on any
  // error, and gives up when the signal aborts.
  read: (signal: AbortSignal) => Promise<T>;
  // True when the value shows work in progress; every watch is then polled fast.
  busy?: (value: T) => boolean;
  // Next wall-clock change in activity, even if the stored value stays the same.
  wakeAt?: (value: T) => number;
  // Notify unchanged values too while server-derived data (queue position) can move.
  repeatMs?: (value: T) => number | undefined;
};

// Called with the first value read after subscribing (`initial`) and then only when the value
// differs from the last one this listener saw, or repeatMs is due. Async listeners never overlap
// and are told again at the next tick if their promise rejects.
export type Listener<T> = (
  value: T,
  info: { initial: boolean; repeated?: boolean },
) => void | Promise<void>;

type Subscriber = {
  notify: Listener<unknown>;
  // Reads started before the subscription may be older than what the subscriber already shows.
  after: number;
  last: string | undefined;
  notifiedAt: number;
  pending: boolean;
};

type Entry = {
  watch: Watch<unknown>;
  subscribers: Set<Subscriber>;
  reads: number;
  // Stops the read in flight; null between reads.
  cancel: (() => void) | null;
  // Read at the next tick, whatever the interval says.
  forced: boolean;
  settledAt: number;
  failures: number;
  value: unknown;
  hasValue: boolean;
};

const entries = new Map<string, Entry>();
let fastHolds = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const hidden = () => document.visibilityState === "hidden";

function interval(): number {
  if (fastHolds > 0) return FAST_MS;
  for (const entry of entries.values())
    if (entry.hasValue && entry.watch.busy?.(entry.value)) return FAST_MS;
  return IDLE_MS;
}

function dueAt(entry: Entry, base: number): number {
  if (entry.forced) return 0;
  let due =
    entry.settledAt + Math.min(MAX_BACKOFF_MS, base * 2 ** entry.failures);
  if (entry.hasValue && entry.failures === 0) {
    const wake = entry.watch.wakeAt?.(entry.value);
    if (wake !== undefined && wake > Date.now()) due = Math.min(due, wake);
    const repeat = entry.watch.repeatMs?.(entry.value);
    if (repeat !== undefined)
      for (const subscriber of entry.subscribers)
        if (!subscriber.pending)
          due = Math.min(due, subscriber.notifiedAt + repeat);
  }
  return due;
}

// One timer for every watch, set to the earliest one due.
function schedule(): void {
  clearTimeout(timer);
  timer = undefined;
  if (entries.size === 0 || hidden()) return;
  const base = interval();
  let next = Number.POSITIVE_INFINITY;
  for (const entry of entries.values())
    if (!entry.cancel) next = Math.min(next, dueAt(entry, base));
  if (next === Number.POSITIVE_INFINITY) return;
  timer = setTimeout(tick, Math.max(0, next - Date.now()));
}

function tick(): void {
  timer = undefined;
  const now = Date.now();
  const base = interval();
  for (const entry of [...entries.values()])
    if (!entry.cancel && dueAt(entry, base) <= now) void run(entry);
  schedule();
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), {
      once: true,
    });
  });
}

async function run(entry: Entry): Promise<void> {
  const controller = new AbortController();
  let cancelled = false;
  const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  entry.cancel = () => {
    cancelled = true;
    clearTimeout(timeout);
    controller.abort();
  };
  entry.forced = false;
  entry.reads += 1;
  const read = entry.reads;
  let value: unknown;
  let failed = false;
  try {
    value = await Promise.race([
      entry.watch.read(controller.signal),
      aborted(controller.signal),
    ]);
  } catch {
    failed = true;
  } finally {
    clearTimeout(timeout);
  }
  // Nobody watches this any more: the result is of no use.
  if (entries.get(entry.watch.key) !== entry) return;
  entry.cancel = null;
  entry.settledAt = Date.now();
  try {
    if (cancelled) return;
    if (failed) entry.failures += 1;
    else {
      entry.failures = 0;
      entry.value = value;
      entry.hasValue = true;
      deliver(entry, read, value);
    }
  } finally {
    // Whatever a watch's own code does, the clock goes on.
    schedule();
  }
}

function deliver(entry: Entry, read: number, value: unknown): void {
  const serialized = JSON.stringify(value) ?? "null";
  for (const subscriber of [...entry.subscribers]) {
    if (!entry.subscribers.has(subscriber)) continue;
    if (subscriber.after >= read || subscriber.pending) continue;
    const repeat = entry.watch.repeatMs?.(value);
    const repeated = subscriber.last === serialized;
    if (
      repeated &&
      (repeat === undefined || Date.now() < subscriber.notifiedAt + repeat)
    )
      continue;
    const previous = subscriber.last;
    subscriber.last = serialized;
    subscriber.notifiedAt = Date.now();
    const forget = () => {
      if (subscriber.last === serialized) subscriber.last = previous;
    };
    try {
      const done = subscriber.notify(value, {
        initial: previous === undefined,
        ...(repeated ? { repeated: true } : {}),
      });
      if (done) {
        subscriber.pending = true;
        void done.catch(forget).finally(() => {
          subscriber.pending = false;
          schedule();
        });
      }
    } catch (error) {
      // One listener's bug must not stop the others; it still surfaces as an uncaught error.
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

// Reads every watch now: the tab is back, the network is back, or the page has fresh data.
export function checkNow(): void {
  for (const entry of entries.values()) {
    entry.forced = true;
    entry.cancel?.();
  }
  schedule();
}

function onVisibility(): void {
  if (hidden()) schedule();
  else checkNow();
}

function listen(): void {
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", checkNow);
  window.addEventListener("online", checkNow);
}

function unlisten(): void {
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("focus", checkNow);
  window.removeEventListener("online", checkNow);
}

// Starts watching; returns the function that stops. The first read happens right away.
export function watch<T>(definition: Watch<T>, listener: Listener<T>) {
  let entry = entries.get(definition.key);
  if (!entry) {
    entry = {
      watch: definition as Watch<unknown>,
      subscribers: new Set(),
      reads: 0,
      cancel: null,
      forced: true,
      settledAt: 0,
      failures: 0,
      value: undefined,
      hasValue: false,
    };
    entries.set(definition.key, entry);
    if (entries.size === 1) listen();
  }
  const shared = entry;
  const subscriber: Subscriber = {
    notify: listener as Listener<unknown>,
    after: shared.reads,
    last: undefined,
    notifiedAt: Date.now(),
    pending: false,
  };
  shared.subscribers.add(subscriber);
  shared.forced = true;
  schedule();
  return () => {
    if (!shared.subscribers.delete(subscriber)) return;
    if (
      shared.subscribers.size === 0 &&
      entries.get(shared.watch.key) === shared
    ) {
      entries.delete(shared.watch.key);
      shared.cancel?.();
      if (entries.size === 0) unlisten();
    }
    schedule();
  };
}

// Polls fast until the returned function is called: the caller is showing work in progress.
export function holdFast() {
  let held = true;
  fastHolds += 1;
  schedule();
  return () => {
    if (!held) return;
    held = false;
    fastHolds -= 1;
    schedule();
  };
}
