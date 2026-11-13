import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  FAST_MS,
  holdFast,
  IDLE_MS,
  type Listener,
  MAX_BACKOFF_MS,
  READ_TIMEOUT_MS,
  type Watch,
  watch,
} from "./poller";

const stops: (() => void)[] = [];
let visibility = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  // Nothing may outlive its watchers.
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// A read whose answer the test controls.
function source<T>(key: string, value: T, busy?: (value: T) => boolean) {
  const state = { value, reads: 0, fail: false };
  const definition: Watch<T> = {
    key,
    read: async () => {
      state.reads += 1;
      if (state.fail) throw new Error("down");
      return state.value;
    },
    busy,
  };
  return { state, definition };
}
function start<T>(definition: Watch<T>, listener: Listener<T> = vi.fn()) {
  const stop = watch(definition, listener);
  stops.push(stop);
  return { listener: listener as ReturnType<typeof vi.fn>, stop };
}
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
function show(state: "visible" | "hidden") {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

it("reads at once, then tells the listener only when the value changes", async () => {
  const { state, definition } = source("change", { n: 1 });
  const { listener } = start(definition);
  await advance(0);
  expect(listener.mock.calls).toEqual([[{ n: 1 }, { initial: true }]]);
  await advance(IDLE_MS * 3);
  expect(state.reads).toBe(4);
  expect(listener).toHaveBeenCalledOnce();
  state.value = { n: 2 };
  await advance(IDLE_MS);
  expect(listener.mock.calls.slice(1)).toEqual([
    [{ n: 2 }, { initial: false }],
  ]);
  await advance(IDLE_MS * 2);
  expect(listener).toHaveBeenCalledTimes(2);
});

it("polls every 15 seconds when idle and every 2 while a watch shows work", async () => {
  const { state, definition } = source(
    "busy",
    { running: 0 },
    (value) => value.running > 0,
  );
  const other = source("bystander", 0);
  start(definition);
  start(other.definition);
  await advance(0);
  await advance(IDLE_MS - 1);
  expect(state.reads).toBe(1);
  state.value = { running: 1 };
  await advance(1);
  expect(state.reads).toBe(2);
  // Work in one watch speeds up all of them.
  await advance(FAST_MS * 3);
  expect(state.reads).toBe(5);
  expect(other.state.reads).toBe(5);
  state.value = { running: 0 };
  await advance(FAST_MS);
  expect(state.reads).toBe(6);
  await advance(IDLE_MS - 1);
  expect(state.reads).toBe(6);
  await advance(1);
  expect(state.reads).toBe(7);
});

it("polls fast while a consumer holds it fast", async () => {
  const { state, definition } = source("held", 0);
  start(definition);
  await advance(0);
  const release = holdFast();
  await advance(FAST_MS * 2);
  expect(state.reads).toBe(3);
  release();
  release();
  await advance(IDLE_MS - 1);
  expect(state.reads).toBe(3);
  await advance(1);
  expect(state.reads).toBe(4);
});

it("shares one read between watchers of a key and reads afresh for a late one", async () => {
  const { state, definition } = source("shared", "a");
  const first = start(definition);
  await advance(0);
  expect(state.reads).toBe(1);
  const second = start({ ...definition });
  await advance(0);
  expect(state.reads).toBe(2);
  expect(first.listener).toHaveBeenCalledOnce();
  expect(second.listener.mock.calls).toEqual([["a", { initial: true }]]);
  await advance(IDLE_MS);
  expect(state.reads).toBe(3);
  state.value = "b";
  await advance(IDLE_MS);
  expect(state.reads).toBe(4);
  expect(first.listener).toHaveBeenLastCalledWith("b", { initial: false });
  expect(second.listener).toHaveBeenLastCalledWith("b", { initial: false });
  // The watch lives on while one watcher is left.
  first.stop();
  await advance(IDLE_MS);
  expect(state.reads).toBe(5);
});

it("does not hand a late watcher a read that started before it", async () => {
  const answers: ((value: string) => void)[] = [];
  const definition: Watch<string> = {
    key: "late",
    read: () => new Promise((resolve) => answers.push(resolve)),
  };
  const first = start(definition);
  await advance(0);
  const second = start(definition);
  answers[0]?.("old");
  await advance(0);
  expect(first.listener).toHaveBeenCalledWith("old", { initial: true });
  expect(second.listener).not.toHaveBeenCalled();
  expect(answers).toHaveLength(2);
  answers[1]?.("new");
  await advance(0);
  expect(second.listener.mock.calls).toEqual([["new", { initial: true }]]);
});

it.each(["focus", "online", "visibilitychange"])(
  "replaces a hung read on %s without charging an error",
  async (event) => {
    const signals: AbortSignal[] = [];
    const read = vi.fn((signal: AbortSignal): Promise<number> => {
      signals.push(signal);
      if (signals.length === 1) return new Promise(() => {});
      return Promise.reject(new Error("down"));
    });
    start({ key: "wake-hung", read });
    stops.push(holdFast());
    await advance(0);
    await advance(1000);
    if (event === "visibilitychange") {
      show("hidden");
      show("visible");
    } else window.dispatchEvent(new Event(event));
    await advance(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    // Only the replacement's real error counts: one fast-clock backoff, not two.
    await advance(FAST_MS * 2);
    expect(read).toHaveBeenCalledTimes(3);
  },
);

it("never overlaps ordinary scheduled reads", async () => {
  const answers: ((value: number) => void)[] = [];
  const definition: Watch<number> = {
    key: "slow",
    read: () => new Promise((resolve) => answers.push(resolve)),
  };
  const { listener } = start(definition);
  // Another watch keeps the clock ticking meanwhile.
  const quick = source("quick", 0);
  start(quick.definition);
  stops.push(holdFast());
  await advance(0);
  await advance(READ_TIMEOUT_MS - 1);
  expect(quick.state.reads).toBeGreaterThan(3);
  expect(answers).toHaveLength(1);
  answers[0]?.(1);
  await advance(0);
  expect(listener).toHaveBeenCalledOnce();
  // The next read is a full interval after the answer, not after the request.
  await advance(FAST_MS - 1);
  expect(answers).toHaveLength(1);
  await advance(1);
  expect(answers).toHaveLength(2);
});

it("backs off after errors up to a minute and returns to the clock on success", async () => {
  const { state, definition } = source("flaky", 1);
  const { listener } = start(definition);
  await advance(0);
  state.fail = true;
  await advance(IDLE_MS);
  expect(state.reads).toBe(2);
  for (const wait of [30_000, MAX_BACKOFF_MS, MAX_BACKOFF_MS]) {
    const reads = state.reads;
    await advance(wait - 1);
    expect(state.reads).toBe(reads);
    await advance(1);
    expect(state.reads).toBe(reads + 1);
  }
  state.fail = false;
  state.value = 2;
  await advance(MAX_BACKOFF_MS);
  expect(listener).toHaveBeenLastCalledWith(2, { initial: false });
  const reads = state.reads;
  await advance(IDLE_MS);
  expect(state.reads).toBe(reads + 1);
});

it("backs off from the fast clock too", async () => {
  const { state, definition } = source("flaky-fast", 1);
  start(definition);
  stops.push(holdFast());
  await advance(0);
  state.fail = true;
  await advance(FAST_MS);
  for (const wait of [4_000, 8_000, 16_000, 32_000, MAX_BACKOFF_MS]) {
    const reads = state.reads;
    await advance(wait - 1);
    expect(state.reads).toBe(reads);
    await advance(1);
    expect(state.reads).toBe(reads + 1);
  }
});

it("stops while the tab is hidden and checks at once when it shows again", async () => {
  const { state, definition } = source("hidden", 1);
  const { listener } = start(definition);
  await advance(0);
  show("hidden");
  state.value = 2;
  await advance(IDLE_MS * 10);
  expect(state.reads).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  show("visible");
  await advance(0);
  expect(state.reads).toBe(2);
  expect(listener).toHaveBeenLastCalledWith(2, { initial: false });
  await advance(IDLE_MS);
  expect(state.reads).toBe(3);
});

it("waits for the tab to show before the first read", async () => {
  show("hidden");
  const { state, definition } = source("born-hidden", 1);
  start(definition);
  await advance(IDLE_MS);
  expect(state.reads).toBe(0);
  show("visible");
  await advance(0);
  expect(state.reads).toBe(1);
});

it.each(["focus", "online"])(
  "checks at once on window %s, even during a backoff",
  async (event) => {
    const { state, definition } = source(`wake-${event}`, 1);
    start(definition);
    await advance(0);
    state.fail = true;
    await advance(IDLE_MS);
    state.fail = false;
    window.dispatchEvent(new Event(event));
    // Two wake-ups in a row are one check.
    window.dispatchEvent(new Event(event));
    await advance(0);
    expect(state.reads).toBe(3);
    await advance(IDLE_MS - 1);
    expect(state.reads).toBe(3);
  },
);

it("gives up on a read that hangs and tries again later", async () => {
  const signals: AbortSignal[] = [];
  const definition: Watch<number> = {
    key: "hung",
    read: (signal) => {
      signals.push(signal);
      return new Promise(() => {});
    },
  };
  start(definition);
  await advance(READ_TIMEOUT_MS - 1);
  expect(signals[0]?.aborted).toBe(false);
  await advance(1);
  expect(signals[0]?.aborted).toBe(true);
  expect(signals).toHaveLength(1);
  // A hang counts as an error: the next read waits twice the interval.
  await advance(IDLE_MS * 2);
  expect(signals).toHaveLength(2);
});

it("stopping aborts the read in flight, drops its answer and leaves no timer or listener", async () => {
  const signals: AbortSignal[] = [];
  let answer: (value: number) => void = () => {};
  const definition: Watch<number> = {
    key: "stopped",
    read: (signal) => {
      signals.push(signal);
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
  };
  const { listener, stop } = start(definition);
  await advance(0);
  stop();
  stop();
  expect(signals[0]?.aborted).toBe(true);
  answer(1);
  await advance(0);
  expect(listener).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new Event("focus"));
  show("visible");
  await advance(MAX_BACKOFF_MS);
  expect(signals).toHaveLength(1);
});

it("tells a listener again when its own follow-up failed", async () => {
  const { state, definition } = source("follow-up", 1);
  let broken = true;
  const listener = vi.fn(async () => {
    if (broken) throw new Error("fetch failed");
  });
  start(definition, listener);
  await advance(0);
  expect(listener).toHaveBeenCalledOnce();
  broken = false;
  await advance(IDLE_MS);
  expect(listener.mock.calls).toEqual([
    [1, { initial: true }],
    [1, { initial: true }],
  ]);
  await advance(IDLE_MS);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(state.reads).toBe(3);
});

it("keeps telling the other listeners when one throws", async () => {
  const thrown: (() => void)[] = [];
  vi.stubGlobal("queueMicrotask", (callback: () => void) => {
    thrown.push(callback);
  });
  const { definition } = source("throwing", 1);
  start(definition, () => {
    throw new Error("listener bug");
  });
  const second = start(definition);
  await advance(0);
  expect(second.listener).toHaveBeenCalledOnce();
  // The bug still surfaces, as an uncaught error.
  expect(thrown).toHaveLength(1);
  expect(thrown[0]).toThrow("listener bug");
});
