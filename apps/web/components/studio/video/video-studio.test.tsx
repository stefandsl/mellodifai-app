import {
  CLASSICO_COLORS,
  COLOR_PRESETS,
  defaultVisualizerParams,
  effectOf,
  normalizeVisualizerParams,
  VISUALIZER_PRESETS,
} from "@mellodifai/shared";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import type { Clip, VisualizerVideo } from "@/lib/studio/clips";
import { useCreateForm } from "@/store/create-form";
import { useKnownClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { lookFor, useVideoStudio } from "@/store/video-studio";
import { VideoStudio } from "./video-studio";

const mock = vi.hoisted(() => ({
  requestVisualizer: vi.fn(async (_input: unknown) => ({
    ok: true as boolean,
    id: "job-1",
  })),
  upload: vi.fn(
    async (_file: File) =>
      "/media/uploads/u1/11111111-2222-4333-8444-555555555555.png",
  ),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/app/actions/visualizer", () => ({
  requestVisualizer: mock.requestVisualizer,
  keepAudioWithVisualizer: vi.fn(),
}));
vi.mock("@/lib/studio/visualizer/upload", async (load) => ({
  ...(await load<typeof import("@/lib/studio/visualizer/upload")>()),
  uploadStudioFile: mock.upload,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh, push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

const clip = {
  id: "v1",
  title: "Solo un caffè",
  lang: "it",
  model: "V6",
  settings: {},
  status: "audio_ready",
  trashedAt: null,
  chosenTakeId: "t1",
  audioUrl: "/media/previews/t1.mp3",
  videoUrl: null,
  href: "/projects/p1?lang=it",
  art: "red",
  reaction: "none",
  coverUrl: "/media/previews/cover.jpg",
  takes: [
    { id: "t1", number: 1, audioUrl: "/media/previews/t1.mp3", scores: null },
  ],
  visualizers: [],
} as unknown as Clip;

const params = () => useVideoStudio.getState().params;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn(async () => {}),
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn(async () => []) },
  });
  useVideoStudio.setState({
    open: false,
    clip: null,
    setup: false,
    tab: "preset",
    params: defaultVisualizerParams(),
    watched: [],
  });
  useKnownClips.setState({ known: {} });
  usePlayer.setState({ queue: [], index: -1, playing: false });
});
afterEach(() => vi.unstubAllGlobals());

function studio(target: Clip | null = clip) {
  render(
    <LocaleProvider value="it">
      <VideoStudio />
    </LocaleProvider>,
  );
  act(() => {
    if (target) useVideoStudio.getState().openFor(target);
    else useVideoStudio.getState().openSetup();
  });
  return screen.getByTestId("video-studio");
}

describe("Video Studio", () => {
  it("opens for a song with tabs, the live preview, play and the render button", () => {
    const dialog = studio();
    expect(within(dialog).getByText("Video Studio")).toBeInTheDocument();
    expect(within(dialog).getByText(/Solo un caffè/u)).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Preset", "Stile", "Testo", "Effetti"]);
    expect(within(dialog).getByTestId("visualizer-preview")).toHaveAttribute(
      "data-preset",
      "circle",
    );
    expect(
      within(dialog).getByRole("button", { name: "Riproduci la canzone" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: /Renderizza video \(MP4\)/u }),
    ).toBeEnabled();
  });

  it("switches the preview's preset at once, and Classico brings the channel colours", async () => {
    const dialog = studio();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /Specchio/u }),
    );
    expect(params().preset).toBe("mirror");
    expect(within(dialog).getByTestId("visualizer-preview")).toHaveAttribute(
      "data-preset",
      "mirror",
    );
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /MellodifAI Classico/u }),
    );
    expect(params().preset).toBe("classico");
    expect(params().colors).toEqual(CLASSICO_COLORS);
  });

  it("lists every preset, the catalogue looks with their Italian names", async () => {
    const dialog = studio();
    const group = within(dialog).getByRole("radiogroup", { name: "Preset" });
    expect(within(group).getAllByRole("radio")).toHaveLength(
      VISUALIZER_PRESETS.length,
    );
    for (const name of [
      "Punti",
      "Burst",
      "Corona",
      "Anello a Filo",
      "Lente",
      "Pillole",
      "Bordi Pixel",
      "Cornice Cover",
      "Scheda Player",
      "Contorni",
      "Synthwave",
      "Editoriale",
      "Particelle a Forme",
    ])
      expect(
        within(group).getByRole("radio", { name: new RegExp(`^${name}`, "u") }),
      ).toBeInTheDocument();
    await userEvent.click(
      within(group).getByRole("radio", { name: /^Scheda Player/u }),
    );
    expect(params().preset).toBe("playercard");
    expect(within(dialog).getByTestId("visualizer-preview")).toHaveAttribute(
      "data-preset",
      "playercard",
    );
  });

  it("shows a look's options only for the looks that have them", async () => {
    const dialog = studio();
    expect(within(dialog).queryByText("Opzioni del preset")).toBeNull();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /^Corona/u }),
    );
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Spillo" }),
    );
    expect(params().look.teeth).toBe("pin");
    await userEvent.click(
      within(dialog).getByRole("switch", { name: /Simmetrica/u }),
    );
    expect(params().look.mirrored).toBe(false);
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /^Particelle a Forme/u }),
    );
    await userEvent.click(within(dialog).getByRole("radio", { name: "Cuore" }));
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Ad anello" }),
    );
    expect(params().look).toMatchObject({ shape: "heart", flow: "radial" });
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /^Contorni/u }),
    );
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Creste" }),
    );
    expect(params().look.contour).toBe("ridges");
  });

  it("turns the rotating badges on over any preset, with their own text", async () => {
    const dialog = studio();
    expect(
      within(dialog).queryByRole("textbox", { name: "Testo dei badge" }),
    ).toBeNull();
    await userEvent.click(
      within(dialog).getByRole("switch", { name: /Badge Rotanti/u }),
    );
    expect(params().badges.enabled).toBe(true);
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Testo dei badge" }),
      "Nuovo singolo",
    );
    expect(params().badges.text).toBe("Nuovo singolo");
    expect(params().preset).toBe("circle");
  });

  it("asks for artist and album on the looks that show them", async () => {
    const dialog = studio();
    useVideoStudio.getState().update((p) => ({ ...p, preset: "playercard" }));
    await userEvent.click(within(dialog).getByRole("tab", { name: "Testo" }));
    expect(within(dialog).getByText("Artista e album")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: "Sito" })).toBeNull();
    expect(
      within(dialog).queryByRole("switch", { name: /Schede/u }),
    ).toBeNull();
    const album = within(dialog).getByRole("textbox", { name: "Album" });
    await userEvent.type(album, "Lampioni");
    expect(params().classico.album).toBe("Lampioni");
  });

  it("switches between 16:9 and full-frame 9:16", async () => {
    const dialog = studio();
    await userEvent.click(within(dialog).getByRole("radio", { name: /9:16/u }));
    expect(params().aspect).toBe("9:16");
    expect(within(dialog).getByTestId("visualizer-preview")).toHaveAttribute(
      "data-aspect",
      "9:16",
    );
  });

  it("plays the song through the shared player", async () => {
    const dialog = studio();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Riproduci la canzone" }),
    );
    const player = usePlayer.getState();
    expect(player.queue[player.index]?.id).toBe("v1");
    expect(player.playing).toBe(true);
    expect(
      within(dialog).getByRole("button", { name: "Metti in pausa" }),
    ).toBeInTheDocument();
  });

  it("styles the background, colours, particles and centre image", async () => {
    const dialog = studio();
    await userEvent.click(within(dialog).getByRole("tab", { name: "Stile" }));
    const seed = params().background.seed;
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Un'altra immagine/u }),
    );
    expect(params().background.seed).not.toBe(seed);
    // Clicking Casuale again re-rolls too.
    const next = params().background.seed;
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Casuale" }),
    );
    expect(params().background.seed).not.toBe(next);
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Immagine" }),
    );
    expect(params().background.mode).toBe("image");
    expect(within(dialog).getByText(/fino a 10 MB/u)).toBeInTheDocument();
    const dimming = within(dialog).getByRole("slider", { name: "Oscuramento" });
    expect(dimming).toHaveValue("60");
    // Ten swatches; picking one recolours.
    const swatches = within(
      within(dialog).getByRole("radiogroup", { name: "Colori predefiniti" }),
    ).getAllByRole("radio");
    expect(swatches).toHaveLength(10);
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Oceano" }),
    );
    const ocean = COLOR_PRESETS.find((c) => c.id === "ocean");
    expect(params().colors).toEqual({
      primary: ocean?.primary,
      secondary: ocean?.secondary,
    });
    const hex = within(dialog).getByRole("textbox", { name: "Primario hex" });
    await userEvent.clear(hex);
    await userEvent.type(hex, "#123ABC");
    expect(params().colors.primary).toBe("#123abc");
    expect(
      within(dialog).getByRole("slider", { name: "Particelle" }),
    ).toHaveValue("30");
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Nessuna" }),
    );
    expect(params().centerImage.mode).toBe("none");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Ripristina/u }),
    );
    expect(params().centerImage).toEqual({ mode: "cover", assetUrl: null });
  });

  it("uploads a background picture, and refuses files over the limit or of another type", async () => {
    const dialog = studio();
    await userEvent.click(within(dialog).getByRole("tab", { name: "Stile" }));
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Immagine" }),
    );
    const input = within(dialog).getByTestId(
      "upload-image",
    ) as HTMLInputElement;
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    await userEvent.upload(input, big);
    expect(mock.toast.error).toHaveBeenCalledWith("Il file supera 10 MB.");
    expect(mock.upload).not.toHaveBeenCalled();
    await userEvent.upload(
      input,
      new File(["x"], "a.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(params().background.assetUrl).toBe(
        "/media/uploads/u1/11111111-2222-4333-8444-555555555555.png",
      ),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Togli il file" }),
    );
    expect(params().background.assetUrl).toBeNull();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Video" }));
    expect(within(dialog).getByText(/fino a 100 MB/u)).toBeInTheDocument();
    const video = within(dialog).getByTestId(
      "upload-video",
    ) as HTMLInputElement;
    expect(video.accept).toBe("video/mp4,video/webm");
  });

  it("adds, edits and deletes text layers", async () => {
    const dialog = studio();
    await userEvent.click(within(dialog).getByRole("tab", { name: "Testo" }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Aggiungi testo/u }),
    );
    const layer = within(dialog).getByRole("article", { name: "Livello 1" });
    await userEvent.type(
      within(layer).getByRole("textbox", { name: "Testo" }),
      "Ciao",
    );
    expect(params().textLayers[0]).toMatchObject({
      text: "Ciao",
      x: 50,
      color: "#ffffff",
    });
    expect(
      within(layer).getByRole("slider", { name: "Posizione X" }),
    ).toHaveValue("50");
    const size = within(layer).getByRole("spinbutton", { name: "Dimensione" });
    await userEvent.clear(size);
    await userEvent.type(size, "90");
    expect(params().textLayers[0]?.size).toBe(90);
    await userEvent.click(
      within(layer).getByRole("button", { name: "Elimina il livello 1" }),
    );
    expect(params().textLayers).toHaveLength(0);
  });

  it("edits the Classico lines only while Classico is chosen", async () => {
    const dialog = studio();
    await userEvent.click(within(dialog).getByRole("tab", { name: "Testo" }));
    expect(
      within(dialog).queryByText("Testi di MellodifAI Classico"),
    ).toBeNull();
    useVideoStudio.getState().update((p) => ({ ...p, preset: "classico" }));
    const album = await within(dialog).findByRole("textbox", { name: "Album" });
    await userEvent.type(album, "Italian rap");
    expect(params().classico.album).toBe("Italian rap");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Nero" }));
    expect(params().classico.gramophone).toBe("black");
    await userEvent.click(
      within(dialog).getByRole("switch", { name: /Schede/u }),
    );
    expect(params().classico.cards).toBe(false);
  });

  it("turns effects on with an Intensità slider each, stackable", async () => {
    const dialog = studio();
    await userEvent.click(within(dialog).getByRole("tab", { name: "Effetti" }));
    expect(within(dialog).getAllByRole("switch")).toHaveLength(6);
    expect(
      within(dialog).queryByRole("slider", { name: "Intensità" }),
    ).toBeNull();
    await userEvent.click(within(dialog).getByRole("switch", { name: /VHS/u }));
    await userEvent.click(
      within(dialog).getByRole("switch", { name: /Glitch/u }),
    );
    expect(effectOf(params(), "vhs").enabled).toBe(true);
    expect(effectOf(params(), "glitch").enabled).toBe(true);
    expect(
      within(dialog).getAllByRole("slider", { name: "Intensità" }),
    ).toHaveLength(2);
  });

  it("queues the render with the look on screen and shows its place in the queue", async () => {
    const dialog = studio();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /^Onda/u }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Renderizza video \(MP4\)/u }),
    );
    expect(mock.requestVisualizer).toHaveBeenCalledWith({
      versionId: "v1",
      params: expect.objectContaining({ preset: "waveform", aspect: "16:9" }),
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: /In coda/u }),
      ).toBeDisabled(),
    );
    expect(useVideoStudio.getState().watched[0]).toMatchObject({
      jobId: "job-1",
      clipId: "v1",
      aspect: "16:9",
    });
    act(() =>
      useVideoStudio.getState().report("job-1", { status: "running", pct: 42 }),
    );
    expect(
      within(dialog).getByRole("button", { name: /Rendering 42%/u }),
    ).toBeDisabled();
    expect(mock.toast.success).toHaveBeenCalledWith(
      "Video in coda sul PC di render",
    );
  });

  it("shows the last video to download and a failed render's reason", () => {
    const done: VisualizerVideo = {
      aspect: "16:9",
      renderId: "r1",
      params: normalizeVisualizerParams({ preset: "mirror" }),
      url: "/media/previews/v.mp4",
      posterUrl: null,
      downloadUrl: "/media/previews/v.mp4?download=x.mp4",
      status: "done",
      jobId: "j1",
      error: null,
      startedAt: null,
      queuePosition: null,
    };
    const dialog = studio({ ...clip, visualizers: [done] } as Clip);
    // A re-render starts from the look of the last video.
    expect(params().preset).toBe("mirror");
    expect(
      within(dialog).getByRole("link", { name: /Ultimo video 16:9/u }),
    ).toHaveAttribute("href", done.downloadUrl);
    act(() =>
      useKnownClips.setState({
        known: {
          v1: {
            ...clip,
            visualizers: [
              { ...done, status: "failed", error: "Chrome crashed" },
            ],
          } as Clip,
        },
      }),
    );
    expect(within(dialog).getByText(/Chrome crashed/u)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Renderizza video \(MP4\)/u }),
    ).toBeEnabled();
  });

  it("cannot render a song without its chosen audio", () => {
    const dialog = studio({ ...clip, status: "takes_review" } as Clip);
    expect(
      within(dialog).getByRole("button", { name: /Renderizza video \(MP4\)/u }),
    ).toBeDisabled();
  });

  it("in setup keeps the look for the next songs' visualizer", async () => {
    const dialog = studio(null);
    expect(within(dialog).getByText(/prossime canzoni/u)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Riproduci la canzone" }),
    ).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Usa questo look/u }),
    );
    expect(useCreateForm.getState().video.mode).toBe("visualizer");
    expect(useVideoStudio.getState().open).toBe(false);
  });
});

describe("the look a song opens with", () => {
  it("is its last render of that aspect, else the last look used", () => {
    const last = { ...defaultVisualizerParams(), preset: "spectrum" as const };
    expect(lookFor(clip, last)).toBe(last);
    const own = {
      ...clip,
      visualizers: [
        {
          aspect: "16:9",
          params: { ...defaultVisualizerParams(), preset: "minimal" },
        },
      ],
    } as Clip;
    expect(lookFor(own, last).preset).toBe("minimal");
    expect(lookFor(own, { ...last, aspect: "9:16" }).preset).toBe("spectrum");
  });
});
