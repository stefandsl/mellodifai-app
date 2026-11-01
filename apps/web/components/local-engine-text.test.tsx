import type { LyricPack } from "@mellodifai/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  generateAgain: vi.fn(async () => ({ ok: true })),
  retryStage: vi.fn(async () => ({ ok: true })),
  backToLyrics: vi.fn(async () => ({ ok: true })),
  pickTake: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/checkpoints", () => ({ ...actions }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  NO_WORKER,
  type WorkerState,
  WorkerStateProvider,
} from "@/components/studio/worker-state";
import { parseEngines } from "@/lib/studio/engines";
import frPack from "../../../packages/shared/test/fixtures/fr-pack.json" with {
  type: "json",
};
import { LocaleProvider } from "./locale-provider";
import { LyricEditor } from "./lyric-editor";
import { ProjectWorkspace } from "./project-workspace";
import { TakePicker } from "./take-picker";

const ENGINES = parseEngines({
  yue2: { installed: true, passedLangs: ["it"], minutesPerAudioMinute: 1.6 },
  "ace-step": {
    installed: true,
    passedLangs: ["it"],
    minutesPerAudioMinute: 0.8,
  },
});

function wrap(
  node: React.ReactNode,
  lang: "it" | "en" = "it",
  worker: Partial<WorkerState> = {},
) {
  return (
    <LocaleProvider value={lang}>
      <WorkerStateProvider
        value={{ ...NO_WORKER, engines: ENGINES, ...worker }}
      >
        {node}
      </WorkerStateProvider>
    </LocaleProvider>
  );
}

function failedGeneration(settings?: Record<string, unknown>) {
  return (
    <ProjectWorkspace
      version={{
        id: "v",
        status: "failed",
        lang: "it",
        lyric_pack: null,
        generation_count: 1,
        render_attempt: 1,
      }}
      takes={[]}
      renders={[]}
      publication={null}
      failedJob={{ id: "j", stage: "generate_song", error: "motore" }}
      isAdmin
      settings={settings}
    />
  );
}

beforeEach(() => vi.clearAllMocks());

it("offers a free regeneration after a local song failed", async () => {
  render(wrap(failedGeneration({ engine: "yue2" })));
  expect(
    screen.queryByRole("button", { name: /12 crediti/u }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Genera di nuovo (gratis)" }),
  );
  expect(
    await screen.findByText(
      "Gratis: il PC genera due versioni della canzone in circa 6 minuti.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
  await waitFor(() =>
    expect(actions.generateAgain).toHaveBeenCalledWith({
      versionId: "v",
      generation: 1,
    }),
  );
});

it("keeps the 12 credits wording for a kie song and when the settings are unknown", () => {
  const view = render(wrap(failedGeneration({ engine: "kie" })));
  expect(
    screen.getByRole("button", { name: "Genera di nuovo (12 crediti)" }),
  ).toBeInTheDocument();
  view.unmount();
  render(wrap(failedGeneration()));
  expect(
    screen.getByRole("button", { name: "Genera di nuovo (12 crediti)" }),
  ).toBeInTheDocument();
});

it("says it in English", async () => {
  render(wrap(failedGeneration({ engine: "ace-step" }), "en"));
  fireEvent.click(
    screen.getByRole("button", { name: "Generate again (free)" }),
  );
  expect(
    await screen.findByText(
      "Free: the PC generates two versions of the song in about 3 minutes.",
    ),
  ).toBeVisible();
});

it("does not promise minutes the worker never reported", async () => {
  render(wrap(failedGeneration({ engine: "ace-step" }), "it", { engines: {} }));
  fireEvent.click(
    screen.getByRole("button", { name: "Genera di nuovo (gratis)" }),
  );
  expect(
    await screen.findByText("Gratis: il PC genera due versioni della canzone."),
  ).toBeVisible();
});

it("approves a local song's lyrics as free from the song page", async () => {
  const approve = vi.fn(async () => ({ ok: true as const }));
  render(
    wrap(
      <LyricEditor
        pack={frPack as unknown as LyricPack}
        theme="vbp"
        onApprove={approve}
        local={{ engine: "yue2", minutes: 6 }}
      />,
    ),
  );
  expect(
    screen.queryByRole("button", { name: /12 crediti/u }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Approva e genera la canzone: gratis" }),
  );
  expect(
    await screen.findByText(
      "Gratis: il PC genera due versioni della canzone in circa 6 minuti.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
  await waitFor(() => expect(approve).toHaveBeenCalled());
});

it("regenerates takes of a local song as free from the take picker", async () => {
  const again = vi.fn(async () => ({ ok: true as const }));
  render(
    wrap(
      <TakePicker
        takes={[]}
        onPick={vi.fn()}
        onGenerateAgain={again}
        local={{ engine: "ace-step", minutes: 3 }}
      />,
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Genera di nuovo (gratis)" }),
  );
  expect(
    await screen.findByText(
      "Gratis: il PC genera due versioni della canzone in circa 3 minuti.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
  await waitFor(() => expect(again).toHaveBeenCalled());
});
