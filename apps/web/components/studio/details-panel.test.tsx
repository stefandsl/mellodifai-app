import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Film } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Clip } from "@/lib/studio/clips";
import { registerSongTool } from "@/lib/studio/song-tools";
import { useCreateForm } from "@/store/create-form";
import { useDetails, useDetailsClips, useKnownClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { useReactions } from "@/store/reactions";
import { useVideoStudio } from "@/store/video-studio";
import { DetailsPanel } from "./details-panel";
import { PlaylistsProvider } from "./playlists-context";

const mock = vi.hoisted(() => ({
  setReaction: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  renameVersion: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  trashVersions: vi.fn(async () => ({ ok: true, count: 1 })),
  restoreVersions: vi.fn(async () => ({ ok: true, count: 1 })),
  requestStems: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  rpc: vi.fn(async (_name: string, _args: unknown) => ({
    data: [] as unknown,
    error: null as unknown,
  })),
  push: vi.fn(),
  refresh: vi.fn(),
  pathname: "/library",
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/app/actions/library", () => ({
  setReaction: mock.setReaction,
  renameVersion: mock.renameVersion,
  trashVersions: mock.trashVersions,
  restoreVersions: mock.restoreVersions,
}));
vi.mock("@/app/actions/audio-tools", () => ({
  requestStems: mock.requestStems,
  saveEditedTake: vi.fn(),
}));
vi.mock("@/app/actions/playlists", () => ({
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  createPlaylist: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => {
    // The running stems badge follows its job's progress events.
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: async () => ({ data: [] }),
    };
    const channel = { on: () => channel, subscribe: () => channel };
    return {
      rpc: mock.rpc,
      from: () => query,
      channel: () => channel,
      removeChannel: async () => {},
    };
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh, push: mock.push }),
  usePathname: () => mock.pathname,
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

const LYRICS = "[Verse 1]\nSotto la pioggia\n\n[Chorus]\nCanto per te";
const STYLE = "synth pop, dreamy, female vocals, lo-fi, 80s, warm, wide, extra";
function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "v1",
    projectId: "p1",
    lang: "it",
    title: "Lunedì",
    style: STYLE,
    prompt: "una canzone",
    lyrics: LYRICS,
    model: "V6",
    status: "approved",
    createdAt: "2026-02-04T22:00:00Z",
    updatedAt: "2026-02-04T22:00:00Z",
    audioUrl: "https://s/t1.mp3",
    videoUrl: null,
    hookUrl: null,
    href: "/projects/p1?lang=it",
    art: "linear-gradient(red, blue)",
    hasCover: true,
    takes: [
      { id: "t1", number: 1, audioUrl: "https://s/t1.mp3", scores: null },
      { id: "t2", number: 2, audioUrl: "https://s/t2.mp3", scores: null },
    ],
    chosenTakeId: "t1",
    settings: { engine: "ace-step" },
    pack: null,
    jury: null,
    reaction: "none",
    playCount: 12,
    trashedAt: null,
    queuePosition: null,
    stems: null,
    ...patch,
  };
}

// A browser window of the given width: only min-width queries are answered.
function setViewport(width: number) {
  window.matchMedia = ((query: string) => ({
    matches:
      Number(/min-width:\s*(\d+)px/u.exec(query)?.[1] ?? Infinity) <= width,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as never;
}
const setDocked = (docked: boolean) => setViewport(docked ? 1920 : 800);
function setClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}
function panel(lang: "it" | "en" = "it") {
  render(
    <LocaleProvider value={lang}>
      <TooltipProvider>
        <PlaylistsProvider
          value={{
            playlists: [
              {
                id: "pl1",
                name: "Sera",
                songCount: 2,
                createdAt: "",
                updatedAt: "",
              },
            ],
            likedCount: 0,
          }}
        >
          <DetailsPanel />
        </PlaylistsProvider>
      </TooltipProvider>
    </LocaleProvider>,
  );
}
function select(c: Clip = clip(), open = true) {
  useDetails.setState({ open, selectedId: c.id, picked: true });
  useKnownClips.setState({ known: { [c.id]: c } });
}
const aside = () => screen.getByRole("complementary", { name: "Dettagli" });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mock.pathname = "/library";
  setDocked(true);
  setClipboard(async () => {});
  useDetails.setState({ open: false, selectedId: null });
  useKnownClips.setState({ known: {} });
  useReactions.setState({ server: {}, over: {}, pending: {} });
  usePlayer.setState({ queue: [], index: -1, playing: false, time: 0 });
  mock.setReaction.mockResolvedValue({ ok: true });
  mock.rpc.mockResolvedValue({ data: [], error: null });
});
afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: removes the test's own stub.
  delete (window as any).matchMedia;
});

describe("closed", () => {
  it("shows nothing until a song is picked", () => {
    panel();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows nothing when the picked song is not on this page, or the panel was closed", () => {
    useDetails.setState({ open: true, selectedId: "zzz" });
    panel();
    expect(screen.queryByRole("complementary")).toBeNull();
    useDetails.setState({ open: false, selectedId: "v1" });
    useKnownClips.setState({ known: { v1: clip() } });
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("comes back after a reload with the remembered song", async () => {
    select();
    // A new visit: nothing in memory but the stored choice, and the page registers its songs.
    const raw = localStorage.getItem("mellodifai-details") ?? "";
    useDetails.setState({ open: false, selectedId: null });
    useKnownClips.setState({ known: {} });
    localStorage.setItem("mellodifai-details", raw);
    panel();
    useKnownClips.getState().sync([clip()]);
    expect(await screen.findByRole("complementary")).toBeInTheDocument();
    expect(within(aside()).getByText("Lunedì")).toBeInTheDocument();
  });
});

// A page of the app: it registers its songs with the panel.
const PAGE_SONGS = [clip()];
function Page() {
  useDetailsClips(PAGE_SONGS);
  return null;
}

describe("reload with the page's songs arriving first", () => {
  // In the app the page (inside the shell) registers its songs in an effect that runs before the
  // panel's: the remembered choice must survive that.
  it("still shows the song that was open", async () => {
    localStorage.setItem(
      "mellodifai-details",
      JSON.stringify({ state: { open: true, selectedId: "v1" }, version: 1 }),
    );
    render(
      <LocaleProvider value="it">
        <TooltipProvider>
          <PlaylistsProvider value={{ playlists: [], likedCount: 0 }}>
            <Page />
            <DetailsPanel />
          </PlaylistsProvider>
        </TooltipProvider>
      </LocaleProvider>,
    );
    expect(
      await screen.findByRole("complementary", { name: "Dettagli" }),
    ).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("mellodifai-details") ?? "{}").state,
    ).toEqual({ open: true, selectedId: "v1" });
  });
});

describe("content", () => {
  it("shows the cover, title, engine, date, plays and likes", () => {
    select(clip({ reaction: "like" }));
    panel();
    const a = aside();
    expect(
      within(a).getByRole("img", { name: "Copertina di Lunedì" }),
    ).toBeInTheDocument();
    expect(within(a).getByText("Lunedì")).toBeInTheDocument();
    expect(within(a).getByText("ACE-Step")).toBeInTheDocument();
    expect(
      within(a).getByText("Creata il 4 febbraio 2026"),
    ).toBeInTheDocument();
    // The cover chip and the stats row both count the plays.
    expect(within(a).getByText("12 ascolti")).toBeInTheDocument();
    expect(within(a).getByText("Ascolti").nextSibling).toHaveTextContent("12");
    expect(
      within(a).getByText("Mi piace", { selector: "p" }).nextSibling,
    ).toHaveTextContent("1");
  });

  it("shows the model of a kie song", () => {
    select(clip({ settings: {}, model: "V6" }));
    panel();
    expect(within(aside()).getByText("v6")).toBeInTheDocument();
  });

  it("clamps the style tags and expands them", async () => {
    select();
    panel();
    const tags = within(aside()).getByRole("region", { name: "Stile e tag" });
    expect(within(tags).getAllByRole("listitem")).toHaveLength(7);
    expect(within(tags).queryByText("extra")).toBeNull();
    await userEvent.click(
      within(tags).getByRole("button", { name: "+ altri 2" }),
    );
    expect(within(tags).getByText("extra")).toBeInTheDocument();
    await userEvent.click(within(tags).getByRole("button", { name: "Meno" }));
    expect(within(tags).queryByText("extra")).toBeNull();
  });

  it("copies the styles and the lyrics, each showing Copiato for two seconds", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    select();
    panel();
    await userEvent.click(
      screen.getByRole("button", { name: "Copia gli stili" }),
    );
    expect(writeText).toHaveBeenLastCalledWith(STYLE);
    const tags = within(aside()).getByRole("region", { name: "Stile e tag" });
    expect(within(tags).getByText("Copiato")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Copia il testo" }),
    );
    expect(writeText).toHaveBeenLastCalledWith(LYRICS);
    await waitFor(
      () => expect(within(tags).getByText("Copia")).toBeInTheDocument(),
      {
        timeout: 3000,
      },
    );
  });

  it("says so when the clipboard refuses", async () => {
    setClipboard(async () => {
      throw new Error("denied");
    });
    select();
    panel();
    await userEvent.click(
      screen.getByRole("button", { name: "Copia il testo" }),
    );
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Non sono riuscito a copiare",
    );
    expect(screen.queryByText("Copiato")).toBeNull();
  });

  it("shows the lyrics with section tags muted, or says there are none", () => {
    select();
    panel();
    const lyrics = within(aside()).getByRole("region", { name: "Testo" });
    expect(within(lyrics).getByText("Sotto la pioggia")).toBeInTheDocument();
    expect(within(lyrics).getByText("[Verse 1]")).toHaveClass(
      "text-[var(--fg-subtle)]",
    );
  });

  it("says there are no lyrics or styles when the song has none", () => {
    select(clip({ lyrics: "", style: "" }));
    panel();
    expect(
      within(aside()).getByText("Questa canzone non ha un testo."),
    ).toBeInTheDocument();
    expect(
      within(aside()).getByText("Nessuno stile indicato."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copia il testo" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Copia gli stili" }),
    ).toBeDisabled();
  });

  it("links to the full project page", () => {
    select();
    panel();
    expect(
      within(aside()).getByRole("link", { name: "Apri pagina completa" }),
    ).toHaveAttribute("href", "/projects/p1?lang=it");
  });

  it("offers the audio as a download", () => {
    select();
    panel();
    expect(
      within(aside()).getByRole("link", { name: "Scarica l'audio" }),
    ).toHaveAttribute("download", "Lunedì.mp3");
  });

  it("is English when the interface is", () => {
    select();
    panel("en");
    expect(
      screen.getByRole("complementary", { name: "Details" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Created 4 February 2026")).toBeInTheDocument();
  });
});

describe("playing", () => {
  it("plays and pauses the song from the cover", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Riproduci: Lunedì" }),
    );
    expect(usePlayer.getState()).toMatchObject({ playing: true, index: 0 });
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(["v1"]);
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Pausa: Lunedì" }),
    );
    expect(usePlayer.getState().playing).toBe(false);
  });

  it("has no play button for a song without audio", () => {
    select(clip({ audioUrl: null, takes: [] }));
    panel();
    expect(
      within(aside()).queryByRole("button", { name: /Riproduci/u }),
    ).toBeNull();
    expect(
      within(aside()).getByText(
        "Questa canzone non ha ancora un audio da riprodurre.",
      ),
    ).toBeInTheDocument();
  });

  it("lists the takes as chips and plays the one chosen", async () => {
    select();
    panel();
    // The take in use carries "(In uso)" for screen readers.
    const one = within(aside()).getByRole("button", {
      name: "Versione 1 (In uso)",
    });
    const two = within(aside()).getByRole("button", { name: "Versione 2" });
    await userEvent.click(two);
    expect(usePlayer.getState().queue[0]).toMatchObject({
      id: "v1:take-2",
      audioUrl: "https://s/t2.mp3",
    });
    expect(two).toHaveAttribute("aria-pressed", "true");
    // The song's own take goes back to the song itself.
    await userEvent.click(one);
    expect(usePlayer.getState().queue[0]).toMatchObject({
      id: "v1",
      audioUrl: "https://s/t1.mp3",
    });
  });

  it("does not show take chips for a single take", () => {
    select(
      clip({
        takes: [
          { id: "t1", number: 1, audioUrl: "https://s/t1.mp3", scores: null },
        ],
      }),
    );
    panel();
    expect(
      within(aside()).queryByRole("button", { name: /^Versione 1/u }),
    ).toBeNull();
  });
});

describe("closing", () => {
  it("closes with its X and remembers that", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Chiudi i dettagli" }),
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(useDetails.getState()).toMatchObject({
      open: false,
      selectedId: "v1",
    });
    expect(
      JSON.parse(localStorage.getItem("mellodifai-details") ?? "{}").state.open,
    ).toBe(false);
  });

  it("closes with Escape when nothing else is open", async () => {
    select();
    panel();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("leaves Escape to the rename field and to open windows", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Rinomina: Lunedì" }),
    );
    await userEvent.keyboard("{Escape}");
    // Escape cancelled the edit only.
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Titolo della canzone")).toBeNull();

    await userEvent.click(
      within(aside()).getByRole("button", { name: "Condividi" }),
    );
    await screen.findByRole("dialog", { name: "Condividi" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("leaves Escape to an open menu", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Altre opzioni" }),
    );
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("forgets a song that was moved to the trash from the panel", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Altre opzioni" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Sposta nel cestino" }),
    );
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(mock.trashVersions).toHaveBeenCalledWith({ versionIds: ["v1"] });
    expect(useDetails.getState().selectedId).toBeNull();
  });
});

describe("actions", () => {
  it("renames the song", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Rinomina: Lunedì" }),
    );
    const field = screen.getByLabelText("Titolo della canzone");
    await userEvent.clear(field);
    await userEvent.type(field, "Martedì{Enter}");
    expect(mock.renameVersion).toHaveBeenCalledWith({
      versionId: "v1",
      title: "Martedì",
    });
  });

  it("likes the song", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Mi piace" }),
    );
    expect(mock.setReaction).toHaveBeenCalledWith({
      versionId: "v1",
      reaction: "like",
    });
  });

  it("opens the share window for the song", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Condividi" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Condividi" });
    expect(within(dialog).getByLabelText("Link alla canzone")).toHaveValue(
      `${window.location.origin}/projects/p1?lang=it`,
    );
  });

  it("opens the add-to-playlist window for the song", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Aggiungi a playlist" }),
    );
    expect(
      await screen.findByRole("button", { name: /Sera/u }),
    ).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith("playlist_membership", {
      p_versions: ["v1"],
    });
  });
});

describe("tools", () => {
  it("offers the prompt, the video studio, the editor, the rewrite, the stems, cover and reference", () => {
    select();
    panel();
    const tools = within(aside()).getByRole("region", { name: "Strumenti" });
    expect(
      within(tools)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "Riusa il prompt",
      "Crea video visualizer",
      "Modifica audio",
      "Riscrivi una parte",
      "Estrai stems",
      "Cover di questa canzone",
      "Usa come riferimento",
    ]);
  });

  it("opens the Video Studio for the song", async () => {
    select();
    panel();
    const tools = within(aside()).getByRole("region", { name: "Strumenti" });
    await userEvent.click(
      within(tools).getByRole("button", { name: "Crea video visualizer" }),
    );
    const studio = useVideoStudio.getState();
    expect(studio.open).toBe(true);
    expect(studio.clip?.id).toBe("v1");
    expect(studio.setup).toBe(false);
    useVideoStudio.setState({ open: false, clip: null });
  });

  it("opens the audio editor and the stems page of the song", async () => {
    select();
    panel();
    const tools = within(aside()).getByRole("region", { name: "Strumenti" });
    await userEvent.click(
      within(tools).getByRole("button", { name: "Modifica audio" }),
    );
    expect(mock.push).toHaveBeenLastCalledWith("/editor/v1");
    await userEvent.click(
      within(tools).getByRole("button", { name: "Estrai stems" }),
    );
    // Never asked yet: the stems are asked for, then the page shows their progress.
    expect(mock.requestStems).toHaveBeenCalledWith({ versionId: "v1" });
    await waitFor(() =>
      expect(mock.push).toHaveBeenLastCalledWith("/stems/v1"),
    );
  });

  it("opens ready or running stems without asking the render PC again", async () => {
    for (const status of ["done", "running", "queued"] as const) {
      mock.requestStems.mockClear();
      select(
        clip({
          stems: { takeId: "t1", status, jobId: "j1", queuePosition: null },
        }),
      );
      panel();
      const tools = within(aside()).getByRole("region", { name: "Strumenti" });
      await userEvent.click(
        within(tools).getByRole("button", { name: "Estrai stems" }),
      );
      await waitFor(() =>
        expect(mock.push).toHaveBeenLastCalledWith("/stems/v1"),
      );
      expect(mock.requestStems).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("shows each audio tool only where it applies", () => {
    const names = (c: Clip) => {
      select(c);
      panel();
      const tools = within(aside()).queryByRole("region", {
        name: "Strumenti",
      });
      const found = tools
        ? within(tools)
            .getAllByRole("button")
            .map((button) => button.textContent)
        : [];
      cleanup();
      return found;
    };
    // A video being rendered keeps its take: stems yes, an edit no.
    expect(names(clip({ status: "video_review" }))).toContain("Modifica audio");
    // No chosen take: nothing to edit or separate, but a part of a take may be rewritten and a
    // take may start a cover or a reference.
    expect(names(clip({ status: "takes_review", chosenTakeId: null }))).toEqual(
      [
        "Riusa il prompt",
        "Riscrivi una parte",
        "Cover di questa canzone",
        "Usa come riferimento",
      ],
    );
    expect(
      names(clip({ takes: [], audioUrl: null, chosenTakeId: "t1" })),
    ).toEqual(["Riusa il prompt"]);
  });

  it("fills the create form with the song's prompt", async () => {
    select();
    panel();
    await userEvent.click(
      within(aside()).getByRole("button", { name: "Riusa il prompt" }),
    );
    expect(useCreateForm.getState()).toMatchObject({
      prompt: "una canzone",
      lyrics: LYRICS,
      styles: STYLE,
      languages: ["it"],
      mode: "advanced",
    });
    expect(mock.toast.success).toHaveBeenCalledWith(
      "Prompt copiato nel modulo",
    );
  });

  it("shows a tool a later feature registers, and runs it with the song", async () => {
    const run = vi.fn();
    const remove = registerSongTool({
      id: "video-studio",
      label: "clip.downloadVideo",
      icon: Film,
      order: 100,
      run,
    });
    try {
      select();
      panel();
      const button = within(aside()).getByRole("button", {
        name: "Scarica video",
      });
      await userEvent.click(button);
      expect(run).toHaveBeenCalledTimes(1);
      const context = run.mock.calls[0]?.[0];
      expect(context.clip.id).toBe("v1");
      expect(context.lang).toBe("it");
      context.navigate("/somewhere");
      expect(mock.push).toHaveBeenCalledWith("/somewhere");
    } finally {
      remove();
    }
  });
});

describe("a song being made", () => {
  it("shows the stage instead of the tools", () => {
    select(
      clip({ status: "song_queued", audioUrl: null, takes: [], playCount: 0 }),
    );
    panel();
    const a = aside();
    expect(within(a).getByText("In lavorazione")).toBeInTheDocument();
    expect(within(a).getByText("Composizione...")).toBeInTheDocument();
    expect(within(a).queryByRole("region", { name: "Strumenti" })).toBeNull();
    expect(within(a).queryByRole("button", { name: /Riproduci/u })).toBeNull();
    expect(within(a).queryByText("0 ascolti")).toBeNull();
  });

  it("shows the queue position", () => {
    select(
      clip({
        status: "song_queued",
        audioUrl: null,
        takes: [],
        queuePosition: 3,
      }),
    );
    panel();
    expect(within(aside()).getByText("In coda #3")).toBeInTheDocument();
  });
});

describe("where it docks", () => {
  it("docks from 1280 px on a page without the create form", () => {
    setViewport(1280);
    select();
    panel();
    expect(
      screen.getByRole("complementary", { name: "Dettagli" }),
    ).toBeInTheDocument();
  });

  it("opens as a sheet at 1279 px", () => {
    setViewport(1279);
    select();
    panel();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Dettagli" }),
    ).toBeInTheDocument();
  });

  it("leaves the feed room on the Create page: a sheet at 1440 px, docked from 1600 px", () => {
    mock.pathname = "/create";
    setViewport(1440);
    select();
    const { unmount } = render(
      <LocaleProvider value="it">
        <TooltipProvider>
          <PlaylistsProvider value={{ playlists: [], likedCount: 0 }}>
            <DetailsPanel />
          </PlaylistsProvider>
        </TooltipProvider>
      </LocaleProvider>,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Dettagli" }),
    ).toBeInTheDocument();
    unmount();
    setViewport(1600);
    panel();
    expect(
      screen.getByRole("complementary", { name: "Dettagli" }),
    ).toBeInTheDocument();
  });
});

describe("below 1280 px", () => {
  beforeEach(() => setDocked(false));

  it("does not greet the user with a sheet after a reload: only a song picked in this visit opens it", async () => {
    useDetails.setState({ open: true, selectedId: "v1", picked: false });
    useKnownClips.setState({ known: { v1: clip() } });
    panel();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useDetails.getState().show("v1"));
    expect(
      await screen.findByRole("dialog", { name: "Dettagli" }),
    ).toBeInTheDocument();
  });

  it("opens as a sheet over the page instead of docking", () => {
    select();
    panel();
    expect(screen.queryByRole("complementary")).toBeNull();
    const sheet = screen.getByRole("dialog", { name: "Dettagli" });
    expect(within(sheet).getByText("Lunedì")).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "Riproduci: Lunedì" }),
    ).toBeInTheDocument();
  });

  it("closes with its X and with Escape", async () => {
    select();
    panel();
    await userEvent.click(
      screen.getByRole("button", { name: "Chiudi i dettagli" }),
    );
    expect(useDetails.getState().open).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();

    select();
    await screen.findByRole("dialog", { name: "Dettagli" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(useDetails.getState().open).toBe(false));
  });

  it("still opens the share window from inside the sheet", async () => {
    select();
    panel();
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Dettagli" })).getByRole(
        "button",
        { name: "Condividi" },
      ),
    );
    expect(
      await screen.findByRole("dialog", { name: "Condividi" }),
    ).toBeInTheDocument();
  });
});
