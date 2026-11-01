import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import { useDetails, useKnownClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { useReactions } from "@/store/reactions";
import { PlaylistsProvider } from "../playlists-context";
import { WorkspaceFeed } from "./workspace-feed";

const mock = vi.hoisted(() => ({
  setReaction: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  addToPlaylist: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    count: 2 as number | undefined,
  })),
  rpc: vi.fn(async (_name: string, _args: unknown) => ({
    data: [] as unknown,
    error: null as unknown,
  })),
  refresh: vi.fn(),
  push: vi.fn(),
  requestStems: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/app/actions/audio-tools", () => ({
  requestStems: mock.requestStems,
  saveEditedTake: vi.fn(),
}));
vi.mock("@/app/actions/library", () => ({
  setReaction: mock.setReaction,
  renameVersion: vi.fn(async () => ({ ok: true })),
  trashVersions: vi.fn(async () => ({ ok: true, count: 1 })),
  restoreVersions: vi.fn(async () => ({ ok: true, count: 1 })),
}));
vi.mock("@/app/actions/playlists", () => ({
  addToPlaylist: mock.addToPlaylist,
  removeFromPlaylist: vi.fn(),
  createPlaylist: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ rpc: mock.rpc }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh, push: mock.push }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));
vi.mock("./use-live-refresh", () => ({ useLiveRefresh: () => {} }));

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
    art: "",
    hasCover: false,
    takes: [],
    chosenTakeId: null,
    settings: {},
    pack: null,
    jury: null,
    reaction: "none",
    playCount: 0,
    trashedAt: null,
    queuePosition: null,
    stems: null,
    ...patch,
  };
}
function feed(
  clips: Clip[],
  props: Partial<Parameters<typeof WorkspaceFeed>[0]> = {},
) {
  return render(
    <LocaleProvider value="it">
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
        <WorkspaceFeed clips={clips} {...props} />
      </PlaylistsProvider>
    </LocaleProvider>,
  );
}
const card = (title: string) => screen.getByRole("article", { name: title });
const inCard = (title: string) => within(card(title));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useDetails.setState({ open: false, selectedId: null });
  useKnownClips.setState({ known: {} });
  useReactions.setState({ server: {}, over: {}, pending: {} });
  usePlayer.setState({ queue: [], index: -1, playing: false, time: 0 });
  mock.rpc.mockResolvedValue({ data: [], error: null });
});

describe("opening the details panel", () => {
  it("opens on a click on the card body, not on its buttons", async () => {
    feed([clip("a"), clip("b")]);
    await userEvent.click(inCard("Canzone a").getByText("pop"));
    expect(useDetails.getState()).toMatchObject({
      open: true,
      selectedId: "a",
    });
    // The picked card is marked.
    expect(card("Canzone a")).toHaveAttribute("data-selected", "true");

    useDetails.setState({ open: false, selectedId: null });
    await userEvent.click(
      inCard("Canzone b").getByRole("button", { name: "Mi piace" }),
    );
    await userEvent.click(
      inCard("Canzone b").getByRole("button", { name: "Riproduci: Canzone b" }),
    );
    await userEvent.click(
      inCard("Canzone b").getByRole("button", { name: "Altre opzioni" }),
    );
    expect(useDetails.getState().open).toBe(false);
  });

  it("opens from the menu entry instead of leaving the page", async () => {
    feed([clip("a")]);
    await userEvent.click(
      inCard("Canzone a").getByRole("button", { name: "Altre opzioni" }),
    );
    const item = await screen.findByRole("menuitem", {
      name: "Dettagli canzone",
    });
    expect(item).not.toHaveAttribute("href");
    await userEvent.click(item);
    expect(useDetails.getState()).toMatchObject({
      open: true,
      selectedId: "a",
    });
  });

  it("registers the page's songs with the panel", () => {
    feed([clip("a"), clip("b")]);
    expect(Object.keys(useKnownClips.getState().known).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("works in the grid view too", async () => {
    localStorage.setItem("mellodifai-feed-view", "grid");
    feed([clip("a")]);
    await waitFor(() => expect(card("Canzone a")).toBeInTheDocument());
    await userEvent.click(inCard("Canzone a").getByText("pop"));
    expect(useDetails.getState().selectedId).toBe("a");
  });

  it("does nothing on a trash card", async () => {
    feed([clip("a")], { trash: true });
    await userEvent.click(inCard("Canzone a").getByText("pop"));
    expect(useDetails.getState().open).toBe(false);
  });

  it("ticks the box in select mode instead", async () => {
    feed([clip("a")]);
    await userEvent.click(screen.getByRole("button", { name: "Seleziona" }));
    await userEvent.click(inCard("Canzone a").getByText("pop"));
    expect(useDetails.getState().open).toBe(false);
    expect(inCard("Canzone a").getByRole("checkbox")).toBeChecked();
    await userEvent.click(inCard("Canzone a").getByText("pop"));
    expect(inCard("Canzone a").getByRole("checkbox")).not.toBeChecked();
  });
});

describe("the playing card", () => {
  it("is tinted, marked current, has a brand title and a pause button", async () => {
    feed([clip("a"), clip("b")]);
    await userEvent.click(
      inCard("Canzone a").getByRole("button", { name: "Riproduci: Canzone a" }),
    );
    expect(card("Canzone a")).toHaveAttribute("aria-current", "true");
    expect(card("Canzone a").className).toContain(
      "shadow-[inset_3px_0_0_var(--brand)]",
    );
    expect(
      inCard("Canzone a").getByRole("link", { name: "Canzone a" }),
    ).toHaveClass("text-[var(--brand)]");
    expect(
      inCard("Canzone a").getByRole("button", { name: "Pausa: Canzone a" }),
    ).toBeInTheDocument();
    expect(card("Canzone b")).not.toHaveAttribute("aria-current");
    expect(
      inCard("Canzone b").getByRole("link", { name: "Canzone b" }),
    ).not.toHaveClass("text-[var(--brand)]");
  });

  it("moves to the next card when the queue moves on", async () => {
    feed([clip("a"), clip("b")]);
    await userEvent.click(
      inCard("Canzone a").getByRole("button", { name: "Riproduci: Canzone a" }),
    );
    usePlayer.getState().next();
    await waitFor(() =>
      expect(card("Canzone b")).toHaveAttribute("aria-current", "true"),
    );
    expect(card("Canzone a")).not.toHaveAttribute("aria-current");
  });
});

describe("playlists from the feed", () => {
  it("adds one song from its menu", async () => {
    feed([clip("a")]);
    await userEvent.click(
      inCard("Canzone a").getByRole("button", { name: "Altre opzioni" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Aggiungi a playlist" }),
    );
    mock.addToPlaylist.mockResolvedValueOnce({ ok: true, count: 1 });
    await userEvent.click(await screen.findByRole("button", { name: /Sera/u }));
    expect(mock.addToPlaylist).toHaveBeenCalledWith({
      playlistId: "pl1",
      versionIds: ["a"],
    });
  });

  it("adds one song from the button on the card", async () => {
    feed([clip("a")]);
    await userEvent.click(
      inCard("Canzone a").getByRole("button", { name: "Aggiungi a playlist" }),
    );
    expect(
      await screen.findByRole("button", { name: /Sera/u }),
    ).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith("playlist_membership", {
      p_versions: ["a"],
    });
  });

  it("adds the whole selection and leaves select mode", async () => {
    feed([clip("a"), clip("b"), clip("c")]);
    await userEvent.click(screen.getByRole("button", { name: "Seleziona" }));
    const toolbar = screen.getByRole("toolbar");
    const add = within(toolbar).getByRole("button", {
      name: "Aggiungi a playlist",
    });
    expect(add).toBeDisabled();
    await userEvent.click(inCard("Canzone a").getByRole("checkbox"));
    await userEvent.click(inCard("Canzone c").getByRole("checkbox"));
    expect(add).toBeEnabled();
    await userEvent.click(add);
    expect(
      await screen.findByText("Aggiungi 2 canzoni a una playlist"),
    ).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Sera/u }));
    expect(mock.addToPlaylist).toHaveBeenCalledWith({
      playlistId: "pl1",
      versionIds: ["a", "c"],
    });
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
  });

  it("does not offer it in the trash", async () => {
    feed([clip("a")], { trash: true });
    await userEvent.click(screen.getByRole("button", { name: "Seleziona" }));
    expect(
      within(screen.getByRole("toolbar")).queryByRole("button", {
        name: "Aggiungi a playlist",
      }),
    ).toBeNull();
  });
});

describe("sharing from the feed", () => {
  it("opens the share window from the menu and from the card button", async () => {
    feed([clip("a")]);
    await userEvent.click(
      inCard("Canzone a").getByRole("button", { name: "Condividi" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Condividi" });
    expect(within(dialog).getByLabelText("Link alla canzone")).toHaveValue(
      `${window.location.origin}/projects/p-a?lang=it`,
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(
      inCard("Canzone a").getByRole("button", { name: "Altre opzioni" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Condividi" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Condividi" }),
    ).toBeInTheDocument();
  });
});

describe("search", () => {
  it("finds songs by their lyrics and without accents", async () => {
    feed([
      clip("a", { title: "Città", lyrics: "la luna sul mare" }),
      clip("b", { title: "Altra", lyrics: "niente" }),
    ]);
    await userEvent.type(screen.getByRole("searchbox"), "LUNA");
    await waitFor(() =>
      expect(screen.queryAllByRole("article")).toHaveLength(1),
    );
    expect(screen.getByRole("article", { name: "Città" })).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "citta");
    await waitFor(() =>
      expect(
        screen.getByRole("article", { name: "Città" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryAllByRole("article")).toHaveLength(1);
  });
});

describe("audio tools from the card menu", () => {
  const withTake = (patch: Partial<Clip> = {}) =>
    clip("a", {
      status: "audio_ready",
      chosenTakeId: "t1",
      takes: [
        { id: "t1", number: 1, audioUrl: "https://s/t1.mp3", scores: null },
      ],
      ...patch,
    });
  const menu = async () => {
    await userEvent.click(
      inCard("Canzone a").getByRole("button", { name: "Altre opzioni" }),
    );
    return {
      edit: await screen.findByRole("menuitem", { name: "Modifica audio" }),
      stems: screen.getByRole("menuitem", { name: "Estrai stems" }),
    };
  };

  it("opens the editor and asks for the stems of a song with a chosen take", async () => {
    feed([withTake()]);
    await userEvent.click((await menu()).edit);
    expect(mock.push).toHaveBeenLastCalledWith("/editor/a");
    await userEvent.click((await menu()).stems);
    expect(mock.requestStems).toHaveBeenCalledWith({ versionId: "a" });
    await waitFor(() => expect(mock.push).toHaveBeenLastCalledWith("/stems/a"));
  });

  it("keeps both entries disabled for a song with no chosen take", async () => {
    feed([clip("a", { status: "takes_review" })]);
    const { edit, stems } = await menu();
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(stems).toHaveAttribute("aria-disabled", "true");
  });

  it("lets a song being rendered be separated but not edited", async () => {
    feed([withTake({ status: "producing" })]);
    const { edit, stems } = await menu();
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(stems).not.toHaveAttribute("aria-disabled");
  });

  it("shows queued stems on the card, linking to their page", () => {
    feed([
      withTake({
        stems: {
          takeId: "t1",
          status: "queued",
          jobId: "j1",
          queuePosition: 2,
        },
      }),
    ]);
    expect(
      inCard("Canzone a").getByRole("link", { name: /Stems in coda #2/u }),
    ).toHaveAttribute("href", "/stems/a");
  });
});
