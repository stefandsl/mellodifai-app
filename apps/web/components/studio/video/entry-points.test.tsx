import { defaultVisualizerParams } from "@mellodifai/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import type { Clip, VisualizerVideo } from "@/lib/studio/clips";
import { useCreateForm } from "@/store/create-form";
import { useVideoStudio } from "@/store/video-studio";
import { VideoCard } from "../create/video-card";
import { NextStep } from "../feed/next-step";
import { WorkspaceFeed } from "../feed/workspace-feed";
import { PlaylistsProvider } from "../playlists-context";
import { VideosView } from "./videos-view";

const mock = vi.hoisted(() => ({
  keepAudioWithVisualizer: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    id: "job-9",
  })),
  refresh: vi.fn(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/app/actions/visualizer", () => ({
  requestVisualizer: vi.fn(),
  keepAudioWithVisualizer: mock.keepAudioWithVisualizer,
}));
vi.mock("@/app/actions/audio-tools", () => ({
  requestStems: vi.fn(),
  saveEditedTake: vi.fn(),
}));
vi.mock("@/app/actions/library", () => ({
  setReaction: vi.fn(async () => ({ ok: true })),
  renameVersion: vi.fn(async () => ({ ok: true })),
  trashVersions: vi.fn(async () => ({ ok: true, count: 1 })),
  restoreVersions: vi.fn(async () => ({ ok: true, count: 1 })),
}));
vi.mock("@/app/actions/playlists", () => ({
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  createPlaylist: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ rpc: vi.fn(async () => ({ data: [], error: null })) }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh, push: mock.push }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));
vi.mock("../feed/use-live-refresh", () => ({ useLiveRefresh: () => {} }));

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
    status: "audio_ready",
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    audioUrl: `/media/previews/${id}.mp3`,
    videoUrl: null,
    hookUrl: null,
    href: `/projects/p-${id}?lang=it`,
    art: "",
    hasCover: false,
    takes: [
      {
        id: `t-${id}`,
        number: 1,
        audioUrl: `/media/previews/${id}.mp3`,
        scores: null,
      },
    ],
    chosenTakeId: `t-${id}`,
    settings: {},
    pack: null,
    jury: null,
    reaction: "none",
    playCount: 0,
    trashedAt: null,
    queuePosition: null,
    stems: null,
    coverUrl: null,
    visualizers: [],
    ...patch,
  };
}

const ready: VisualizerVideo = {
  aspect: "9:16",
  renderId: "r1",
  params: defaultVisualizerParams(),
  url: "/media/previews/v.mp4",
  posterUrl: "/media/previews/v.jpg",
  downloadUrl: "/media/previews/v.mp4?download=v.mp4",
  status: "done",
  jobId: "j1",
  error: null,
  startedAt: null,
  queuePosition: null,
};

function wrap(node: React.ReactNode) {
  return render(
    <LocaleProvider value="it">
      <PlaylistsProvider value={{ playlists: [], likedCount: 0 }}>
        {node}
      </PlaylistsProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useVideoStudio.setState({
    open: false,
    clip: null,
    setup: false,
    watched: [],
  });
});

describe("Video Studio entry points", () => {
  it("opens from the song card's video button and from its menu", async () => {
    wrap(
      <WorkspaceFeed
        clips={[
          clip("a"),
          clip("b", { status: "takes_review", chosenTakeId: null }),
        ]}
      />,
    );
    const card = within(screen.getByRole("article", { name: "Canzone a" }));
    await userEvent.click(
      card.getByRole("button", { name: "Crea video visualizer: Canzone a" }),
    );
    expect(useVideoStudio.getState()).toMatchObject({
      open: true,
      setup: false,
    });
    expect(useVideoStudio.getState().clip?.id).toBe("a");
    useVideoStudio.setState({ open: false, clip: null });
    await userEvent.click(card.getByRole("button", { name: "Altre opzioni" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Crea video visualizer" }),
    );
    expect(useVideoStudio.getState().clip?.id).toBe("a");
    // A song without its chosen audio has no way in.
    const other = within(screen.getByRole("article", { name: "Canzone b" }));
    expect(
      other.getByRole("button", { name: "Crea video visualizer: Canzone b" }),
    ).toBeDisabled();
  });

  it("counts a visualizer as a video of the song", () => {
    wrap(
      <WorkspaceFeed
        clips={[clip("a", { visualizers: [ready] }), clip("b")]}
        initialFilters={["video"]}
      />,
    );
    expect(
      screen.getByRole("article", { name: "Canzone a" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Canzone b" })).toBeNull();
    expect(
      within(screen.getByRole("article", { name: "Canzone a" })).getByText(
        "VIDEO PRONTO",
      ),
    ).toBeInTheDocument();
  });

  it("lists every song's videos on the Video page, with the studio per song", async () => {
    wrap(
      <VideosView
        heading="Video"
        clips={[
          clip("a", { visualizers: [ready] }),
          clip("b", { videoUrl: "/media/previews/master.mp4" }),
          clip("c"),
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0] as HTMLElement).getByText("Visualizer 9:16"),
    ).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByRole("link", {
        name: "Scarica: Visualizer 9:16",
      }),
    ).toHaveAttribute("href", ready.downloadUrl);
    expect(
      within(rows[1] as HTMLElement).getByText("Lyric video"),
    ).toBeInTheDocument();
    expect(
      within(rows[2] as HTMLElement).getByText("Ancora nessun video"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(rows[2] as HTMLElement).getByRole("button", {
        name: /Apri Video Studio/u,
      }),
    );
    expect(useVideoStudio.getState().clip?.id).toBe("c");
  });

  it("offers Visualizer in the create panel's Video card, with the studio for the look", async () => {
    useCreateForm.getState().setVideo({ mode: "lyric" });
    useCreateForm.setState((s) => ({ open: { ...s.open, video: true } }));
    wrap(<VideoCard />);
    await userEvent.click(screen.getByRole("radio", { name: /Visualizer/u }));
    expect(useCreateForm.getState().video.mode).toBe("visualizer");
    expect(
      screen.getByText(/crea un video visualizer con questo look/u),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Apri Video Studio/u }),
    );
    expect(useVideoStudio.getState()).toMatchObject({
      open: true,
      setup: true,
      clip: null,
    });
  });

  it("makes the visualizer the first choice when picking the take of such a song", async () => {
    const look = { ...defaultVisualizerParams(), preset: "classico" as const };
    wrap(
      <NextStep
        clip={clip("a", {
          status: "takes_review",
          settings: { video: "visualizer", visualizer: look },
        })}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Scegli la take/u }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Crea video visualizer/u }),
    );
    await waitFor(() =>
      expect(mock.keepAudioWithVisualizer).toHaveBeenCalledWith({
        versionId: "a",
        takeId: "t-a",
        params: look,
      }),
    );
    expect(mock.toast.success).toHaveBeenCalledWith(
      "Video visualizer in coda sul PC",
    );
  });
});
