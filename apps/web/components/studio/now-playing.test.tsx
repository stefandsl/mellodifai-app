import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type Track, type TrackDetail, usePlayer } from "@/store/player";
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

const LYRICS =
  "[Verse 1]\nSotto la pioggia\nCammino piano\n\n[Chorus]\nCanto per te";
const detail = (patch: Partial<TrackDetail> = {}): TrackDetail => ({
  songId: "v1",
  lyrics: LYRICS,
  style: "synth pop, dreamy, female vocals, lo-fi, extra phrase",
  createdAt: "2026-02-04T22:00:00Z",
  takes: [
    { id: "t1", number: 1, audioUrl: "https://s/t1.mp3" },
    { id: "t2", number: 2, audioUrl: "https://s/t2.mp3" },
  ],
  chosenTakeId: "t1",
  own: {
    title: "Lunedì",
    subtitle: "IT · ACE-Step",
    videoUrl: null,
    reaction: "none",
  },
  ...patch,
});
const track = (patch: Partial<Track> = {}): Track => ({
  id: "v1",
  title: "Lunedì",
  subtitle: "IT · ACE-Step",
  audioUrl: "https://s/t1.mp3",
  videoUrl: null,
  href: "/projects/p1?lang=it",
  art: "linear-gradient(red, blue)",
  reaction: "none",
  detail: detail(),
  ...patch,
});

function bar(lang: "it" | "en" = "it") {
  render(
    <LocaleProvider value={lang}>
      <TooltipProvider>
        <PlayerBar />
      </TooltipProvider>
    </LocaleProvider>,
  );
}
const view = () => screen.queryByRole("dialog");
const open = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Lunedì" }));
  return await screen.findByRole("dialog");
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLMediaElement.prototype.play = vi.fn(async () => {});
  HTMLMediaElement.prototype.pause = vi.fn();
  useReactions.setState({ server: {}, over: {}, pending: {} });
  usePlayer.setState({
    queue: [track()],
    index: 0,
    playing: true,
    time: 12,
    duration: 200,
    showNow: false,
    showQueue: false,
    showVideo: false,
    repeat: "off",
    speed: 1,
    shuffle: false,
  });
  localStorage.clear();
});

describe("opening and closing", () => {
  it("opens when the title is clicked, with the song's name", async () => {
    bar();
    expect(view()).not.toBeInTheDocument();
    const dialog = await open();
    expect(
      within(dialog).getByRole("heading", { name: "Lunedì" }),
    ).toBeVisible();
    expect(within(dialog).getByText("In ascolto")).toBeInTheDocument();
  });

  it("opens from the cover and from the expand button", async () => {
    bar();
    const [cover] = screen.getAllByRole("button", {
      name: "Apri la vista di ascolto",
    });
    await userEvent.click(cover as HTMLElement);
    expect(await screen.findByRole("dialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(view()).not.toBeInTheDocument());
    const buttons = screen.getAllByRole("button", {
      name: "Apri la vista di ascolto",
    });
    await userEvent.click(buttons.at(-1) as HTMLElement);
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("closes with Escape and keeps playing", async () => {
    bar();
    await open();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(view()).not.toBeInTheDocument());
    expect(usePlayer.getState()).toMatchObject({
      showNow: false,
      playing: true,
    });
  });

  it("closes with its close button", async () => {
    bar();
    const dialog = await open();
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Chiudi la vista di ascolto",
      }),
    );
    await waitFor(() => expect(view()).not.toBeInTheDocument());
  });

  it("closes by itself when nothing is left to play", async () => {
    bar();
    await open();
    usePlayer.setState({ queue: [], index: -1, showNow: true });
    await waitFor(() => expect(view()).not.toBeInTheDocument());
  });

  it("is in English in the English interface", async () => {
    bar("en");
    await userEvent.click(screen.getByRole("button", { name: "Lunedì" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Now playing")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "Lyrics" }),
    ).toBeInTheDocument();
  });
});

describe("what it shows", () => {
  it("shows the lyrics, the first four style phrases and the date", async () => {
    bar();
    const dialog = await open();
    expect(within(dialog).getByText("Sotto la pioggia")).toBeVisible();
    expect(within(dialog).getByText("[Chorus]")).toBeVisible();
    for (const chip of ["synth pop", "dreamy", "female vocals", "lo-fi"])
      expect(within(dialog).getByText(chip)).toBeVisible();
    expect(within(dialog).queryByText("extra phrase")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(/Creata il 4 febbraio 2026/u),
    ).toBeVisible();
  });

  it("says when the song has no lyrics", async () => {
    usePlayer.setState({
      queue: [track({ detail: detail({ lyrics: "  " }) })],
    });
    bar();
    const dialog = await open();
    expect(
      within(dialog).getByText("Questa canzone non ha un testo."),
    ).toBeVisible();
  });

  it("still opens for a track with no detail", async () => {
    usePlayer.setState({ queue: [track({ detail: undefined })] });
    bar();
    const dialog = await open();
    expect(
      within(dialog).getByRole("heading", { name: "Lunedì" }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Mi piace" }),
    ).not.toBeInTheDocument();
  });
});

describe("takes as chips", () => {
  it("shows one chip per take with the playing one pressed", async () => {
    bar();
    const dialog = await open();
    const one = within(dialog).getByRole("button", { name: "Versione 1" });
    const two = within(dialog).getByRole("button", { name: "Versione 2" });
    expect(one).toHaveAttribute("aria-pressed", "true");
    expect(two).toHaveAttribute("aria-pressed", "false");
  });

  it("plays the other take as a preview, and goes back to the song", async () => {
    bar();
    const dialog = await open();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Versione 2" }),
    );
    let now = usePlayer.getState().queue[usePlayer.getState().index];
    expect(now).toMatchObject({
      id: "v1:take-2",
      audioUrl: "https://s/t2.mp3",
      reaction: null,
    });
    expect(
      within(dialog).getByRole("button", { name: "Versione 2" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Versione 1" }),
    );
    now = usePlayer.getState().queue[usePlayer.getState().index];
    expect(now).toMatchObject({
      id: "v1",
      audioUrl: "https://s/t1.mp3",
      reaction: "none",
      title: "Lunedì",
    });
    expect(now?.detail?.takeNumber).toBeUndefined();
  });

  it("pressing the chip of the take that plays pauses and resumes it", async () => {
    bar();
    const dialog = await open();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Versione 1" }),
    );
    expect(usePlayer.getState().playing).toBe(false);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Versione 1" }),
    );
    expect(usePlayer.getState().playing).toBe(true);
  });

  it("is not shown for a song with a single take", async () => {
    usePlayer.setState({
      queue: [
        track({
          detail: detail({
            takes: [{ id: "t1", number: 1, audioUrl: "https://s/t1.mp3" }],
          }),
        }),
      ],
    });
    bar();
    const dialog = await open();
    expect(
      within(dialog).queryByRole("button", { name: "Versione 1" }),
    ).not.toBeInTheDocument();
  });

  it("follows a take preview that is already playing", async () => {
    usePlayer.setState({
      queue: [
        track({
          id: "v1:take-2",
          audioUrl: "https://s/t2.mp3",
          reaction: null,
          detail: detail({ takeNumber: 2 }),
        }),
      ],
    });
    bar();
    await userEvent.click(screen.getByRole("button", { name: "Lunedì" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Versione 2" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("actions", () => {
  it("likes and dislikes the song from the view", async () => {
    bar();
    const dialog = await open();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Mi piace" }),
    );
    expect(mock.setReaction).toHaveBeenLastCalledWith({
      versionId: "v1",
      reaction: "like",
    });
    expect(
      within(dialog).getByRole("button", { name: "Mi piace" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("downloads the audio under the song's title", async () => {
    bar();
    const dialog = await open();
    expect(
      within(dialog).getByRole("link", { name: "Scarica l'audio" }),
    ).toHaveAttribute("download", "Lunedì.mp3");
  });

  it("opens the share window and copies the song's link from it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    bar();
    const dialog = await open();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Condividi" }),
    );
    const share = await screen.findByRole("dialog", { name: "Condividi" });
    await userEvent.click(
      within(share).getByRole("button", { name: "Copia il link" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/projects/p1?lang=it`,
      ),
    );
    expect(mock.toast.success).toHaveBeenCalledWith("Link copiato");
  });

  it("says so when the link cannot be copied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    bar();
    const dialog = await open();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Condividi" }),
    );
    const share = await screen.findByRole("dialog", { name: "Condividi" });
    await userEvent.click(
      within(share).getByRole("button", { name: "Copia il link" }),
    );
    await waitFor(() =>
      expect(mock.toast.error).toHaveBeenCalledWith(
        "Non riesco a copiare il link",
      ),
    );
  });

  it("links to the project and closes when followed", async () => {
    bar();
    const dialog = await open();
    const link = within(dialog).getByRole("link", { name: "Apri il progetto" });
    expect(link).toHaveAttribute("href", "/projects/p1?lang=it");
    await userEvent.click(link);
    expect(usePlayer.getState().showNow).toBe(false);
  });
});

describe("transport inside the view", () => {
  it("plays, pauses, skips, repeats and changes speed", async () => {
    usePlayer.setState({
      queue: [track(), track({ id: "v2", title: "Martedì" })],
    });
    bar();
    const dialog = await open();
    await userEvent.click(
      within(dialog)
        .getAllByRole("button", { name: "Pausa" })
        .at(-1) as HTMLElement,
    );
    expect(usePlayer.getState().playing).toBe(false);
    await userEvent.click(
      within(dialog)
        .getAllByRole("button", { name: "Riproduci" })
        .at(-1) as HTMLElement,
    );
    expect(usePlayer.getState().playing).toBe(true);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Successiva" }),
    );
    expect(usePlayer.getState().index).toBe(1);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Ripeti: no" }),
    );
    expect(usePlayer.getState().repeat).toBe("all");
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Velocità di riproduzione: 1x",
      }),
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "2x" }),
    );
    expect(usePlayer.getState().speed).toBe(2);
  });

  it("seeks with its slider", async () => {
    bar();
    const dialog = await open();
    const slider = within(dialog).getByRole("slider", { name: "Posizione" });
    expect(slider).toHaveAttribute("aria-valuetext", "0:12 / 3:20");
  });
});

describe("audio tools", () => {
  it("links the editor and the stems page when they apply, and closes the view", async () => {
    usePlayer.setState({
      queue: [
        track({ detail: detail({ tools: { edit: true, stems: true } }) }),
      ],
    });
    bar();
    const dialog = await open();
    const edit = within(dialog).getByRole("link", { name: "Modifica audio" });
    expect(edit).toHaveAttribute("href", "/editor/v1");
    expect(
      within(dialog).getByRole("link", { name: "Estrai stems" }),
    ).toHaveAttribute("href", "/stems/v1");
    await userEvent.click(edit);
    expect(usePlayer.getState().showNow).toBe(false);
  });

  it("shows neither for a song they do not apply to", async () => {
    usePlayer.setState({
      queue: [
        track({ detail: detail({ tools: { edit: false, stems: false } }) }),
      ],
    });
    bar();
    const dialog = await open();
    expect(
      within(dialog).queryByRole("link", { name: "Modifica audio" }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("link", { name: "Estrai stems" }),
    ).toBeNull();
  });
});
