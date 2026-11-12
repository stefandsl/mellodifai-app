import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import type { RewriteData, SectionEditView } from "@/lib/studio/rewrite";
import { RewritePanel } from "./rewrite-panel";

const mock = vi.hoisted(() => ({
  request: vi.fn(async (_input: unknown) => ({ ok: true, id: "e1" })),
  keep: vi.fn(async (_input: unknown) => ({ ok: true, id: "t3" })),
  discard: vi.fn(async (_input: unknown) => ({ ok: true })),
  loadOpenEdit: vi.fn(async (): Promise<SectionEditView | null> => null),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  worker: {
    isAdmin: true,
    engines: {
      "ace-step": {
        installed: true,
        passedLangs: ["it"],
        minutesPerAudioMinute: 0.8,
        features: ["rewrite", "cover"],
      },
    } as Record<string, unknown>,
    lastSeen: new Date().toISOString(),
    now: Date.now(),
    balance: 74 as number | null,
  },
}));
vi.mock("@/app/actions/songs-from-songs", () => ({
  requestSectionEdit: mock.request,
  keepSectionEdit: mock.keep,
  discardSectionEdit: mock.discard,
}));
vi.mock("@/lib/studio/rewrite", async (original) => ({
  ...(await original<typeof import("@/lib/studio/rewrite")>()),
  loadOpenEdit: mock.loadOpenEdit,
}));
vi.mock("@/lib/studio/use-job-progress", () => ({
  useJobEvents: () => [],
  latestProgress: () => null,
}));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({}) }));
vi.mock("../worker-state", () => ({ useWorkerState: () => mock.worker }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh, push: vi.fn(), back: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

// A 60 s take.
class FakeContext {
  decodeAudioData = vi.fn(async () => ({
    duration: 60,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(600).fill(0.3),
  }));
  close = vi.fn(async () => {});
}

const LYRICS = [
  "[Verse]",
  "Sono le nove, ho già l'aria stanca",
  "la prima mail e la voglia mi manca",
  "[Chorus]",
  "Solo un caffè, poi si va",
].join("\n");
const TIMING = {
  source: "whisper" as const,
  lines: [
    { text: "Sono le nove, ho già l'aria stanca", start: 5, end: 9 },
    { text: "la prima mail e la voglia mi manca", start: 9, end: 13 },
    { text: "Solo un caffè, poi si va", start: 40, end: 45 },
  ],
};

const clip = {
  id: "v1",
  title: "Solo un caffè",
  lang: "it",
  status: "audio_ready",
  trashedAt: null,
  chosenTakeId: "t1",
  lyrics: LYRICS,
  takes: [{ id: "t1", number: 1, audioUrl: "/media/t1.mp3", scores: null }],
} as unknown as Clip;

function data(edit: SectionEditView | null = null): RewriteData {
  return {
    takes: [
      {
        id: "t1",
        number: 1,
        audioUrl: "/media/t1.mp3",
        lyrics: LYRICS,
        timing: TIMING,
        kieDirect: true,
        rewritten: false,
      },
    ],
    edit,
    balance: 74,
  };
}

async function open(edit: SectionEditView | null = null) {
  render(
    <LocaleProvider value="it">
      <RewritePanel clip={clip} data={data(edit)} />
    </LocaleProvider>,
  );
  await screen.findByRole("img", { name: /Forma d'onda/u });
}
const field = (name: string) => screen.getByLabelText(name, { exact: true });
async function setField(name: string, text: string) {
  await userEvent.clear(field(name));
  await userEvent.type(field(name), `${text}{Enter}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.worker.balance = 74;
  mock.worker.isAdmin = true;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1]))),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  HTMLElement.prototype.scrollTo = vi.fn();
});

describe("Riscrivi una parte", () => {
  it("starts on the first sung line, lights the lines of the part and puts them in the box", async () => {
    await open();
    expect(field("Da")).toHaveValue("0:04.5");
    expect(field("A")).toHaveValue("0:19.5");
    expect(
      screen.getByText(
        "Da 10 a 30 secondi, al massimo metà del brano (qui 30 s).",
      ),
    ).toBeInTheDocument();
    const lit = screen
      .getAllByRole("button", { pressed: true })
      .map((button) => button.textContent);
    expect(lit).toEqual([
      "Sono le nove, ho già l'aria stanca",
      "la prima mail e la voglia mi manca",
    ]);
    await waitFor(() =>
      expect(field("Testo della parte")).toHaveValue(
        "Sono le nove, ho già l'aria stanca\nla prima mail e la voglia mi manca",
      ),
    );
  });

  it("keeps Suno's limits on the part", async () => {
    await open();
    await setField("A", "0:12");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La parte è troppo corta: servono almeno 10 secondi.",
    );
    expect(
      screen.getByRole("button", { name: "Ricrea la parte" }),
    ).toBeDisabled();
    await setField("A", "0:40");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La parte è troppo lunga: al massimo 30 secondi.",
    );
    await setField("A", "0:30");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows kie's cost and balance before anything is spent, and stops on a low balance", async () => {
    await open();
    await userEvent.click(screen.getByRole("radio", { name: /Suno \(kie\)/u }));
    await userEvent.click(
      screen.getByRole("button", { name: "Ricrea la parte" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "kie rifà la parte da 0:04.5 a 0:19.5 con il nuovo testo: costa 5 crediti kie.",
    );
    expect(dialog).toHaveTextContent("Saldo attuale: 74 crediti.");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Annulla" }),
    );
    expect(mock.request).not.toHaveBeenCalled();
    mock.worker.balance = 3;
    await userEvent.click(
      screen.getByRole("button", { name: "Ricrea la parte" }),
    );
    const low = await screen.findByRole("dialog");
    expect(low).toHaveTextContent(
      "Il saldo kie (3 crediti) non basta: servono 5 crediti.",
    );
    expect(
      within(low).getByRole("button", { name: "Ricrea la parte" }),
    ).toBeDisabled();
  });

  it("asks ACE-Step for the part with the new lyrics in place of the old lines", async () => {
    await open();
    await userEvent.click(screen.getByRole("radio", { name: /ACE-Step/u }));
    await userEvent.clear(field("Testo della parte"));
    await userEvent.type(
      field("Testo della parte"),
      "Sono le otto{Enter}e ho sonno",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Ricrea la parte" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("sul PC, gratis");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Ricrea la parte" }),
    );
    await waitFor(() => expect(mock.request).toHaveBeenCalled());
    expect(mock.request.mock.calls[0]?.[0]).toEqual({
      versionId: "v1",
      takeId: "t1",
      engine: "ace-step",
      start: 4.5,
      end: 19.5,
      duration: 60,
      lines: [1, 2],
      section: "Sono le otto\ne ho sonno",
      full: "[Verse]\nSono le otto\ne ho sonno\n[Chorus]\nSolo un caffè, poi si va",
    });
    expect(mock.loadOpenEdit).toHaveBeenCalled();
  });

  it("offers no local engine to a customer", async () => {
    mock.worker.isAdmin = false;
    await open();
    expect(screen.queryByRole("radio", { name: /ACE-Step/u })).toBeNull();
  });

  it("lists the alternatives and keeps the chosen one as a new version", async () => {
    await open({
      id: "e1",
      takeId: "t1",
      engine: "ace-step",
      start: 4.5,
      end: 19.5,
      lines: [1, 2],
      sectionLyrics: "Sono le otto",
      fullLyrics: LYRICS,
      alternatives: [
        { url: "/media/a1.mp3", duration: 60 },
        { url: "/media/a2.mp3", duration: 60 },
      ],
      createdAt: "2026-11-01T10:00:00Z",
      job: { id: "j1", status: "done", error: null, startedAt: null },
      queuePosition: null,
    });
    const list = screen.getByRole("region", { name: "Alternative" });
    expect(
      within(list).getByRole("button", { name: "Ascolta Originale nel brano" }),
    ).toBeInTheDocument();
    const keeps = within(list).getAllByRole("button", { name: "Tieni questa" });
    expect(keeps).toHaveLength(2);
    await userEvent.click(keeps[1] as HTMLElement);
    expect(mock.keep).toHaveBeenCalledWith({ editId: "e1", alternative: 1 });
    expect(mock.toast.success).toHaveBeenCalledWith(
      "Nuova versione salvata: l'originale resta tra le versioni.",
    );
    expect(mock.refresh).toHaveBeenCalled();
  });
});
