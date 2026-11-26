import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  COMPOSER_DRAFT_KEY,
  saveComposerDraft,
} from "@/lib/site/composer-draft";
import { PlaylistsProvider, type PlaylistsState } from "./playlists-context";
import { SettingsPanel } from "./settings-panel";
import { MobileTopBar, StudioSidebar } from "./sidebar";

const mock = vi.hoisted(() => ({
  pathname: "/create",
  push: vi.fn(),
  refresh: vi.fn(),
  createPlaylist: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    id: "new-id" as string | undefined,
  })),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mock.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mock.push, refresh: mock.refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));
vi.mock("@/app/actions/playlists", () => ({
  createPlaylist: mock.createPlaylist,
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

const STATE: PlaylistsState = {
  likedCount: 6,
  playlists: [
    { id: "p1", name: "Sera", songCount: 3, createdAt: "", updatedAt: "" },
    { id: "p2", name: "Corsa", songCount: 0, createdAt: "", updatedAt: "" },
  ],
};

function sidebar(state: PlaylistsState = STATE, lang: "it" | "en" = "it") {
  return render(
    <LocaleProvider value={lang}>
      <TooltipProvider>
        <PlaylistsProvider value={state}>
          <StudioSidebar email="a@b.test" />
          <MobileTopBar />
        </PlaylistsProvider>
      </TooltipProvider>
    </LocaleProvider>,
  );
}
const main = (lang: "it" | "en" = "it") =>
  screen.getAllByRole("navigation", {
    name: lang === "it" ? "Navigazione principale" : "Main navigation",
  });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mock.pathname = "/create";
  mock.createPlaylist.mockResolvedValue({ ok: true, id: "new-id" });
});

describe("navigation", () => {
  it("has Playlist and Cerca entries in the sidebar and the phone bar", () => {
    sidebar();
    for (const nav of main()) {
      expect(
        within(nav).getByRole("link", { name: /Playlist/u }),
      ).toHaveAttribute("href", "/playlists");
      expect(within(nav).getByRole("link", { name: /Cerca/u })).toHaveAttribute(
        "href",
        "/search",
      );
    }
  });

  it("marks Cerca active on the search page", () => {
    mock.pathname = "/search";
    sidebar();
    expect(
      within(main()[0] as HTMLElement).getByRole("link", { name: /Cerca/u }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(main()[0] as HTMLElement).getByRole("link", { name: /Libreria/u }),
    ).not.toHaveAttribute("aria-current");
  });

  it("keeps Playlist active on a playlist page", () => {
    mock.pathname = "/playlists/p1";
    sidebar();
    expect(
      within(main()[0] as HTMLElement).getByRole("link", { name: /Playlist/u }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("is English when the interface is", () => {
    sidebar(STATE, "en");
    expect(
      within(main("en")[0] as HTMLElement).getByRole("link", {
        name: /Search/u,
      }),
    ).toHaveAttribute("href", "/search");
  });
});

describe("playlist list", () => {
  it("lists Mi piace first, then the playlists, with their counts", () => {
    sidebar();
    const heading = screen.getByRole("heading", { name: "Le tue playlist" });
    const list = heading.parentElement?.nextElementSibling as HTMLElement;
    const items = within(list).getAllByRole("link");
    expect(items.map((a) => a.getAttribute("href"))).toEqual([
      "/playlists/liked",
      "/playlists/p1",
      "/playlists/p2",
    ]);
    expect(items[0]).toHaveTextContent("Mi piace");
    expect(items[0]).toHaveTextContent("6");
    expect(items[1]).toHaveTextContent("Sera");
    expect(items[1]).toHaveTextContent("3");
  });

  it("marks the open playlist", () => {
    mock.pathname = "/playlists/p2";
    sidebar();
    expect(screen.getByRole("link", { name: /Corsa/u })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /Sera/u })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("shows Mi piace alone when there are no playlists", () => {
    sidebar({ playlists: [], likedCount: 0 });
    expect(screen.getByRole("link", { name: /Mi piace/u })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Sera/u })).toBeNull();
  });

  it("makes a new playlist from the plus button and opens it", async () => {
    sidebar();
    await userEvent.click(
      screen.getAllByRole("button", {
        name: "Nuova playlist",
      })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Nuova playlist",
    });
    await userEvent.type(
      within(dialog).getByLabelText("Nome della playlist"),
      " Notte {Enter}",
    );
    expect(mock.createPlaylist).toHaveBeenCalledWith({ name: "Notte" });
    await waitFor(() =>
      expect(mock.push).toHaveBeenCalledWith("/playlists/new-id"),
    );
    expect(mock.toast.success).toHaveBeenCalledWith('Playlist "Notte" creata');
    expect(mock.refresh).toHaveBeenCalled();
  });

  it("makes one from the button under the list as well", async () => {
    sidebar();
    const buttons = screen.getAllByRole("button", { name: "Nuova playlist" });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1] as HTMLElement);
    expect(
      await screen.findByRole("dialog", { name: "Nuova playlist" }),
    ).toBeInTheDocument();
  });

  it("does not create a playlist without a name, and says when creation fails", async () => {
    sidebar();
    await userEvent.click(
      screen.getAllByRole("button", {
        name: "Nuova playlist",
      })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog");
    const create = within(dialog).getByRole("button", { name: "Crea" });
    expect(create).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText("Nome della playlist"),
      "   ",
    );
    expect(create).toBeDisabled();

    mock.createPlaylist.mockResolvedValueOnce({ ok: false, id: undefined });
    await userEvent.type(
      within(dialog).getByLabelText("Nome della playlist"),
      "Notte{Enter}",
    );
    await waitFor(() =>
      expect(mock.toast.error).toHaveBeenCalledWith(
        "Non sono riuscito a creare la playlist",
      ),
    );
    expect(mock.push).not.toHaveBeenCalled();
    // The window stays open with the name, so nothing typed is lost.
    expect(
      within(screen.getByRole("dialog")).getByLabelText("Nome della playlist"),
    ).toHaveValue("   Notte");
  });
});

describe("sign-out clears home composer draft", () => {
  it("removes mellodifai:composer-draft when signing out from the sidebar", async () => {
    saveComposerDraft("Draft from home page");
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).not.toBeNull();
    sidebar(STATE, "en");
    await userEvent.click(
      screen.getByRole("button", { name: "Sign out (a@b.test)" }),
    );
    await waitFor(() => expect(mock.push).toHaveBeenCalledWith("/login"));
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it("removes mellodifai:composer-draft when signing out from settings", async () => {
    saveComposerDraft("Draft from home page");
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).not.toBeNull();
    render(
      <LocaleProvider value="en">
        <SettingsPanel email="a@b.test" />
      </LocaleProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mock.push).toHaveBeenCalledWith("/login"));
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
  });
});
