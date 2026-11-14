import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import { usePlayer } from "@/store/player";
import { AudioEditor } from "./audio-editor";

const mock = vi.hoisted(() => ({
  encodeMp3: vi.fn(
    async (
      _channels: Float32Array[],
      _rate: number,
      options?: { onProgress?: (fraction: number) => void },
    ) => {
      options?.onProgress?.(0.5);
      return new Blob(["mp3"], { type: "audio/mpeg" });
    },
  ),
  saveEdit: vi.fn(
    async (
      _client: unknown,
      _id: string,
      _file: Blob,
      onStep?: (step: string) => void,
    ) => {
      onStep?.("uploading");
      return { ok: true as boolean };
    },
  ),
  back: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  started: [] as { offset: number; length: number }[],
  ramps: [] as [string, number, number][],
}));
vi.mock("@/lib/studio/mp3", () => ({ encodeMp3: mock.encodeMp3 }));
vi.mock("@/lib/studio/edit-save", () => ({ saveEdit: mock.saveEdit }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: mock.back,
    push: mock.push,
    refresh: mock.refresh,
  }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

// Ten seconds of stereo at 100 samples per second: a ramp on the left, half level on the right.
const RATE = 100;
function buffer() {
  const left = Float32Array.from({ length: 1000 }, (_, i) => i / 2000);
  const right = Float32Array.from({ length: 1000 }, () => 0.25);
  return {
    duration: 10,
    sampleRate: RATE,
    numberOfChannels: 2,
    getChannelData: (i: number) => (i === 0 ? left : right),
  };
}

class FakeContext {
  currentTime = 0;
  destination = {};
  decodeAudioData = vi.fn(async () => buffer());
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createGain() {
    const param = {
      setValueAtTime: (value: number, at: number) =>
        mock.ramps.push(["set", value, at]),
      linearRampToValueAtTime: (value: number, at: number) =>
        mock.ramps.push(["ramp", value, at]),
    };
    return { gain: param, connect: (next: unknown) => next };
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null as null | (() => void),
      connect: (next: unknown) => next,
      start: (_when: number, offset: number, length: number) =>
        mock.started.push({ offset, length }),
      stop: vi.fn(),
    };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.started = [];
  mock.ramps = [];
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  usePlayer.setState({ playing: false });
});

const clip = (patch: Partial<Clip> = {}) =>
  ({
    id: "v1",
    title: "Lunedì",
    status: "audio_ready",
    trashedAt: null,
    chosenTakeId: "t1",
    audioUrl: "https://s/t1.mp3",
    art: "red",
    takes: [
      { id: "t1", number: 1, audioUrl: "https://s/t1.mp3", scores: null },
    ],
    ...patch,
  }) as Clip;

async function open(c = clip()) {
  render(
    <LocaleProvider value="it">
      <AudioEditor clip={c} />
    </LocaleProvider>,
  );
  await screen.findByRole("img", { name: /Forma d'onda/u });
}
const field = (name: string) => screen.getByLabelText(name, { exact: true });
async function setField(name: string, text: string) {
  // Flush the controlled draft before Enter reads it, then flush the formatting
  // effect before another field's blur handler or an assertion uses the value.
  await act(async () => {
    await userEvent.clear(field(name));
  });
  await act(async () => {
    await userEvent.type(field(name), text);
  });
  await act(async () => {
    await userEvent.keyboard("{Enter}");
  });
}

describe("audio editor", () => {
  it("loads the chosen take and starts with the whole song", async () => {
    await open();
    expect(fetch).toHaveBeenCalledWith("https://s/t1.mp3");
    expect(field("Inizio")).toHaveValue("0:00.0");
    expect(field("Fine")).toHaveValue("0:10.0");
    // Nothing to save or undo yet.
    expect(
      screen.getByRole("button", { name: "Salva come nuova versione" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Annulla le modifiche" }),
    ).toBeDisabled();
  });

  it("says when the song cannot be edited now", () => {
    render(
      <LocaleProvider value="it">
        <AudioEditor clip={clip({ status: "producing" })} />
      </LocaleProvider>,
    );
    expect(screen.getByText(/si può modificare quando/u)).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers to try again when the audio cannot be loaded", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 403 }));
    render(
      <LocaleProvider value="it">
        <AudioEditor clip={clip()} />
      </LocaleProvider>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Riprova" }),
    );
    await screen.findByRole("img", { name: /Forma d'onda/u });
  });

  it("trims with the fields and the handles, keeping at least a second", async () => {
    await open();
    await setField("Inizio", "2");
    await setField("Fine", "0:06.5");
    expect(field("Inizio")).toHaveValue("0:02.0");
    expect(screen.getByText("0:04.5", { selector: "p" })).toBeVisible();
    // A start past the end is pulled back a second before it.
    await setField("Inizio", "9");
    expect(field("Inizio")).toHaveValue("0:05.5");
    // Text that is not a time puts the value back.
    await setField("Fine", "dopo");
    expect(field("Fine")).toHaveValue("0:06.5");
    const handle = screen.getByRole("slider", { name: "Fine del taglio" });
    act(() => handle.focus());
    await userEvent.keyboard(
      "{ArrowRight}{ArrowRight}{Shift>}{ArrowRight}{/Shift}",
    );
    expect(field("Fine")).toHaveValue("0:07.7");
    expect(
      screen.getByRole("button", { name: "Annulla le modifiche" }),
    ).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Annulla le modifiche" }),
    );
    expect(field("Inizio")).toHaveValue("0:00.0");
  });

  it("plays only the kept part through the fades", async () => {
    await open();
    await setField("Inizio", "2");
    await setField("Fine", "8");
    await waitFor(() => expect(field("Inizio")).toHaveValue("0:02.0"));
    await waitFor(() => expect(field("Fine")).toHaveValue("0:08.0"));
    await userEvent.click(
      screen.getByRole("button", { name: /^Dissolvenza in entrata:/u }),
    );
    await userEvent.keyboard("1.5{Enter}");
    usePlayer.setState({ playing: true });
    await userEvent.click(
      screen.getByRole("button", { name: "Ascolta la modifica" }),
    );
    await waitFor(() =>
      expect(mock.started).toEqual([{ offset: 2, length: 6 }]),
    );
    expect(mock.ramps).toEqual([
      ["set", 0, 0],
      ["ramp", 1, 1.5],
    ]);
    // One sound at a time.
    expect(usePlayer.getState().playing).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Pausa" }));
    expect(
      screen.getByRole("button", { name: "Ascolta la modifica" }),
    ).toBeVisible();
  }, 15_000);

  it("exports the edit as WAV and as MP3 under the song's name", async () => {
    const saved: { name: string; type: string }[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push({ name: "", type: blob.type });
      return "blob:x";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        const last = saved.at(-1);
        if (last) last.name = this.download;
      });
    await open();
    await setField("Fine", "4");
    await waitFor(() => expect(field("Fine")).toHaveValue("0:04.0"));
    await userEvent.click(screen.getByRole("button", { name: "Scarica WAV" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "Scarica MP3" }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved).toEqual([
      { name: "Lunedì - Editor audio.wav", type: "audio/wav" },
      { name: "Lunedì - Editor audio.mp3", type: "audio/mpeg" },
    ]);
    // The MP3 is made from the kept four seconds, at the file's own rate.
    const [channels, rate] = mock.encodeMp3.mock.calls[0] ?? [];
    expect(rate).toBe(RATE);
    expect(channels?.[0]).toHaveLength(400);
    click.mockRestore();
  });

  it("saves the edit as the song's new version after asking", async () => {
    await open();
    await userEvent.click(screen.getByText("Normalizza", { exact: true }));
    expect(screen.getByRole("switch", { name: /Normalizza/u })).toBeChecked();
    await userEvent.click(
      screen.getByRole("button", { name: "Salva come nuova versione" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "La modifica diventa l'audio della canzone",
    );
    await userEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() =>
      expect(mock.toast.success).toHaveBeenCalledWith(
        "Salvata come nuova versione",
      ),
    );
    const [, id, file] = mock.saveEdit.mock.calls[0] ?? [];
    expect(id).toBe("v1");
    expect(file).toBeInstanceOf(Blob);
    // The normalised MP3 peaks at -1 dB.
    const channels = mock.encodeMp3.mock.calls[0]?.[0] as Float32Array[];
    const peak = Math.max(...channels.flatMap((c) => Array.from(c, Math.abs)));
    expect(peak).toBeCloseTo(10 ** (-1 / 20));
    expect(mock.refresh).toHaveBeenCalled();
  }, 15_000);

  it("keeps the editor open and says so when saving fails", async () => {
    mock.saveEdit.mockResolvedValueOnce({ ok: false });
    await open();
    await setField("Inizio", "1");
    await userEvent.click(
      screen.getByRole("button", { name: "Salva come nuova versione" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Salva" }));
    await waitFor(() =>
      expect(mock.toast.error).toHaveBeenCalledWith(
        "Impossibile salvare la modifica",
      ),
    );
    expect(mock.back).not.toHaveBeenCalled();
    expect(mock.push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Salva come nuova versione" }),
    ).toBeEnabled();
  }, 15_000);
});
