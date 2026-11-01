import { beforeEach, describe, expect, it } from "vitest";
import {
  clampSpeed,
  nextRepeat,
  SPEEDS,
  type Track,
  usePlayer,
} from "./player";

const track = (id: string): Track => ({
  id,
  title: id,
  subtitle: "",
  audioUrl: `https://s/${id}.mp3`,
  videoUrl: null,
  href: "/",
  art: "",
  reaction: "none",
});

beforeEach(() => {
  localStorage.clear();
  usePlayer.setState({
    queue: [],
    index: -1,
    playing: false,
    time: 0,
    duration: 0,
    repeat: "off",
    shuffle: false,
    speed: 1,
    showNow: false,
  });
});

describe("repeat", () => {
  it("cycles off, all, one and back to off", () => {
    expect(nextRepeat("off")).toBe("all");
    expect(nextRepeat("all")).toBe("one");
    expect(nextRepeat("one")).toBe("off");
  });
  it("stops at the end of the queue with repeat off", () => {
    usePlayer.getState().play(track("b"), [track("a"), track("b")]);
    usePlayer.getState().ended();
    expect(usePlayer.getState()).toMatchObject({ index: 1, playing: false });
  });
  it("goes on to the next song and wraps to the first with repeat all", () => {
    const list = [track("a"), track("b")];
    usePlayer.getState().play(list[0] as Track, list);
    usePlayer.setState({ repeat: "all" });
    usePlayer.getState().ended();
    expect(usePlayer.getState()).toMatchObject({ index: 1, playing: true });
    usePlayer.getState().ended();
    expect(usePlayer.getState()).toMatchObject({ index: 0, playing: true });
  });
  it("starts the same song again with repeat one, and keeps it playing", () => {
    const list = [track("a"), track("b")];
    usePlayer.getState().play(list[0] as Track, list);
    usePlayer.setState({ repeat: "one", time: 90 });
    const before = usePlayer.getState().seekTo.n;
    usePlayer.getState().ended();
    const state = usePlayer.getState();
    expect(state).toMatchObject({ index: 0, playing: true, time: 0 });
    expect(state.seekTo.n).toBe(before + 1);
    expect(state.seekTo.at).toBe(0);
  });
  it("restarts a one-song queue with repeat all instead of freezing on the end", () => {
    usePlayer.getState().play(track("a"));
    usePlayer.setState({ repeat: "all" });
    const before = usePlayer.getState().seekTo.n;
    usePlayer.getState().ended();
    expect(usePlayer.getState()).toMatchObject({ index: 0, playing: true });
    expect(usePlayer.getState().seekTo.n).toBe(before + 1);
  });
  it("never picks the song that just ended when shuffling", () => {
    const list = ["a", "b", "c"].map(track);
    usePlayer.getState().play(list[1] as Track, list);
    usePlayer.setState({ shuffle: true });
    for (let i = 0; i < 40; i += 1) {
      const before = usePlayer.getState().index;
      usePlayer.getState().next();
      expect(usePlayer.getState().index).not.toBe(before);
    }
  });
});

describe("speed", () => {
  it("offers 0.5x to 2x with 1x in the middle", () => {
    expect(SPEEDS[0]).toBe(0.5);
    expect(SPEEDS.at(-1)).toBe(2);
    expect(SPEEDS).toContain(1);
  });
  it("clamps to the supported range", () => {
    expect(clampSpeed(0.1)).toBe(0.5);
    expect(clampSpeed(9)).toBe(2);
    expect(clampSpeed(1.25)).toBe(1.25);
    expect(clampSpeed(Number.NaN)).toBe(1);
  });
  it("is remembered between visits and nothing else is stored", async () => {
    usePlayer.getState().setSpeed(1.5);
    expect(usePlayer.getState().speed).toBe(1.5);
    const saved = JSON.parse(
      localStorage.getItem("mellodifai-player") ?? "{}",
    ) as { state?: Record<string, unknown> };
    expect(saved.state).toEqual({ speed: 1.5 });
    // A new visit: the store starts at 1 and reads what was kept.
    localStorage.setItem("mellodifai-player", JSON.stringify(saved));
    usePlayer.setState({ speed: 1 });
    localStorage.setItem("mellodifai-player", JSON.stringify(saved));
    await usePlayer.persist.rehydrate();
    expect(usePlayer.getState().speed).toBe(1.5);
  });
  it("ignores a stored speed that is out of range", async () => {
    localStorage.setItem(
      "mellodifai-player",
      JSON.stringify({ state: { speed: 40 }, version: 1 }),
    );
    await usePlayer.persist.rehydrate();
    expect(usePlayer.getState().speed).toBe(2);
  });
});

describe("listening view", () => {
  it("opens and closes without touching playback", () => {
    usePlayer.getState().play(track("a"));
    usePlayer.getState().set({ showNow: true });
    expect(usePlayer.getState()).toMatchObject({
      showNow: true,
      playing: true,
    });
    usePlayer.getState().set({ showNow: false });
    expect(usePlayer.getState().playing).toBe(true);
  });
});
