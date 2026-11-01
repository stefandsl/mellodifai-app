import { LANGS } from "@mellodifai/shared";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  signed: vi.fn(async (path: string) => ({
    data: { signedUrl: `https://example.test/${path}` },
  })),
  versions: [] as {
    id: string;
    lang: string;
    status: string;
    generation_count: number;
    render_attempt: number;
  }[],
  workspace: vi.fn(),
}));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "it" }));
vi.mock("@/lib/auth", () => ({
  requireProfile: async () => ({
    supabase: {
      from: (table: string) => {
        const project = {
          id: "p",
          topic: "Va bene, passa (VBP)",
          versions: mock.versions,
          updated_at: "2026-10-31",
        };
        const data =
          table === "projects"
            ? [project]
            : table === "renders"
              ? [
                  {
                    id: "m",
                    kind: "master",
                    preview_path: "previews/owner/p/it/video-720p.mp4",
                    qa_results: {},
                  },
                  { id: "h", kind: "hook", preview_path: null, qa_results: {} },
                ]
              : [];
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => ({
            data: table === "projects" ? project : null,
          }),
          // biome-ignore lint/suspicious/noThenProperty: models Supabase's awaitable query builder.
          then: (resolve: (v: { data: unknown[] }) => unknown) =>
            Promise.resolve({ data }).then(resolve),
        };
        return query;
      },
      storage: { from: () => ({ createSignedUrl: mock.signed }) },
    },
  }),
}));
vi.mock("@/components/project-workspace", () => ({
  ProjectWorkspace: (props: unknown) => {
    mock.workspace(props);
    return null;
  },
}));
vi.mock("@/components/live-timeline", () => ({ LiveTimeline: () => null }));
vi.mock("@/components/worker-badge", () => ({ WorkerBadge: () => null }));

import ProjectPage from "@/app/(app)/projects/[id]/page";

beforeEach(() => {
  vi.clearAllMocks();
  mock.versions = [...LANGS].reverse().map((lang) => ({
    id: lang,
    lang,
    status: "approved",
    generation_count: 1,
    render_attempt: 1,
  }));
});
it("renders ordered tabs, a brand-red active language and exactly one status badge", async () => {
  render(
    await ProjectPage({
      params: Promise.resolve({ id: "p" }),
      searchParams: Promise.resolve({}),
    }),
  );
  const links = within(screen.getByRole("navigation")).getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual(
    LANGS.map((lang) => lang.toUpperCase()),
  );
  expect(links[0]).toHaveAttribute("aria-current", "page");
  expect(links[0].firstElementChild).toHaveClass(
    "bg-[var(--brand)]",
    "text-white",
  );
  expect(links[1]).not.toHaveAttribute("aria-current");
  expect(links[1].firstElementChild).toHaveAttribute("data-variant", "outline");
  expect(screen.getAllByText("Approvato")).toHaveLength(1);
  expect(mock.workspace.mock.calls[0][0]).toMatchObject({
    version: { lang: "it" },
    thumbnailUrl: "/media/previews/owner/p/it/thumbnail-1280x720.png",
  });
  expect(mock.signed).toHaveBeenCalledWith(
    "previews/owner/p/it/video-720p.mp4",
    3600,
  );
  expect(mock.signed).toHaveBeenCalledWith(
    "previews/owner/p/it/hook.mp4",
    3600,
  );
});
it("honors the requested project language", async () => {
  render(
    await ProjectPage({
      params: Promise.resolve({ id: "p" }),
      searchParams: Promise.resolve({ lang: "fr" }),
    }),
  );
  expect(screen.getByRole("link", { name: "FR" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("titles the page with the song's title and keeps the prompt underneath", async () => {
  mock.versions = mock.versions.map((version) =>
    version.lang === "it"
      ? Object.assign(version, { lyric_pack: { title: "Va bene, Pazienza" } })
      : version,
  );
  render(
    await ProjectPage({
      params: Promise.resolve({ id: "p" }),
      searchParams: Promise.resolve({ lang: "it" }),
    }),
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Va bene, Pazienza",
  );
  expect(screen.getByText("Va bene, passa (VBP)")).toBeVisible();
});
