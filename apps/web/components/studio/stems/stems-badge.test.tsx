import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import type { Clip, StemsState } from "@/lib/studio/clips";
import { latestProgress } from "@/lib/studio/use-job-progress";
import { StemsBadge } from "./stems-badge";

const mock = vi.hoisted(() => ({
  events: [] as unknown[],
  subscribed: [] as string[],
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: async () => ({ data: mock.events }),
    };
    const channel = {
      on: (_kind: string, filter: { filter: string }) => {
        mock.subscribed.push(filter.filter);
        return channel;
      },
      subscribe: () => channel,
    };
    return {
      from: () => query,
      channel: () => channel,
      removeChannel: async () => {},
    };
  },
}));

beforeEach(() => {
  mock.events = [];
  mock.subscribed = [];
});

const clip = (stems: StemsState | null, patch: Partial<Clip> = {}) =>
  ({ id: "v1", stems, trashedAt: null, ...patch }) as Clip;
const state = (patch: Partial<StemsState>): StemsState => ({
  takeId: "t1",
  status: "queued",
  jobId: "j1",
  queuePosition: null,
  ...patch,
});
const show = (c: Clip, done = false) =>
  render(
    <LocaleProvider value="it">
      <StemsBadge clip={c} done={done} />
    </LocaleProvider>,
  );

describe("stems badge", () => {
  it("is absent when nobody asked, in the trash, and on cards once ready", () => {
    show(clip(null));
    show(clip(state({ status: "queued" }), { trashedAt: "2026-11-01" }));
    show(clip(state({ status: "done" })));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows ready stems where asked (the details panel)", () => {
    show(clip(state({ status: "done" })), true);
    expect(screen.getByRole("link", { name: /Stems/u })).toHaveAttribute(
      "href",
      "/stems/v1",
    );
  });

  it("tells the place in the queue", () => {
    show(clip(state({ queuePosition: 4 })));
    expect(screen.getByRole("link")).toHaveTextContent("Stems in coda #4");
  });

  it("says just queued when next in line", () => {
    show(clip(state({ queuePosition: 1 })));
    expect(screen.getByRole("link")).toHaveTextContent("Stems in coda");
  });

  it("follows the running job's progress", async () => {
    mock.events = [
      { id: 5, message: "Stems: separazione 50%", progress: 45, at: "2" },
      { id: 4, message: "Stems: preparo l'audio", progress: 2, at: "1" },
    ];
    show(clip(state({ status: "running" })));
    await waitFor(() =>
      expect(screen.getByRole("link")).toHaveTextContent("Stems 45%"),
    );
    expect(mock.subscribed).toContain("job_id=eq.j1");
  });

  it("marks a failed separation", () => {
    show(clip(state({ status: "failed" })));
    expect(screen.getByRole("link")).toHaveTextContent("Stems non riusciti");
  });
});

it("reads the newest progress at or after a time", () => {
  const events = [
    { id: 1, message: "a", progress: 80, at: "2026-11-01T09:00:00Z" },
    { id: 2, message: "b", progress: 10, at: "2026-11-01T10:00:01Z" },
    { id: 3, message: "c", progress: null, at: "2026-11-01T10:00:02Z" },
  ];
  expect(latestProgress(events, null)?.id).toBe(2);
  expect(latestProgress(events, "2026-11-01T10:00:00Z")?.progress).toBe(10);
  expect(latestProgress(events, "2026-11-01T11:00:00Z")).toBeNull();
});
