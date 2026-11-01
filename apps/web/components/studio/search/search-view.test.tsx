import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Clip } from "@/lib/studio/clips";
import { useDetails, useKnownClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { PlaylistsProvider } from "../playlists-context";
import { SearchView } from "./search-view";

const mock = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/app/actions/library", () => ({
  setReaction: vi.fn(),
  renameVersion: vi.fn(),
  trashVersions: vi.fn(),
  restoreVersions: vi.fn(),
}));
vi.mock("@/app/actions/playlists", () => ({
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  createPlaylist: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ rpc: vi.fn(async () => ({ data: [], error: null })) }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh, push: mock.push }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

function clip(id: string, patch: Partial<Clip> = {}): Clip {
  return {
    id,
    projectId: `p-${id}`,
    lang: "it",
    title: `Canzone ${id}`,
    style: "pop",
    prompt: "",
    lyrics: "",
    model: "V6",
    status: "approved",
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    audioUrl: `https://s/${id}.mp3`,
    videoUrl: null,
    hookUrl: null,
    href: `/projects/p-${id}?lang=it`,
    art: "linear-gradient(red, blue)",
    hasCover: true,
    takes: [],
    chosenTakeId: null,
    settings: {},
    pack: null,
    jury: null,
    reaction: "none",
    playCount: 0,
    trashedAt: null,
    queuePosition: null,
    ...patch,
  };
}
const CLIPS = [
  clip("a", {
    title: "Notte a Roma",
    style: "pop, synth",
    playCount: 5,
    createdAt: "2026-11-01T10:00:00Z",
  }),
  clip("b", {
    title: "Mare",
    style: "rock",
    lyrics: "una notte al mare",
    playCount: 9,
    createdAt: "2026-10-30T10:00:00Z",
  }),
  clip("c", {
    title: "Città di vetro",
    style: "jazz",
    createdAt: "2026-10-29T10:00:00Z",
  }),
];

function view(clips: Clip[] = CLIPS) {
  return render(
    <LocaleProvider value="it">
      <TooltipProvider>
        <PlaylistsProvider
          value={{
            playlists: [
              {
                id: "pl1",
                name: "Notte in auto",
                songCount: 4,
                createdAt: "",
                updatedAt: "",
              },
              {
                id: "pl2",
                name: "Corsa",
                songCount: 1,
                createdAt: "",
                updatedAt: "",
              },
            ],
            likedCount: 7,
          }}
        >
          <SearchView clips={clips} />
        </PlaylistsProvider>
      </TooltipProvider>
    </LocaleProvider>,
  );
}
const input = () =>
  screen.getByRole("searchbox", { name: "Cerca canzoni, playlist o stili" });
const type = async (text: string) => {
  await userEvent.type(input(), text);
};
const songs = () => screen.getByRole("region", { name: "Canzoni" });
const lists = () => screen.getByRole("region", { name: "Playlist" });

beforeEach(() => {
  vi.clearAllMocks();
  useDetails.setState({ open: false, selectedId: null });
  useKnownClips.setState({ known: {} });
  usePlayer.setState({ queue: [], index: -1, playing: false, time: 0 });
});

describe("before searching", () => {
  it("focuses the box and suggests the most played and the newest songs", () => {
    view();
    expect(input()).toHaveFocus();
    expect(
      screen.getByText(/Cerca nel titolo, nello stile, nel testo/u),
    ).toBeInTheDocument();
    const top = screen.getByRole("region", { name: "Più ascoltate" });
    expect(
      within(top)
        .getAllByRole("listitem")
        .map((li) => li.textContent?.slice(0, 5)),
    ).toHaveLength(2);
    // Sorted by plays: Mare (9) before Notte a Roma (5); never-played songs are left out.
    expect(
      within(top)
        .getAllByText(/^(Mare|Notte a Roma)$/u)
        .map((n) => n.textContent),
    ).toEqual(["Mare", "Notte a Roma"]);
    const newest = screen.getByRole("region", { name: "Ultime create" });
    expect(
      within(newest)
        .getAllByText(/^(Notte a Roma|Mare|Città di vetro)$/u)
        .map((n) => n.textContent),
    ).toEqual(["Notte a Roma", "Mare", "Città di vetro"]);
  });

  it("has no 'most played' list when nothing was played", () => {
    view([clip("a"), clip("b")]);
    expect(screen.queryByRole("region", { name: "Più ascoltate" })).toBeNull();
  });
});

describe("searching", () => {
  it("waits for a pause in typing, then shows songs and playlists with their counts", async () => {
    view();
    await type("notte");
    // Not yet: the search is debounced.
    expect(screen.queryByRole("region", { name: "Canzoni" })).toBeNull();
    await waitFor(() => expect(songs()).toBeInTheDocument());
    // The title match comes first, then the one that only has it in the lyrics.
    expect(
      within(songs())
        .getAllByText(/^(Notte a Roma|Mare)$/u)
        .map((n) => n.textContent),
    ).toEqual(["Notte a Roma", "Mare"]);
    expect(within(songs()).getByRole("heading")).toHaveTextContent("Canzoni2");
    expect(within(lists()).getByText("Notte in auto")).toBeInTheDocument();
    expect(within(lists()).getByText("4 brani")).toBeInTheDocument();
    expect(within(lists()).queryByText("Corsa")).toBeNull();
    expect(
      within(lists()).getByRole("link", { name: /Notte in auto/u }),
    ).toHaveAttribute("href", "/playlists/pl1");
  });

  it("finds a song by its lyrics, its style, and without accents", async () => {
    view();
    await type("jazz");
    await waitFor(() =>
      expect(within(songs()).getByText("Città di vetro")).toBeInTheDocument(),
    );
    await userEvent.clear(input());
    await type("citta");
    await waitFor(() =>
      expect(within(songs()).getByText("Città di vetro")).toBeInTheDocument(),
    );
    await userEvent.clear(input());
    await type("al mare");
    await waitFor(() =>
      expect(within(songs()).getByText("Mare")).toBeInTheDocument(),
    );
    expect(within(songs()).queryByText("Notte a Roma")).toBeNull();
  });

  it("finds the Mi piace playlist by name", async () => {
    view();
    await type("piace");
    await waitFor(() =>
      expect(within(lists()).getByText("Mi piace")).toBeInTheDocument(),
    );
    expect(within(lists()).getByText("7 brani")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Canzoni" })).toBeNull();
  });

  it("says when nothing matches", async () => {
    view();
    await type("zzzz");
    expect(await screen.findByRole("status")).toHaveTextContent(
      'Nessun risultato per "zzzz"',
    );
  });

  it("clears with its button and with Escape, and goes back to the suggestions", async () => {
    view();
    await type("mare");
    await waitFor(() => expect(songs()).toBeInTheDocument());
    await userEvent.click(
      screen.getByRole("button", { name: "Cancella la ricerca" }),
    );
    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();
    expect(
      screen.getByRole("region", { name: "Ultime create" }),
    ).toBeInTheDocument();

    await type("mare");
    await waitFor(() => expect(songs()).toBeInTheDocument());
    await userEvent.keyboard("{Escape}");
    expect(input()).toHaveValue("");
    expect(screen.queryByRole("region", { name: "Canzoni" })).toBeNull();
  });
});

describe("results", () => {
  const search = async (text: string) => {
    await type(text);
    await waitFor(() => expect(songs()).toBeInTheDocument());
  };

  it("plays a result from its play button, within the result list", async () => {
    view();
    await search("notte");
    await userEvent.click(
      within(songs()).getByRole("button", { name: "Riproduci: Notte a Roma" }),
    );
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(["a", "b"]);
    expect(usePlayer.getState()).toMatchObject({ index: 0, playing: true });
  });

  it("opens a result in the details panel when its row is clicked", async () => {
    view();
    await search("notte");
    await userEvent.click(within(songs()).getByText("Mare"));
    expect(useDetails.getState()).toMatchObject({
      open: true,
      selectedId: "b",
    });
    expect(usePlayer.getState().playing).toBe(false);
  });

  it("registers the songs so the panel can show them", async () => {
    view();
    expect(Object.keys(useKnownClips.getState().known)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("highlights the playing result", async () => {
    view();
    await search("notte");
    await userEvent.click(
      within(songs()).getByRole("button", { name: "Riproduci: Mare" }),
    );
    expect(within(songs()).getByText("Mare")).toHaveClass(
      "text-[var(--brand)]",
    );
  });
});

describe("keyboard", () => {
  const search = async (text: string) => {
    await type(text);
    await waitFor(() => expect(songs()).toBeInTheDocument());
  };

  it("moves through songs then playlists with Up and Down, wrapping around", async () => {
    view();
    await search("notte");
    const marked = () => document.querySelectorAll("[data-active=true]").length;
    expect(marked()).toBe(0);
    await userEvent.keyboard("{ArrowDown}");
    expect(
      within(songs()).getByText("Notte a Roma").closest("[data-active=true]"),
    ).not.toBeNull();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    // Third entry is the playlist.
    expect(
      within(lists()).getByRole("link", { name: /Notte in auto/u }).className,
    ).toContain("bg-[var(--surface-glass-hover)]");
    await userEvent.keyboard("{ArrowDown}");
    expect(
      within(songs()).getByText("Notte a Roma").closest("[data-active=true]"),
    ).not.toBeNull();
    await userEvent.keyboard("{ArrowUp}");
    expect(
      within(lists()).getByRole("link", { name: /Notte in auto/u }).className,
    ).toContain("bg-[var(--surface-glass-hover)]");
  });

  it("plays the highlighted song with Enter", async () => {
    view();
    await search("notte");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(usePlayer.getState().queue[usePlayer.getState().index]?.id).toBe(
      "b",
    );
  });

  it("opens the highlighted playlist with Enter", async () => {
    view();
    await search("notte");
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(mock.push).toHaveBeenCalledWith("/playlists/pl1");
  });

  it("does nothing on Enter before an entry is highlighted", async () => {
    view();
    await search("notte");
    await userEvent.keyboard("{Enter}");
    expect(usePlayer.getState().queue).toEqual([]);
    expect(mock.push).not.toHaveBeenCalled();
  });

  it("starts at the top again for a new query", async () => {
    view();
    await search("notte");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.clear(input());
    await type("mare");
    await waitFor(() =>
      expect(document.querySelectorAll("[data-active=true]").length).toBe(0),
    );
  });
});
