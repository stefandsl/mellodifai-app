import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { usePlayer } from "@/store/player";
import { KaraokeView } from "./karaoke-view";

const mocks = vi.hoisted(() => ({ request: vi.fn(), single: vi.fn() }));
vi.mock("@/app/actions/align-lyrics", () => ({
  requestLyricAlignment: mocks.request,
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          single: () => mocks.single(table, id),
        }),
      }),
    }),
  }),
}));
function track(id: string) {
  return {
    id,
    title: id,
    subtitle: "IT",
    audioUrl: "audio.wav",
    videoUrl: null,
    href: "/",
    art: "red",
    reaction: "none" as const,
    detail: {
      own: {
        title: id,
        subtitle: "IT",
        videoUrl: null,
        reaction: "none" as const,
      },
      songId: id,
      lyrics: "Hello world",
      style: "pop",
      createdAt: "",
      chosenTakeId: `${id}-take`,
      takes: [{ id: `${id}-take`, number: 1, audioUrl: "audio.wav" }],
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  usePlayer.setState({
    queue: [track("one"), track("two")],
    index: 0,
    showLyrics: true,
    time: 0,
  });
  mocks.single.mockImplementation(async (table) => ({
    data: table === "jobs" ? { status: "running" } : { lyric_timing: null },
    error: null,
  }));
});
function mount() {
  render(
    <LocaleProvider value="it">
      <KaraokeView />
    </LocaleProvider>,
  );
}
it("restores retry when the server action rejects", async () => {
  mocks.request.mockRejectedValue(new Error("offline"));
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  ).toBeEnabled();
});
it.each(["failed", "cancelled", "done", "transport"])(
  "restores retry after %s",
  async (status) => {
    mocks.request.mockResolvedValue({ ok: true, id: "job-one" });
    mocks.single.mockImplementation(async (table) => {
      if (status === "transport") throw new Error("offline");
      return {
        data: table === "jobs" ? { status } : { lyric_timing: null },
        error: null,
      };
    });
    mount();
    await userEvent.click(
      screen.getByRole("button", { name: "Sincronizza testo" }),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Sincronizza testo" }),
    ).toBeEnabled();
  },
);
it("ignores stale polls when switching songs and allows the new song to sync", async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.request.mockResolvedValue({ ok: true, id: "job-one" });
  mocks.single.mockImplementation((table) =>
    table === "takes"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ data: { status: "running" } }),
  );
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  await waitFor(() =>
    expect(mocks.single).toHaveBeenCalledWith("takes", "one-take"),
  );
  act(() => usePlayer.setState({ index: 1 }));
  expect(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  ).toBeEnabled();
  await act(async () =>
    finish({
      data: {
        lyric_timing: {
          source: "whisper",
          lines: [{ text: "Hello world", start: 0, end: 2 }],
        },
      },
    }),
  );
  expect(
    usePlayer.getState().queue[1]?.detail?.takes[0]?.timing,
  ).toBeUndefined();
  expect(mocks.single).not.toHaveBeenCalledWith("takes", "two-take");
});

it("ignores a request response after changing takes", async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await userEvent.click(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  );
  act(() =>
    usePlayer.setState((state) => ({
      queue: state.queue.map((item, index) =>
        index !== 0 || !item.detail
          ? item
          : {
              ...item,
              detail: {
                ...item.detail,
                takeNumber: 2,
                takes: [
                  ...item.detail.takes,
                  { id: "another-take", number: 2, audioUrl: "audio.wav" },
                ],
              },
            },
      ),
    })),
  );
  expect(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  ).toBeEnabled();
  await act(async () => finish({ ok: true, id: "old-job" }));
  expect(mocks.single).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Sincronizza testo" }),
  ).toBeEnabled();
});
