import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import { PlaylistsProvider, type PlaylistsState } from "../playlists-context";
import { PlaylistsIndex } from "./playlists-index";

const mock = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createPlaylist: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    id: "new-id" as string | undefined,
  })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mock.push, refresh: mock.refresh }),
}));
vi.mock("@/app/actions/playlists", () => ({
  createPlaylist: mock.createPlaylist,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

function index(state: PlaylistsState, lang: "it" | "en" = "it") {
  return render(
    <LocaleProvider value={lang}>
      <PlaylistsProvider value={state}>
        <PlaylistsIndex />
      </PlaylistsProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("playlists page", () => {
  it("shows Mi piace first and then every playlist, linked, with counts", () => {
    index({
      likedCount: 1,
      playlists: [
        { id: "p1", name: "Sera", songCount: 3, createdAt: "", updatedAt: "" },
        { id: "p2", name: "Corsa", songCount: 1, createdAt: "", updatedAt: "" },
      ],
    });
    expect(
      screen.getByRole("heading", { name: "Le tue playlist" }),
    ).toBeInTheDocument();
    const links = within(screen.getByRole("list")).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/playlists/liked",
      "/playlists/p1",
      "/playlists/p2",
    ]);
    expect(links[0]).toHaveTextContent("Mi piace");
    expect(links[0]).toHaveTextContent("1 brano");
    expect(links[1]).toHaveTextContent("3 brani");
    expect(screen.queryByText(/Non hai ancora playlist/u)).toBeNull();
  });

  it("invites the user to make a first playlist", () => {
    index({ likedCount: 0, playlists: [] });
    expect(
      screen.getByText(
        "Non hai ancora playlist. Creane una per raccogliere le tue canzoni.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mi piace/u })).toBeInTheDocument();
  });

  it("makes a playlist from the button and opens it", async () => {
    index({ likedCount: 0, playlists: [] });
    await userEvent.click(
      screen.getByRole("button", { name: "Nuova playlist" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Nuova playlist",
    });
    await userEvent.type(
      within(dialog).getByLabelText("Nome della playlist"),
      "Alba",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Crea" }));
    expect(mock.createPlaylist).toHaveBeenCalledWith({ name: "Alba" });
    expect(mock.push).toHaveBeenCalledWith("/playlists/new-id");
  });

  it("is English when the interface is", () => {
    index({ likedCount: 2, playlists: [] }, "en");
    expect(
      screen.getByRole("heading", { name: "Your playlists" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Liked songs")).toBeInTheDocument();
    expect(screen.getByText("2 songs")).toBeInTheDocument();
  });
});
