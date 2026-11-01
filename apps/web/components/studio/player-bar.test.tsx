import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
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
  });
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
