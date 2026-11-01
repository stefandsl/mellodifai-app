import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import type { PlaylistInfo } from "@/lib/studio/playlists";
import { AddToPlaylistDialog } from "./playlist-dialog";
import { PlaylistsProvider } from "./playlists-context";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(async (_name: string, _args: unknown) => ({
    data: [] as unknown,
    error: null as unknown,
  })),
  addToPlaylist: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    count: 1 as number | undefined,
  })),
  removeFromPlaylist: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    count: 1,
  })),
  createPlaylist: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    id: "new-id" as string | undefined,
  })),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ rpc: mock.rpc }),
}));
vi.mock("@/app/actions/playlists", () => ({
  addToPlaylist: mock.addToPlaylist,
  removeFromPlaylist: mock.removeFromPlaylist,
  createPlaylist: mock.createPlaylist,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh, push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

const list = (id: string, name: string, songCount: number): PlaylistInfo => ({
  id,
  name,
  songCount,
  createdAt: "",
  updatedAt: "",
});
const LISTS = [list("p1", "Sera", 3), list("p2", "Corsa", 1)];

function show({
  ids = ["a"],
  playlists = LISTS,
  onDone,
}: {
  ids?: string[];
  playlists?: PlaylistInfo[];
  onDone?: () => void;
} = {}) {
  const onOpenChange = vi.fn();
  render(
    <LocaleProvider value="it">
      <PlaylistsProvider value={{ playlists, likedCount: 0 }}>
        <AddToPlaylistDialog
          open
          onOpenChange={onOpenChange}
          versionIds={ids}
          onDone={onDone}
        />
      </PlaylistsProvider>
    </LocaleProvider>,
  );
  return { onOpenChange };
}
const membership = (rows: { playlist_id: string; n: number }[]) =>
  mock.rpc.mockResolvedValue({ data: rows, error: null });
const ready = async () => await screen.findByRole("button", { name: /Sera/u });

beforeEach(() => {
  vi.clearAllMocks();
  membership([]);
  mock.addToPlaylist.mockResolvedValue({ ok: true, count: 1 });
  mock.removeFromPlaylist.mockResolvedValue({ ok: true, count: 1 });
  mock.createPlaylist.mockResolvedValue({ ok: true, id: "new-id" });
});

describe("add to playlist", () => {
  it("asks the database which playlists hold the songs and lists them with their counts", async () => {
    membership([{ playlist_id: "p2", n: 1 }]);
    show({ ids: ["a"] });
    expect(await ready()).toHaveAttribute("aria-pressed", "false");
    expect(mock.rpc).toHaveBeenCalledWith("playlist_membership", {
      p_versions: ["a"],
    });
    expect(screen.getByRole("button", { name: /Corsa/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("3 brani")).toBeInTheDocument();
    expect(screen.getByText("1 brano")).toBeInTheDocument();
  });

  it("adds a song to the chosen playlist and says so", async () => {
    const onDone = vi.fn();
    show({ onDone });
    await userEvent.click(await ready());
    expect(mock.addToPlaylist).toHaveBeenCalledWith({
      playlistId: "p1",
      versionIds: ["a"],
    });
    expect(mock.toast.success).toHaveBeenCalledWith('Aggiunta a "Sera"');
    expect(mock.refresh).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sera/u })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("takes a single song out again when it is already in", async () => {
    membership([{ playlist_id: "p1", n: 1 }]);
    show();
    const sera = await ready();
    expect(sera).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(sera);
    expect(mock.removeFromPlaylist).toHaveBeenCalledWith({
      playlistId: "p1",
      versionIds: ["a"],
    });
    expect(mock.addToPlaylist).not.toHaveBeenCalled();
    expect(mock.toast.success).toHaveBeenCalledWith('Tolta da "Sera"');
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sera/u })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
  });

  it("adds a whole selection and reports a partial result", async () => {
    membership([{ playlist_id: "p1", n: 1 }]);
    const onDone = vi.fn();
    show({ ids: ["a", "b", "c"], onDone });
    expect(
      await screen.findByText("Aggiungi 3 canzoni a una playlist"),
    ).toBeInTheDocument();
    // The playlist that already holds one of them says so.
    expect(screen.getByText("1 già presenti")).toBeInTheDocument();
    mock.addToPlaylist.mockResolvedValueOnce({ ok: true, count: 2 });
    await userEvent.click(await ready());
    expect(mock.addToPlaylist).toHaveBeenCalledWith({
      playlistId: "p1",
      versionIds: ["a", "b", "c"],
    });
    expect(mock.toast.warning).toHaveBeenCalledWith('2 di 3 aggiunte a "Sera"');
    expect(onDone).toHaveBeenCalled();
  });

  it("says when all songs were added, and when none was new", async () => {
    const onDone = vi.fn();
    show({ ids: ["a", "b"], onDone });
    mock.addToPlaylist.mockResolvedValueOnce({ ok: true, count: 2 });
    await userEvent.click(await ready());
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mock.toast.success).toHaveBeenCalledWith(
      '2 canzoni aggiunte a "Sera"',
    );

    mock.addToPlaylist.mockResolvedValueOnce({ ok: true, count: 0 });
    await userEvent.click(screen.getByRole("button", { name: /Corsa/u }));
    expect(mock.toast.warning).toHaveBeenCalledWith(
      'Niente da aggiungere: sono già tutte in "Corsa"',
    );
    // Nothing new was added, so the selection is kept.
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("makes a new playlist and puts the songs in it", async () => {
    const onDone = vi.fn();
    const { onOpenChange } = show({ ids: ["a", "b"], onDone });
    await ready();
    await userEvent.type(
      screen.getByLabelText("Nome della playlist"),
      "  Notte ",
    );
    mock.addToPlaylist.mockResolvedValueOnce({ ok: true, count: 2 });
    await userEvent.click(
      screen.getByRole("button", { name: "Nuova playlist" }),
    );
    expect(mock.createPlaylist).toHaveBeenCalledWith({ name: "Notte" });
    expect(mock.addToPlaylist).toHaveBeenCalledWith({
      playlistId: "new-id",
      versionIds: ["a", "b"],
    });
    expect(mock.toast.success).toHaveBeenCalledWith(
      '2 canzoni aggiunte a "Notte"',
    );
    expect(onDone).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("needs a name before it can make a playlist", async () => {
    show();
    await ready();
    expect(
      screen.getByRole("button", { name: "Nuova playlist" }),
    ).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Nome della playlist"), "   ");
    expect(
      screen.getByRole("button", { name: "Nuova playlist" }),
    ).toBeDisabled();
  });

  it("reports each kind of failure", async () => {
    show();
    mock.addToPlaylist.mockResolvedValueOnce({ ok: false, count: undefined });
    await userEvent.click(await ready());
    expect(mock.toast.error).toHaveBeenLastCalledWith(
      "Non sono riuscito ad aggiungere alla playlist",
    );

    mock.createPlaylist.mockResolvedValueOnce({ ok: false, id: undefined });
    await userEvent.type(screen.getByLabelText("Nome della playlist"), "Nuova");
    await userEvent.click(
      screen.getByRole("button", { name: "Nuova playlist" }),
    );
    expect(mock.toast.error).toHaveBeenLastCalledWith(
      "Non sono riuscito a creare la playlist",
    );
    expect(mock.addToPlaylist).toHaveBeenCalledTimes(1);

    mock.createPlaylist.mockResolvedValueOnce({ ok: true, id: "n2" });
    mock.addToPlaylist.mockResolvedValueOnce({ ok: false, count: undefined });
    await userEvent.click(
      screen.getByRole("button", { name: "Nuova playlist" }),
    );
    expect(mock.toast.error).toHaveBeenLastCalledWith(
      "Non sono riuscito ad aggiungere alla playlist",
    );
  });

  it("reports a failed removal", async () => {
    membership([{ playlist_id: "p1", n: 1 }]);
    show();
    mock.removeFromPlaylist.mockResolvedValueOnce({ ok: false, count: 0 });
    await userEvent.click(await ready());
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Non sono riuscito a togliere dalla playlist",
    );
  });

  it("shows a message when the playlists cannot be read, and when there are none", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Non riesco a leggere le tue playlist",
    );
  });

  it("invites the user to make the first playlist", async () => {
    show({ playlists: [] });
    expect(
      await screen.findByText("Non hai ancora playlist. Creane una qui sotto."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByLabelText("Nome della playlist"),
    ).toBeInTheDocument();
  });
});
