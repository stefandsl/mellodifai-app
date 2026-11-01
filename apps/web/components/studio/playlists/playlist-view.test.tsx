import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Clip } from "@/lib/studio/clips";
import type { PlaylistInfo } from "@/lib/studio/playlists";
import { useDetails, useKnownClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { PlaylistsProvider } from "../playlists-context";
import { PlaylistView } from "./playlist-view";

const mock = vi.hoisted(() => ({
  reorderPlaylist: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  removeFromPlaylist: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    count: 1,
  })),
  addToPlaylist: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    count: 1,
  })),
  renamePlaylist: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  deletePlaylist: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  createPlaylist: vi.fn(),
  setReaction: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  rpc: vi.fn(async () => ({ data: [], error: null })),
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/app/actions/playlists", () => ({
  reorderPlaylist: mock.reorderPlaylist,
  removeFromPlaylist: mock.removeFromPlaylist,
  addToPlaylist: mock.addToPlaylist,
  renamePlaylist: mock.renamePlaylist,
  deletePlaylist: mock.deletePlaylist,
  createPlaylist: mock.createPlaylist,
}));
vi.mock("@/app/actions/library", () => ({
  setReaction: mock.setReaction,
  renameVersion: vi.fn(),
  trashVersions: vi.fn(),
  restoreVersions: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ rpc: mock.rpc }),
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
    style: `stile ${id}`,
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
    stems: null,
    ...patch,
  };
}
const playlist = (patch: Partial<PlaylistInfo> = {}): PlaylistInfo => ({
  id: "pl1",
  name: "Notte",
  songCount: 3,
  createdAt: "",
  updatedAt: "",
  ...patch,
});
const SONGS = [clip("a"), clip("b"), clip("c")];

function view(
  clips: Clip[] = SONGS,
  props: { system?: boolean; playlist?: PlaylistInfo } = {},
) {
  return render(
    <LocaleProvider value="it">
      <TooltipProvider>
        <PlaylistsProvider value={{ playlists: [playlist()], likedCount: 0 }}>
          <PlaylistView
            playlist={props.playlist ?? playlist()}
            clips={clips}
            system={props.system ?? false}
          />
        </PlaylistsProvider>
      </TooltipProvider>
    </LocaleProvider>,
  );
}
const rows = () =>
  within(screen.getByRole("list", { name: /./u })).getAllByRole("listitem");
const titles = () =>
  rows().map((row) => within(row).getAllByText(/^Canzone /u)[0]?.textContent);
const queueIds = () => usePlayer.getState().queue.map((t) => t.id);

beforeEach(() => {
  vi.clearAllMocks();
  useDetails.setState({ open: false, selectedId: null });
  useKnownClips.setState({ known: {} });
  usePlayer.setState({ queue: [], index: -1, playing: false, time: 0 });
  mock.reorderPlaylist.mockResolvedValue({ ok: true });
  mock.removeFromPlaylist.mockResolvedValue({ ok: true, count: 1 });
  mock.addToPlaylist.mockResolvedValue({ ok: true, count: 1 });
  mock.renamePlaylist.mockResolvedValue({ ok: true });
  mock.deletePlaylist.mockResolvedValue({ ok: true });
  mock.setReaction.mockResolvedValue({ ok: true });
});

describe("header", () => {
  it("shows the eyebrow, name and song count", () => {
    view();
    expect(screen.getByText("PLAYLIST")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notte" })).toBeInTheDocument();
    expect(screen.getByText("3 brani")).toBeInTheDocument();
  });

  it("counts a single song in the singular", () => {
    view([clip("a")]);
    expect(screen.getByText("1 brano")).toBeInTheDocument();
  });

  it("renames with Enter, cancels with Escape, and reports a refusal", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Rinomina la playlist: Notte" }),
    );
    await userEvent.keyboard("{Escape}");
    expect(mock.renamePlaylist).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Notte" })).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Rinomina la playlist: Notte" }),
    );
    const field = screen.getByLabelText("Rinomina la playlist");
    await userEvent.clear(field);
    await userEvent.type(field, "  Alba {Enter}");
    expect(mock.renamePlaylist).toHaveBeenCalledWith({
      playlistId: "pl1",
      name: "Alba",
    });
    expect(mock.refresh).toHaveBeenCalled();

    mock.renamePlaylist.mockResolvedValueOnce({ ok: false });
    await userEvent.click(
      screen.getByRole("button", { name: "Rinomina la playlist: Notte" }),
    );
    const again = screen.getByLabelText("Rinomina la playlist");
    await userEvent.clear(again);
    await userEvent.type(again, "Sera{Enter}");
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Non sono riuscito a rinominare la playlist",
    );
    // The field stays so the name is not lost.
    expect(screen.getByLabelText("Rinomina la playlist")).toBeInTheDocument();
  });

  it("does not save an unchanged or empty name", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Rinomina la playlist: Notte" }),
    );
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      screen.getByRole("button", { name: "Rinomina la playlist: Notte" }),
    );
    await userEvent.clear(screen.getByLabelText("Rinomina la playlist"));
    await userEvent.keyboard("{Enter}");
    expect(mock.renamePlaylist).not.toHaveBeenCalled();
  });

  it("deletes after a confirmation and goes back to the list", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Elimina la playlist" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText('Eliminare "Notte"?')).toBeInTheDocument();
    expect(mock.deletePlaylist).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Elimina" }),
    );
    expect(mock.deletePlaylist).toHaveBeenCalledWith({ playlistId: "pl1" });
    expect(mock.push).toHaveBeenCalledWith("/playlists");
    expect(mock.toast.success).toHaveBeenCalledWith("Playlist eliminata");
  });

  it("keeps the playlist when the confirmation is cancelled or the delete fails", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Elimina la playlist" }),
    );
    let dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Annulla" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mock.deletePlaylist).not.toHaveBeenCalled();

    mock.deletePlaylist.mockResolvedValueOnce({ ok: false });
    await userEvent.click(
      screen.getByRole("button", { name: "Elimina la playlist" }),
    );
    dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Elimina" }),
    );
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Non sono riuscito a eliminare la playlist",
    );
    expect(mock.push).not.toHaveBeenCalled();
  });
});

describe("playing in order", () => {
  it("lists the songs numbered, in the stored order", () => {
    view();
    expect(titles()).toEqual(["Canzone a", "Canzone b", "Canzone c"]);
    expect(within(rows()[2] as HTMLElement).getByText("3")).toBeInTheDocument();
  });

  it("plays the whole list from the first song with the big button", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Riproduci la playlist" }),
    );
    expect(queueIds()).toEqual(["a", "b", "c"]);
    expect(usePlayer.getState()).toMatchObject({ index: 0, playing: true });
    // The same button pauses it.
    await userEvent.click(screen.getByRole("button", { name: "Pausa" }));
    expect(usePlayer.getState().playing).toBe(false);
  });

  it("starts at the clicked song and goes on through the list", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Riproduci: Canzone b" }),
    );
    expect(queueIds()).toEqual(["a", "b", "c"]);
    expect(usePlayer.getState().index).toBe(1);
    usePlayer.getState().next();
    expect(usePlayer.getState().queue[usePlayer.getState().index]?.id).toBe(
      "c",
    );
  });

  it("skips songs that have no audio yet when it builds the queue", async () => {
    view([
      clip("a"),
      clip("b", { audioUrl: null, status: "song_queued" }),
      clip("c"),
    ]);
    await userEvent.click(
      screen.getByRole("button", { name: "Riproduci la playlist" }),
    );
    expect(queueIds()).toEqual(["a", "c"]);
  });

  it("says so when nothing can be played", async () => {
    view([clip("a", { audioUrl: null })]);
    expect(
      screen.getByRole("button", { name: "Riproduci la playlist" }),
    ).toBeDisabled();
  });

  it("highlights the playing row: pause button, aria-current and a brand title", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Riproduci: Canzone b" }),
    );
    const row = rows()[1] as HTMLElement;
    const inner = row.firstElementChild as HTMLElement;
    expect(inner).toHaveAttribute("aria-current", "true");
    expect(within(row).getByText("Canzone b")).toHaveClass(
      "text-[var(--brand)]",
    );
    expect(
      within(row).getByRole("button", { name: "Pausa: Canzone b" }),
    ).toBeInTheDocument();
    expect(rows()[0]?.firstElementChild).not.toHaveAttribute("aria-current");
  });

  it("opens a song in the details panel from its menu", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Altre opzioni: Canzone b" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Dettagli canzone" }),
    );
    expect(useDetails.getState()).toMatchObject({
      open: true,
      selectedId: "b",
    });
  });
});

describe("empty", () => {
  it("explains how to fill a playlist", () => {
    view([], { playlist: playlist({ songCount: 0 }) });
    expect(screen.getByText(/Questa playlist è vuota/u)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Riproduci la playlist" }),
    ).toBeDisabled();
  });

  it("invites the user to like songs in the Mi piace list", () => {
    view([], {
      system: true,
      playlist: playlist({ id: "liked", name: "Mi piace", songCount: 0 }),
    });
    expect(
      screen.getByText("Metti mi piace a una canzone e la trovi qui"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vai a Crea" })).toHaveAttribute(
      "href",
      "/create",
    );
  });
});

describe("order", () => {
  async function menu(title: string, item: string) {
    await userEvent.click(
      screen.getByRole("button", { name: `Altre opzioni: ${title}` }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: item }));
  }

  it("moves a song down and saves the whole order", async () => {
    view();
    await menu("Canzone a", "Sposta giù");
    expect(titles()).toEqual(["Canzone b", "Canzone a", "Canzone c"]);
    expect(mock.reorderPlaylist).toHaveBeenCalledWith({
      playlistId: "pl1",
      versionIds: ["b", "a", "c"],
    });
  });

  it("moves a song up", async () => {
    view();
    await menu("Canzone c", "Sposta su");
    expect(titles()).toEqual(["Canzone a", "Canzone c", "Canzone b"]);
    expect(mock.reorderPlaylist).toHaveBeenCalledWith({
      playlistId: "pl1",
      versionIds: ["a", "c", "b"],
    });
  });

  it("cannot move the first song up or the last one down", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Altre opzioni: Canzone a" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Sposta su" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitem", { name: "Sposta giù" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("puts the order back when the save is refused", async () => {
    view();
    mock.reorderPlaylist.mockResolvedValueOnce({ ok: false });
    await menu("Canzone a", "Sposta giù");
    await waitFor(() =>
      expect(titles()).toEqual(["Canzone a", "Canzone b", "Canzone c"]),
    );
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Non sono riuscito a cambiare l'ordine",
    );
  });

  it("the queue follows the new order", async () => {
    view();
    await menu("Canzone a", "Sposta giù");
    await userEvent.click(
      screen.getByRole("button", { name: "Riproduci la playlist" }),
    );
    expect(queueIds()).toEqual(["b", "a", "c"]);
  });

  it("reorders by dragging a row onto another", () => {
    view();
    const [first, , third] = rows() as HTMLElement[];
    const source = first?.firstElementChild as HTMLElement;
    const target = third?.firstElementChild as HTMLElement;
    expect(source).toHaveAttribute("draggable", "true");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(titles()).toEqual(["Canzone b", "Canzone c", "Canzone a"]);
    expect(mock.reorderPlaylist).toHaveBeenCalledWith({
      playlistId: "pl1",
      versionIds: ["b", "c", "a"],
    });
  });

  it("ignores a drop that does not start from a row, or lands on the same row", () => {
    view();
    const [first] = rows() as HTMLElement[];
    const target = first?.firstElementChild as HTMLElement;
    fireEvent.drop(target, { dataTransfer: { setData: vi.fn() } });
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(mock.reorderPlaylist).not.toHaveBeenCalled();
  });
});

describe("removing", () => {
  it("takes a song out of the playlist with an undo that puts it back in place", async () => {
    view();
    await userEvent.click(
      screen.getByRole("button", { name: "Altre opzioni: Canzone b" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Togli dalla playlist" }),
    );
    expect(mock.removeFromPlaylist).toHaveBeenCalledWith({
      playlistId: "pl1",
      versionIds: ["b"],
    });
    expect(titles()).toEqual(["Canzone a", "Canzone c"]);
    const options = mock.toast.success.mock.calls.at(-1)?.[1] as {
      action: { label: string; onClick: () => Promise<void> };
    };
    expect(mock.toast.success.mock.calls.at(-1)?.[0]).toBe(
      "Tolta dalla playlist",
    );
    expect(options.action.label).toBe("Annulla");
    await options.action.onClick();
    expect(mock.addToPlaylist).toHaveBeenCalledWith({
      playlistId: "pl1",
      versionIds: ["b"],
    });
    expect(mock.reorderPlaylist).toHaveBeenCalledWith({
      playlistId: "pl1",
      versionIds: ["a", "b", "c"],
    });
  });

  it("puts the song back on screen when the removal is refused", async () => {
    view();
    mock.removeFromPlaylist.mockResolvedValueOnce({ ok: false, count: 0 });
    await userEvent.click(
      screen.getByRole("button", { name: "Altre opzioni: Canzone b" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Togli dalla playlist" }),
    );
    await waitFor(() =>
      expect(titles()).toEqual(["Canzone a", "Canzone b", "Canzone c"]),
    );
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Non sono riuscito a togliere dalla playlist",
    );
  });
});

describe("Mi piace", () => {
  const liked = () =>
    view(SONGS, {
      system: true,
      playlist: playlist({ id: "liked", name: "Mi piace" }),
    });

  it("is a page without rename, delete or drag handles", () => {
    liked();
    expect(
      screen.getByRole("heading", { name: "Mi piace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Rinomina la playlist/u }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Elimina la playlist" }),
    ).toBeNull();
    expect(rows()[0]?.firstElementChild).not.toHaveAttribute("draggable");
  });

  it("plays the liked songs in the order given (newest like first)", async () => {
    view([clip("c"), clip("a")], {
      system: true,
      playlist: playlist({ id: "liked", name: "Mi piace", songCount: 2 }),
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Riproduci la playlist" }),
    );
    expect(queueIds()).toEqual(["c", "a"]);
  });

  it("unlikes with the heart, hides the row and offers an undo", async () => {
    liked();
    await userEvent.click(
      screen.getByRole("button", { name: "Togli il mi piace: Canzone b" }),
    );
    expect(mock.setReaction).toHaveBeenCalledWith({
      versionId: "b",
      reaction: "none",
    });
    expect(titles()).toEqual(["Canzone a", "Canzone c"]);
    const options = mock.toast.success.mock.calls.at(-1)?.[1] as {
      action: { onClick: () => Promise<void> };
    };
    expect(mock.toast.success.mock.calls.at(-1)?.[0]).toBe("Mi piace tolto");
    await options.action.onClick();
    expect(mock.setReaction).toHaveBeenLastCalledWith({
      versionId: "b",
      reaction: "like",
    });
  });

  it("keeps the row when the unlike is refused", async () => {
    liked();
    mock.setReaction.mockResolvedValueOnce({ ok: false });
    await userEvent.click(
      screen.getByRole("button", { name: "Togli il mi piace: Canzone b" }),
    );
    await waitFor(() => expect(titles()).toHaveLength(3));
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Non sono riuscito a salvare la reazione",
    );
  });
});
