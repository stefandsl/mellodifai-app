import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import type { StemsPage } from "@/lib/studio/stems";
import { usePlayer } from "@/store/player";
import { fakeDb } from "@/test/fake-supabase";
import { StemsView } from "./stems-view";

const mock = vi.hoisted(() => ({
  requestStems: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
  refresh: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/app/actions/audio-tools", () => ({
  requestStems: mock.requestStems,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mock.refresh,
    back: mock.back,
    push: mock.push,
  }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));
const db = fakeDb();
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => db.client }));

const play = vi.fn(async () => {});
const pause = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: play,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: pause,
  });
  usePlayer.setState({ playing: false });
});
afterEach(() => vi.useRealTimers());

const clip = {
  id: "v1",
  title: "Solo un caffè",
  status: "audio_ready",
  trashedAt: null,
  chosenTakeId: "t1",
  audioUrl: "https://s/t1.mp3",
  art: "red",
  takes: [{ id: "t1", number: 1, audioUrl: "https://s/t1.mp3", scores: null }],
} as unknown as Clip;

const TRACKS = (["vocals", "drums", "bass", "other"] as const).map((name) => ({
  name,
  url: `https://s/${name}.mp3?token=x`,
  peaks: [0.2, 0.8, 0.4],
}));

function page(patch: Partial<StemsPage> = {}): StemsPage {
  return {
    clip,
    takeId: "t1",
    tracks: null,
    duration: 281,
    seconds: null,
    job: null,
    events: [],
    queuePosition: null,
    ...patch,
  };
}
const job = (status: string, extra: Record<string, unknown> = {}) =>
  ({
    id: "j1",
    status,
    error: null,
    createdAt: "2026-11-01T10:00:00Z",
    startedAt: null,
    finishedAt: null,
    ...extra,
  }) as StemsPage["job"];

const show = (p: StemsPage) =>
  render(
    <LocaleProvider value="it">
      <StemsView page={p} />
    </LocaleProvider>,
  );

describe("before the tracks exist", () => {
  it("offers the separation and asks the render PC for it", async () => {
    show(page());
    await userEvent.click(
      screen.getByRole("button", { name: "Separa le tracce" }),
    );
    expect(mock.requestStems).toHaveBeenCalledWith({ versionId: "v1" });
    expect(mock.refresh).toHaveBeenCalled();
  });

  it("says why a song without a chosen take cannot be separated", () => {
    show(page({ clip: { ...clip, status: "takes_review" } as Clip }));
    expect(
      screen.queryByRole("button", { name: "Separa le tracce" }),
    ).toBeNull();
    expect(
      screen.getByText(/non ha ancora una versione scelta/u),
    ).toBeVisible();
  });

  it("shows the place in the queue", () => {
    show(page({ job: job("queued"), queuePosition: 3 }));
    expect(screen.getByText("In coda #3")).toBeVisible();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
  });

  it("shows the progress of this run, the elapsed time and an estimate", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:01:00Z"));
    show(
      page({
        job: job("running", { startedAt: "2026-11-01T10:00:00Z" }),
        events: [
          // From an earlier, failed run: ignored.
          {
            id: 1,
            message: "Stems: 90%",
            progress: 90,
            at: "2026-11-01T09:00:00Z",
          },
          {
            id: 2,
            message: "Avvio",
            progress: null,
            at: "2026-11-01T10:00:01Z",
          },
          {
            id: 3,
            message: "Stems: separazione 50%",
            progress: 45,
            at: "2026-11-01T10:00:50Z",
          },
        ],
      }),
    );
    expect(screen.getByText("Separazione in corso")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "45",
    );
    expect(
      screen.getByText(/Trascorso 1:00 · circa 1:13 alla fine/u),
    ).toBeVisible();
    // The log keeps every line.
    expect(screen.getByText("Dettagli tecnici")).toBeVisible();
    expect(screen.getByText("Avvio")).toBeInTheDocument();
  });

  it("shows a failure with its reason and tries again", async () => {
    show(page({ job: job("failed", { error: "demucs exited 1" }) }));
    expect(screen.getByText("Separazione non riuscita")).toBeVisible();
    expect(screen.getByText("demucs exited 1")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(mock.requestStems).toHaveBeenCalledWith({ versionId: "v1" });
  });

  it("tells when asking failed", async () => {
    mock.requestStems.mockResolvedValueOnce({ ok: false });
    show(page());
    await userEvent.click(
      screen.getByRole("button", { name: "Separa le tracce" }),
    );
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Impossibile avviare la separazione",
    );
  });
});

describe("the separated tracks", () => {
  const ready = () =>
    show(page({ tracks: TRACKS, seconds: 137, job: job("done") }));
  const audio = () => [...document.querySelectorAll("audio")];

  it("lists the four stems with their downloads and the time it took", () => {
    ready();
    expect(screen.getByText("Completato in 2:17")).toBeVisible();
    const rows = screen.getAllByRole("listitem");
    expect(
      rows.map((row) => within(row).getAllByText(/\S/u)[0]?.textContent),
    ).toEqual(["Voce", "Batteria", "Basso", "Altro"]);
    const link = screen.getByRole("link", { name: "Scarica Batteria (MP3)" });
    expect(link).toHaveAttribute("download", "Solo un caffè - Batteria.mp3");
    expect(link.getAttribute("href")).toContain("download=Solo+un+caff");
    expect(audio().map((element) => element.getAttribute("src"))).toEqual(
      TRACKS.map((track) => track.url),
    );
  });

  it("plays one stem alone from its row and pauses it the second time", async () => {
    usePlayer.setState({ playing: true });
    ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Ascolta solo Batteria" }),
    );
    // All four run together; only the drums are heard; the main player stops.
    expect(play).toHaveBeenCalledTimes(4);
    expect(audio().map((element) => element.muted)).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect(usePlayer.getState().playing).toBe(false);
    await userEvent.click(
      screen.getByRole("button", { name: "Pausa: Batteria" }),
    );
    expect(pause).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Ascolta solo Batteria" }),
    ).toBeVisible();
  });

  it("combines solo and mute so two stems can be heard together", async () => {
    ready();
    await userEvent.click(screen.getByRole("button", { name: "Muto: Voce" }));
    expect(audio().map((element) => element.muted)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Solo: Basso" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Solo: Batteria" }),
    );
    expect(screen.getByRole("button", { name: "Solo: Basso" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(audio().map((element) => element.muted)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    await userEvent.click(
      screen.getByRole("button", { name: "Tutte le tracce" }),
    );
    expect(audio().every((element) => !element.muted)).toBe(true);
  });

  it("moves every stem when the position changes", () => {
    ready();
    const slider = screen.getByRole("slider", {
      name: /^Posizione nel brano$/u,
    });
    act(() => {
      slider.focus();
    });
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(slider, "120");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(audio().map((element) => element.currentTime)).toEqual([
      120, 120, 120, 120,
    ]);
    expect(screen.getByText("2:00 / 4:41")).toBeVisible();
  });

  it("stops when the main player starts", async () => {
    ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Riproduci il mix" }),
    );
    act(() => usePlayer.setState({ playing: true }));
    expect(
      screen.getByRole("button", { name: "Riproduci il mix" }),
    ).toBeVisible();
  });

  it("downloads all four stems as one ZIP built in the browser", async () => {
    const fetchMock = vi.fn(
      async (url: string) => new Response(`audio of ${url}`),
    );
    vi.stubGlobal("fetch", fetchMock);
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:zip";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("Solo un caffè - stems.zip");
      });
    ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Scarica tutto (ZIP)" }),
    );
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
      TRACKS.map((track) => track.url),
    );
    expect(created[0]?.type).toBe("application/zip");
    const text = new TextDecoder().decode(await created[0]?.arrayBuffer());
    expect(text).toContain("Solo un caffè - Voce.mp3");
    expect(text).toContain("audio of https://s/other.mp3?token=x");
    vi.unstubAllGlobals();
    click.mockRestore();
  });

  it("reports a ZIP that could not be made", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Scarica tutto (ZIP)" }),
    );
    await waitFor(() =>
      expect(mock.toast.error).toHaveBeenCalledWith(
        "Impossibile preparare lo ZIP",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Scarica tutto (ZIP)" }),
    ).toBeEnabled();
    vi.unstubAllGlobals();
  });
});
