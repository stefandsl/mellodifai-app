import { expect, it, vi } from "vitest";
import { createPlayCounter, PLAY_SECONDS } from "./play-counter";

// Plays the track from `from` to `to` in the half-second steps of the audio clock.
function listen(
  counter: ReturnType<typeof createPlayCounter>,
  id: string,
  from: number,
  to: number,
) {
  for (let t = from; t <= to; t += 0.5) counter.tick(id, t);
}

it("counts a play after 30 s of listening, once", () => {
  const onPlay = vi.fn();
  const counter = createPlayCounter(onPlay);
  listen(counter, "a", 0, PLAY_SECONDS - 1);
  expect(onPlay).not.toHaveBeenCalled();
  listen(counter, "a", PLAY_SECONDS - 1, 120);
  expect(onPlay).toHaveBeenCalledTimes(1);
  expect(onPlay).toHaveBeenCalledWith("a");
});

it("does not count a seek as listening", () => {
  const onPlay = vi.fn();
  const counter = createPlayCounter(onPlay);
  listen(counter, "a", 0, 5);
  counter.tick("a", 100);
  listen(counter, "a", 100, 110);
  expect(onPlay).not.toHaveBeenCalled();
  // Going back is not listening either.
  counter.tick("a", 2);
  expect(onPlay).not.toHaveBeenCalled();
});

it("starts over for another track and counts a repeated one again after reset", () => {
  const onPlay = vi.fn();
  const counter = createPlayCounter(onPlay);
  listen(counter, "a", 0, 20);
  listen(counter, "b", 0, 20);
  listen(counter, "a", 0, 20);
  expect(onPlay).not.toHaveBeenCalled();
  listen(counter, "a", 20, 40);
  expect(onPlay).toHaveBeenCalledTimes(1);
  counter.reset();
  listen(counter, "a", 0, 40);
  expect(onPlay).toHaveBeenCalledTimes(2);
});
