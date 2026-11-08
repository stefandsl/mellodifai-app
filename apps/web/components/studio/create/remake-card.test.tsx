import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import {
  NO_WORKER,
  WorkerStateProvider,
} from "@/components/studio/worker-state";
import { initialForm, useCreateForm } from "@/store/create-form";
import FIXTURE from "../../../../../packages/remake/test/fixtures/remake-lyrics.it.json";
import { RemakeCard } from "./remake-card";

// The create panel's "Rifai da YouTube" card (task 27) against a mocked my_remake and the
// remake actions; the lyrics are the fixture the e2e worker uses.
const LYRICS = structuredClone(FIXTURE);
const SUMMARY = {
  title: "The Sixsters - Alone (Official Music Video)",
  durationS: 157,
  bpm: 78.95,
  key: { tonic: "D", mode: "minor" },
  beatsPerBar: 4,
  sourceLanguage: "en",
  vocal: { type: "female", delivery: "sung" },
  genre: ["rock"],
  mood: ["defiant"],
  summary: "",
  styleTags: ["rock", "79 bpm"],
  sections: [
    {
      id: "verse-1",
      label: "Verse 1",
      kind: "verse",
      start: 18.2,
      end: 42.2,
      lines: 5,
    },
  ],
  costUsd: 0.0098,
};

const mock = vi.hoisted(() => ({
  row: null as unknown,
  rpc: vi.fn(),
  start: vi.fn(async () => ({ ok: true as const, id: "r1" })),
  edit: vi.fn(async () => ({ ok: true as const, revision: 2 })),
  accept: vi.fn(async (_input: Record<string, unknown>) => ({
    ok: true as const,
    id: "v1",
  })),
  section: vi.fn(async () => ({ ok: true as const })),
  dismiss: vi.fn(async () => ({ ok: true as const })),
  retry: vi.fn(async () => ({ ok: true as const })),
  cancel: vi.fn(async () => ({ ok: true as const })),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/app/actions/remake", () => ({
  readRemake: async () => {
    mock.rpc("my_remake");
    return { ok: true, data: mock.row };
  },
  startRemake: mock.start,
  editRemake: mock.edit,
  acceptRemake: mock.accept,
  regenerateRemakeSection: mock.section,
  dismissRemake: mock.dismiss,
  retryRemake: mock.retry,
  cancelRemake: mock.cancel,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: mock.toast }));

function remake(patch: Record<string, unknown> = {}, job: unknown = null) {
  return {
    remake: {
      id: "11111111-1111-4111-8111-111111111111",
      project_id: "p1",
      version_id: "v1",
      url: "https://youtu.be/49rDdMbXd_w",
      video_id: "49rDdMbXd_w",
      lang: "it",
      country: null,
      stage: "review",
      error_code: null,
      error: null,
      source: { title: "The Sixsters - Alone (Official Music Video)" },
      analysis: SUMMARY,
      lyrics: LYRICS,
      pending: null,
      revision: 3,
      cost: { analysisUsd: 0.0098, rewriteUsd: 0.0312 },
      ...patch,
    },
    job,
    failedJob: null,
  };
}

function card() {
  return render(
    <LocaleProvider value="it">
      <WorkerStateProvider value={{ ...NO_WORKER, isAdmin: true }}>
        <RemakeCard />
      </WorkerStateProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useCreateForm.setState(initialForm("it"));
  mock.row = null;
});

describe("RemakeCard", () => {
  it("checks the link before starting and starts with the language and country", async () => {
    const user = userEvent.setup();
    card();
    const link = await screen.findByLabelText("Link YouTube");
    await user.click(link);
    await user.paste("https://vimeo.com/123");
    await user.click(screen.getByRole("button", { name: "Analizza" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Non è un link a un video di YouTube.",
    );
    expect(mock.start).not.toHaveBeenCalled();
    await user.clear(link);
    await user.paste("https://youtu.be/49rDdMbXd_w");
    await user.selectOptions(screen.getByLabelText("Lingua del testo"), "en");
    await user.selectOptions(screen.getByLabelText("Paese"), "IE");
    await user.click(screen.getByRole("button", { name: "Analizza" }));
    expect(mock.start).toHaveBeenCalledWith({
      url: "https://youtu.be/49rDdMbXd_w",
      lang: "en",
      country: "IE",
    });
  });

  it("shows the running step, its progress and a cancel", async () => {
    mock.row = remake(
      { stage: "analyse", analysis: null, lyrics: null },
      {
        id: "j1",
        stage: "remake_analyse",
        status: "running",
        mode: null,
        section: null,
        progress: 45,
        message: "analyse.beats",
        queuePosition: 0,
      },
    );
    card();
    expect(await screen.findByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "45",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Trovo battiti e misure",
    );
    await userEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(mock.cancel).toHaveBeenCalled();
  });

  it("explains the privacy filter and links to the OpenRouter setting", async () => {
    mock.row = remake({
      stage: "failed",
      error_code: "privacy_filter",
      lyrics: null,
    });
    card();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Disattivalo in OpenRouter (Settings, Privacy)",
    );
    expect(within(alert).getByRole("link")).toHaveAttribute(
      "href",
      "https://openrouter.ai/settings/privacy",
    );
    expect(screen.getByRole("button", { name: "Riprova" })).toBeVisible();
  });

  it("offers no retry for a private video", async () => {
    mock.row = remake({ stage: "failed", error_code: "private", lyrics: null });
    card();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Il video è privato",
    );
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
  });

  it("reviews: summary, jury, a blocked accept, a line edit and a section rewrite", async () => {
    mock.row = remake();
    card();
    expect(
      await screen.findByRole("textbox", { name: "Titolo nuovo" }),
    ).toHaveValue("Mille volti");
    expect(screen.getByText("79")).toBeVisible();
    expect(screen.getByText("D minore")).toBeVisible();
    expect(screen.getByRole("region", { name: "Giuria" })).toHaveTextContent(
      "La giuria chiede modifiche",
    );
    expect(
      screen.getByText("Righe da riscrivere prima di continuare: 1"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Accetta e genera" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: /^Modifica la riga 9:/u }),
    );
    const input = screen.getByRole("textbox", { name: "Modifica la riga 9" });
    await userEvent.clear(input);
    await userEvent.type(input, "il mondo corre{Enter}");
    expect(mock.edit).toHaveBeenCalledWith({
      remakeId: "11111111-1111-4111-8111-111111111111",
      revision: 3,
      lines: [{ index: 8, text: "il mondo corre" }],
      title: null,
    });
    const regenerate = screen.getByRole("button", {
      name: "Rigenera la sezione Bridge",
    });
    await waitFor(() => expect(regenerate).toBeEnabled());
    await userEvent.click(regenerate);
    expect(mock.section).toHaveBeenCalledWith({
      remakeId: "11111111-1111-4111-8111-111111111111",
      revision: 3,
      section: "bridge-1",
    });
  });

  it("accepts clean lyrics with the panel's settings and the source's tempo and key", async () => {
    const clean = structuredClone(LYRICS);
    for (const section of clean.sections)
      for (const line of section.lines) line.originality.flagged = false;
    clean.originality.phrase = { ok: true, longestRun: 1, detail: "" };
    mock.row = remake({ lyrics: clean });
    card();
    const accept = await screen.findByRole("button", {
      name: "Accetta e genera",
    });
    await waitFor(() => expect(accept).toBeEnabled());
    await userEvent.click(accept);
    expect(mock.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        remakeId: "11111111-1111-4111-8111-111111111111",
        revision: 3,
        title: "Mille volti",
        style: LYRICS.styleTags.join(", "),
        vocalGender: "f",
        settings: expect.objectContaining({
          engine: "kie",
          bpm: 79,
          keyscale: "D minor",
          timeSignature: "4",
        }),
      }),
    );
    expect(mock.accept.mock.calls[0]?.[0]).not.toHaveProperty(
      "settings.source",
    );
  });
});
