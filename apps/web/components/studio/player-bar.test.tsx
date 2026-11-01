import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type Track, usePlayer } from "@/store/player";
import { useReactions } from "@/store/reactions";
import { PlayerBar } from "./player-bar";

const mock = vi.hoisted(() => ({
  setReaction: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  countPlay: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/app/actions/library", () => ({
  setReaction: mock.setReaction,
  countPlay: mock.countPlay,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh, push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

const track = (patch: Partial<Track> = {}): Track => ({
  id: "v1",
  title: "Lunedì",
  subtitle: "IT · v6",
  audioUrl: "https://s/v1.mp3",
  videoUrl: null,
  href: "/projects/p1?lang=it",
  art: "",
  reaction: "none",
  ...patch,
});

function bar() {
  render(
    <LocaleProvider value="it">
      <TooltipProvider>
        <PlayerBar />
      </TooltipProvider>
    </LocaleProvider>,
  );
  return document.querySelector("audio") as HTMLAudioElement;
}
// jsdom does not play media: the element only needs a clock the test can move.
function at(audio: HTMLAudioElement, seconds: number) {
  Object.defineProperty(audio, "currentTime", {
    configurable: true,
    writable: true,
    value: seconds,
  });
  fireEvent.timeUpdate(audio);
}

beforeEach(() => {
  vi.clearAllMocks();
  HTMLMediaElement.prototype.play = vi.fn(async () => {});
  HTMLMediaElement.prototype.pause = vi.fn();
  useReactions.setState({ server: {}, over: {}, pending: {} });
  usePlayer.setState({
    queue: [track()],
    index: 0,
    playing: true,
    time: 0,
    duration: 200,
    showQueue: false,
    showVideo: false,
    showNow: false,
    repeat: "off",
    speed: 1,
    shuffle: false,
  });
  localStorage.clear();
});

it("likes the playing song from the player bar and clears it again", async () => {
  bar();
  const like = screen.getByRole("button", { name: "Mi piace" });
  const dislike = screen.getByRole("button", { name: "Non mi piace" });
  expect(like).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(like);
  expect(mock.setReaction).toHaveBeenLastCalledWith({
    versionId: "v1",
    reaction: "like",
  });
  expect(like).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(dislike);
  expect(like).toHaveAttribute("aria-pressed", "false");
  expect(dislike).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(dislike);
  expect(mock.setReaction).toHaveBeenLastCalledWith({
    versionId: "v1",
    reaction: "none",
  });
  expect(dislike).toHaveAttribute("aria-pressed", "false");
});

it("shows the reaction the feed already knows", () => {
  useReactions.setState({ server: { v1: "dislike" } });
  bar();
  expect(screen.getByRole("button", { name: "Non mi piace" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("has no like buttons for a take preview", () => {
  usePlayer.setState({ queue: [track({ id: "v1:take", reaction: null })] });
  bar();
  expect(
    screen.queryByRole("button", { name: "Mi piace" }),
  ).not.toBeInTheDocument();
});

it("counts a play after 30 s of listening, not before and not twice", async () => {
  const audio = bar();
  act(() => {
    for (let t = 0; t <= 29; t += 0.5) at(audio, t);
  });
  expect(mock.countPlay).not.toHaveBeenCalled();
  act(() => {
    for (let t = 29.5; t <= 90; t += 0.5) at(audio, t);
  });
  await waitFor(() => expect(mock.countPlay).toHaveBeenCalledTimes(1));
  expect(mock.countPlay).toHaveBeenCalledWith({ versionId: "v1" });
});

it("does not count previews or a skip to the middle of a song", () => {
  const audio = bar();
  act(() => {
    at(audio, 0);
    at(audio, 100);
    at(audio, 100.5);
  });
  expect(mock.countPlay).not.toHaveBeenCalled();
  act(() =>
    usePlayer.setState({ queue: [track({ id: "v1:take", reaction: null })] }),
  );
  act(() => {
    for (let t = 0; t <= 60; t += 0.5) at(audio, t);
  });
  expect(mock.countPlay).not.toHaveBeenCalled();
});

const two = () => [track({ id: "v1" }), track({ id: "v2", title: "Martedì" })];

describe("repeat", () => {
  it("cycles off, all, one, off and says which one is on", async () => {
    bar();
    const press = async (name: string) => {
      await userEvent.click(screen.getByRole("button", { name }));
    };
    expect(screen.getByRole("button", { name: "Ripeti: no" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await press("Ripeti: no");
    expect(
      screen.getByRole("button", { name: "Ripeti: tutte" }),
    ).toHaveAttribute("aria-pressed", "true");
    await press("Ripeti: tutte");
    expect(screen.getByRole("button", { name: "Ripeti: una" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await press("Ripeti: una");
    expect(screen.getByRole("button", { name: "Ripeti: no" })).toBeVisible();
    expect(usePlayer.getState().repeat).toBe("off");
  });

  it("repeat one plays the song again from the start, and counts it again", async () => {
    usePlayer.setState({ repeat: "one", queue: two(), index: 0 });
    const audio = bar();
    const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
    act(() => {
      for (let t = 0; t <= 31; t += 0.5) at(audio, t);
    });
    await waitFor(() => expect(mock.countPlay).toHaveBeenCalledTimes(1));
    play.mockClear();
    // The element has ended and is paused: a repeat has to start it again.
    Object.defineProperty(audio, "paused", { configurable: true, value: true });
    act(() => {
      fireEvent.ended(audio);
    });
    expect(usePlayer.getState()).toMatchObject({ index: 0, playing: true });
    expect(audio.currentTime).toBe(0);
    await waitFor(() => expect(play).toHaveBeenCalled());
    act(() => {
      for (let t = 0; t <= 31; t += 0.5) at(audio, t);
    });
    await waitFor(() => expect(mock.countPlay).toHaveBeenCalledTimes(2));
  });

  it("repeat all goes from the last song back to the first", () => {
    usePlayer.setState({ repeat: "all", queue: two(), index: 1 });
    const audio = bar();
    act(() => {
      fireEvent.ended(audio);
    });
    expect(usePlayer.getState()).toMatchObject({ index: 0, playing: true });
  });

  it("repeat off stops after the last song", () => {
    usePlayer.setState({ queue: two(), index: 1 });
    const audio = bar();
    act(() => {
      fireEvent.ended(audio);
    });
    expect(usePlayer.getState()).toMatchObject({ index: 1, playing: false });
  });
});

describe("speed", () => {
  it("offers 0.5x to 2x and applies the choice to the audio", async () => {
    const audio = bar();
    expect(audio.playbackRate).toBe(1);
    await userEvent.click(
      screen.getByRole("button", { name: "Velocità di riproduzione: 1x" }),
    );
    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "0.5x",
      "0.75x",
      "Normale",
      "1.25x",
      "1.5x",
      "1.75x",
      "2x",
    ]);
    await userEvent.click(screen.getByRole("menuitemradio", { name: "1.5x" }));
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.defaultPlaybackRate).toBe(1.5);
    expect(
      screen.getByRole("button", { name: "Velocità di riproduzione: 1.5x" }),
    ).toBeVisible();
  });

  it("is remembered: a new visit starts at the saved speed", async () => {
    localStorage.setItem(
      "mellodifai-player",
      JSON.stringify({ state: { speed: 0.75 }, version: 1 }),
    );
    const audio = bar();
    await waitFor(() => expect(audio.playbackRate).toBe(0.75));
    expect(
      screen.getByRole("button", { name: "Velocità di riproduzione: 0.75x" }),
    ).toBeVisible();
  });

  it("keeps the speed for the next song", async () => {
    usePlayer.setState({ queue: two(), index: 0, speed: 1.25 });
    const audio = bar();
    act(() => usePlayer.getState().next());
    await waitFor(() => expect(usePlayer.getState().index).toBe(1));
    expect(audio.playbackRate).toBe(1.25);
  });
});

describe("download", () => {
  it("is a download of the current audio under the song's title", () => {
    bar();
    const link = screen.getByRole("link", { name: "Scarica l'audio" });
    expect(link).toHaveAttribute("download", "Lunedì.mp3");
    const url = new URL(link.getAttribute("href") ?? "");
    expect(url.origin + url.pathname).toBe("https://s/v1.mp3");
    expect(url.searchParams.get("download")).toBe("Lunedì.mp3");
  });
  it("follows the song that plays", () => {
    usePlayer.setState({ queue: two(), index: 1 });
    bar();
    expect(
      screen.getByRole("link", { name: "Scarica l'audio" }),
    ).toHaveAttribute("download", "Martedì.mp3");
  });
  it("is not there with nothing playing", () => {
    usePlayer.setState({ queue: [], index: -1 });
    bar();
    expect(
      screen.queryByRole("link", { name: "Scarica l'audio" }),
    ).not.toBeInTheDocument();
  });
});
