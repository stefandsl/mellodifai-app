import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import { usePlayer } from "@/store/player";
import { useReactions } from "@/store/reactions";
import { WorkspaceFeed } from "./workspace-feed";

const mock = vi.hoisted(() => ({
  setReaction: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  renameVersion: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  trashVersions: vi.fn(async (input: unknown) => ({
    ok: true as boolean,
    count: (input as { versionIds: string[] }).versionIds.length,
  })),
  restoreVersions: vi.fn(async (input: unknown) => ({
    ok: true as boolean,
    count: (input as { versionIds: string[] }).versionIds.length,
  })),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/app/actions/library", () => ({
  setReaction: mock.setReaction,
  renameVersion: mock.renameVersion,
  trashVersions: mock.trashVersions,
  restoreVersions: mock.restoreVersions,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
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
      <WorkspaceFeed clips={clips} {...props} />
    </LocaleProvider>,
  );
}
const card = (title: string) =>
  within(screen.getByRole("article", { name: title }));

beforeEach(() => {
  vi.clearAllMocks();
  useReactions.setState({ server: {}, over: {}, pending: {} });
  usePlayer.setState({ queue: [], index: -1, playing: false, time: 0 });
  mock.setReaction.mockResolvedValue({ ok: true });
  mock.renameVersion.mockResolvedValue({ ok: true });
});

describe("like and dislike", () => {
  it("presses and clears the reaction, one at a time", async () => {
    feed([clip("a")]);
    const like = () =>
      card("Canzone a").getByRole("button", { name: "Mi piace" });
    const dislike = () =>
      card("Canzone a").getByRole("button", { name: "Non mi piace" });
    expect(like()).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(like());
    expect(mock.setReaction).toHaveBeenLastCalledWith({
      versionId: "a",
      reaction: "like",
    });
    expect(like()).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(dislike());
    expect(mock.setReaction).toHaveBeenLastCalledWith({
      versionId: "a",
      reaction: "dislike",
    });
    expect(like()).toHaveAttribute("aria-pressed", "false");
    expect(dislike()).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(dislike());
    expect(mock.setReaction).toHaveBeenLastCalledWith({
      versionId: "a",
      reaction: "none",
    });
    expect(dislike()).toHaveAttribute("aria-pressed", "false");
    expect(mock.refresh).toHaveBeenCalled();
  });

  it("starts from the saved reaction and puts it back when saving fails", async () => {
    mock.setReaction.mockResolvedValue({ ok: false });
    feed([clip("a", { reaction: "like" })]);
    const like = card("Canzone a").getByRole("button", { name: "Mi piace" });
    expect(like).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(like);
    await waitFor(() => expect(mock.toast.error).toHaveBeenCalledTimes(1));
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Non sono riuscito a salvare la reazione",
    );
    expect(like).toHaveAttribute("aria-pressed", "true");
  });
});

describe("rename", () => {
  it("saves on Enter and shows the new title", async () => {
    feed([clip("a")]);
    await userEvent.click(
      screen.getByRole("button", { name: "Rinomina: Canzone a" }),
    );
    const input = screen.getByRole("textbox", { name: "Titolo della canzone" });
    expect(input).toHaveValue("Canzone a");
    await userEvent.clear(input);
    await userEvent.type(input, "  Lunedì sera {Enter}");
    expect(mock.renameVersion).toHaveBeenCalledWith({
      versionId: "a",
      title: "Lunedì sera",
    });
    expect(
      await screen.findByRole("link", { name: "Lunedì sera" }),
    ).toBeVisible();
    expect(mock.refresh).toHaveBeenCalled();
  });

  it("cancels on Escape without saving", async () => {
    feed([clip("a")]);
    await userEvent.click(
      screen.getByRole("button", { name: "Rinomina: Canzone a" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Titolo della canzone" }),
      "xyz{Escape}",
    );
    expect(mock.renameVersion).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Canzone a" })).toBeVisible();
  });

  it("keeps the field open and shows an error when saving fails", async () => {
    mock.renameVersion.mockResolvedValue({ ok: false });
    feed([clip("a")]);
    await userEvent.click(
      screen.getByRole("button", { name: "Rinomina: Canzone a" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Titolo della canzone" }),
      " bis{Enter}",
    );
    await waitFor(() =>
      expect(mock.toast.error).toHaveBeenCalledWith(
        "Non sono riuscito a rinominare la canzone",
      ),
    );
    expect(
      screen.getByRole("textbox", { name: "Titolo della canzone" }),
    ).toBeVisible();
  });
});

describe("filters", () => {
  const clips = [
    clip("liked", { reaction: "like" }),
    clip("making", { status: "song_queued", audioUrl: null }),
    clip("audio", { status: "audio_ready" }),
    clip("plain"),
  ];
  const shown = () =>
    screen.queryAllByRole("article").map((a) => a.getAttribute("aria-label"));

  it("narrows the feed with Mi piace, In creazione and Solo audio", async () => {
    feed(clips);
    expect(shown()).toHaveLength(4);
    const chips = within(
      screen.getByText("Solo audio", { selector: "button" })
        .parentElement as HTMLElement,
    );
    await userEvent.click(chips.getByRole("button", { name: "Mi piace" }));
    expect(shown()).toEqual(["Canzone liked"]);
    await userEvent.click(chips.getByRole("button", { name: "Mi piace" }));
    await userEvent.click(chips.getByRole("button", { name: "In creazione" }));
    expect(shown()).toEqual(["Canzone making"]);
    await userEvent.click(chips.getByRole("button", { name: "In creazione" }));
    await userEvent.click(chips.getByRole("button", { name: "Solo audio" }));
    expect(shown()).toEqual(["Canzone audio"]);
  });
});

describe("card details", () => {
  it("shows the plays and the place in the queue only when they mean something", () => {
    feed([
      clip("a", { playCount: 7, queuePosition: 3, status: "song_queued" }),
      clip("b", { playCount: 1, queuePosition: 1, status: "song_queued" }),
      clip("c"),
    ]);
    expect(card("Canzone a").getByText(/7 ascolti/)).toBeVisible();
    expect(card("Canzone a").getByText("In coda #3")).toBeVisible();
    expect(card("Canzone b").getByText(/1 ascolto/)).toBeVisible();
    expect(card("Canzone b").queryByText(/In coda/)).not.toBeInTheDocument();
    expect(card("Canzone c").queryByText(/ascolt/)).not.toBeInTheDocument();
  });
});

describe("select mode and trash", () => {
  const three = () => [clip("a"), clip("b"), clip("c")];

  it("selects songs and moves them to the trash, reporting what moved", async () => {
    mock.trashVersions.mockResolvedValueOnce({ ok: true, count: 2 });
    usePlayer.setState({
      queue: [{ id: "b" }, { id: "x" }] as never,
      index: 1,
      playing: true,
    });
    feed(three());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Seleziona" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    const move = screen.getByRole("button", { name: "Sposta nel cestino" });
    expect(move).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "Seleziona tutto" }),
    );
    expect(screen.getByText("3 selezionate")).toBeVisible();
    for (const box of screen.getAllByRole("checkbox"))
      expect(box).toBeChecked();
    // One pick comes off again.
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Seleziona: Canzone c" }),
    );
    expect(screen.getByText("2 selezionate")).toBeVisible();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Seleziona: Canzone c" }),
    );
    expect(screen.getByText("3 selezionate")).toBeVisible();

    await userEvent.click(move);
    expect(mock.trashVersions).toHaveBeenCalledWith({
      versionIds: ["a", "b", "c"],
    });
    await waitFor(() =>
      expect(mock.toast.warning).toHaveBeenCalledWith(
        "2 di 3 spostate nel cestino",
        expect.anything(),
      ),
    );
    // The songs vanish at once and the player forgets them.
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(["x"]);
    expect(mock.refresh).toHaveBeenCalled();
  });

  it("reports a clean move and offers to undo it", async () => {
    feed(three());
    await userEvent.click(screen.getByRole("button", { name: "Seleziona" }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Seleziona: Canzone a" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Seleziona: Canzone b" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Sposta nel cestino" }),
    );
    const [message, options] = mock.toast.success.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("2 canzoni spostate nel cestino");
    expect(options.action.label).toBe("Annulla");
    options.action.onClick();
    await waitFor(() =>
      expect(mock.restoreVersions).toHaveBeenCalledWith({
        versionIds: ["a", "b"],
      }),
    );
  });

  it("keeps the selection and says so when nothing could be moved", async () => {
    mock.trashVersions.mockResolvedValueOnce({ ok: true, count: 0 });
    feed(three());
    await userEvent.click(screen.getByRole("button", { name: "Seleziona" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Seleziona tutto" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Sposta nel cestino" }),
    );
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Nessuna canzone spostata nel cestino",
    );
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("3 selezionate")).toBeVisible();
  });

  it("moves one song from its menu", async () => {
    feed(three());
    await userEvent.click(
      card("Canzone b").getByRole("button", { name: "Altre opzioni" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Sposta nel cestino" }),
    );
    expect(mock.trashVersions).toHaveBeenCalledWith({ versionIds: ["b"] });
    await waitFor(() =>
      expect(mock.toast.success).toHaveBeenCalledWith(
        "Spostata nel cestino",
        expect.anything(),
      ),
    );
    expect(
      screen.queryByRole("article", { name: "Canzone b" }),
    ).not.toBeInTheDocument();
  });

  it("lists the trash with Ripristina and no playback", async () => {
    feed(
      [
        clip("a", { trashedAt: "2026-11-01T11:00:00Z" }),
        clip("b", { trashedAt: "x" }),
      ],
      { trash: true },
    );
    expect(screen.getByText(/il PC di render non lavora/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Riproduci/ }),
    ).not.toBeInTheDocument();
    expect(
      card("Canzone a").queryByRole("button", { name: "Mi piace" }),
    ).not.toBeInTheDocument();
    expect(
      card("Canzone a").queryByRole("button", { name: /Rinomina/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      card("Canzone a").getByRole("button", { name: "Ripristina" }),
    );
    expect(mock.restoreVersions).toHaveBeenCalledWith({ versionIds: ["a"] });
    await waitFor(() =>
      expect(mock.toast.success).toHaveBeenCalledWith("Canzone ripristinata"),
    );
    expect(
      screen.queryByRole("article", { name: "Canzone a" }),
    ).not.toBeInTheDocument();
  });

  it("restores several songs from the trash in one go", async () => {
    feed([clip("a"), clip("b")], { trash: true });
    await userEvent.click(screen.getByRole("button", { name: "Seleziona" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Seleziona tutto" }),
    );
    await userEvent.click(
      within(screen.getByRole("toolbar")).getByRole("button", {
        name: "Ripristina",
      }),
    );
    expect(mock.restoreVersions).toHaveBeenCalledWith({
      versionIds: ["a", "b"],
    });
    expect(mock.trashVersions).not.toHaveBeenCalled();
  });

  it("says the trash is empty", () => {
    feed([], { trash: true });
    expect(screen.getByText("Il cestino è vuoto.")).toBeVisible();
  });

  it("links the library and its trash", () => {
    const { unmount } = feed([clip("a")], { trashLink: true });
    expect(screen.getByRole("link", { name: "Cestino" })).toHaveAttribute(
      "href",
      "/library?tab=trash",
    );
    unmount();
    feed([], { trash: true, trashLink: true });
    expect(
      screen.getByRole("link", { name: "Torna alla libreria" }),
    ).toHaveAttribute("href", "/library");
  });
});
