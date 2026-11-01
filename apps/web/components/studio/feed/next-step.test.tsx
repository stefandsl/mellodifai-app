import type { TakeScores } from "@mellodifai/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import {
  NO_WORKER,
  type WorkerState,
  WorkerStateProvider,
} from "@/components/studio/worker-state";
import type { Clip } from "@/lib/studio/clips";
import { parseEngines } from "@/lib/studio/engines";
import frPack from "../../../../../packages/shared/test/fixtures/fr-pack.json" with {
  type: "json",
};
import { NextStep } from "./next-step";

const mock = vi.hoisted(() => ({
  approve: vi.fn(async () => ({ ok: true as const })),
  pick: vi.fn(async () => ({ ok: true as const })),
  keep: vi.fn(async () => ({ ok: true as const })),
  refresh: vi.fn(),
}));
vi.mock("@/app/actions/checkpoints", () => ({
  approveLyrics: mock.approve,
  pickTake: mock.pick,
  keepAudio: mock.keep,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "v1",
    projectId: "p1",
    lang: "fr",
    title: frPack.title,
    style: frPack.style,
    prompt: "",
    lyrics: frPack.lyrics,
    model: "V6",
    status: "lyrics_review",
    createdAt: "",
    updatedAt: "",
    audioUrl: null,
    videoUrl: null,
    hookUrl: null,
    href: "/projects/p1?lang=fr",
    art: "",
    settings: {},
    pack: frPack,
    hasCover: false,
    takes: [],
    chosenTakeId: null,
    jury: null,
    ...patch,
  };
}

beforeEach(() => {
  mock.approve.mockClear();
  mock.pick.mockClear();
  mock.keep.mockClear();
  mock.refresh.mockClear();
});

it("approves the drafted pack from the feed after showing lyrics and cost", async () => {
  render(<NextStep clip={clip()} />);
  await userEvent.click(screen.getByRole("button", { name: "Approva e crea" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("12 crediti");
  expect(
    screen.getByRole("link", { name: "Modifica il testo" }),
  ).toHaveAttribute("href", "/projects/p1?lang=fr");
  await userEvent.click(
    screen.getByRole("button", { name: "Approva · 12 crediti" }),
  );
  await waitFor(() =>
    expect(mock.approve).toHaveBeenCalledWith({
      versionId: "v1",
      pack: frPack,
    }),
  );
  expect(mock.refresh).toHaveBeenCalled();
});

it("does not spend credits on lyrics that would fail validation", async () => {
  render(
    <NextStep clip={clip({ pack: { ...frPack, lyrics: "[Verse]\nOne" } })} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Approva e crea" }));
  expect(
    screen.getByRole("button", { name: "Approva · 12 crediti" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("va sistemato");
});

it("links the other waiting steps to the song page", () => {
  const { rerender } = render(
    <NextStep clip={clip({ status: "takes_review" })} />,
  );
  expect(screen.getByRole("link", { name: /Scegli la take/u })).toHaveAttribute(
    "href",
    "/projects/p1?lang=fr",
  );
  rerender(<NextStep clip={clip({ status: "video_review" })} />);
  expect(screen.getByRole("link", { name: /Rivedi il video/u })).toBeVisible();
  rerender(<NextStep clip={clip({ status: "producing" })} />);
  expect(screen.queryByRole("link")).toBeNull();
});

it("suggests the video by default and audio only when the form turned video off", async () => {
  const takes = [
    { id: "t1", number: 1, audioUrl: "https://s/t1.mp3", scores: null },
    { id: "t2", number: 2, audioUrl: "https://s/t2.mp3", scores: null },
  ];
  const primary = () =>
    screen
      .getAllByRole("button")
      .find(
        (button) =>
          button.className.includes("bg-cta") &&
          button.closest("[role=dialog]"),
      );
  const { unmount } = render(
    <NextStep clip={clip({ status: "takes_review", takes })} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Scegli la take/u }),
  );
  expect(primary()).toHaveTextContent("Crea il video");
  unmount();
  render(
    <NextStep
      clip={clip({ status: "takes_review", takes, settings: { video: "off" } })}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Scegli la take/u }),
  );
  expect(primary()).toHaveTextContent("Tieni solo l'audio");
});

const scores = (patch: Partial<TakeScores> = {}): TakeScores => ({
  fidelity: 0.8,
  duration: 200,
  endDropDb: 30,
  weakSections: [],
  truncated: false,
  ...patch,
});
const scored = (first: TakeScores | null, second: TakeScores | null) => [
  { id: "t1", number: 1, audioUrl: "https://s/t1.mp3", scores: first },
  { id: "t2", number: 2, audioUrl: "https://s/t2.mp3", scores: second },
];
const openTakes = async (takes: Clip["takes"]) => {
  render(<NextStep clip={clip({ status: "takes_review", takes })} />);
  await userEvent.click(
    screen.getByRole("button", { name: /Scegli la take/u }),
  );
};

it("marks the suggested take with the share of words heard and preselects it", async () => {
  await openTakes(
    scored(scores({ fidelity: 0.72 }), scores({ fidelity: 0.91 })),
  );
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("radio", { name: /Take 2/u })).toBeChecked();
  expect(dialog.getByRole("radio", { name: /Take 1/u })).not.toBeChecked();
  expect(dialog.getAllByText("Consigliata")).toHaveLength(1);
  expect(dialog.getByText("parole riconosciute 91%")).toBeVisible();
  await userEvent.click(dialog.getByRole("button", { name: "Crea il video" }));
  await waitFor(() =>
    expect(mock.pick).toHaveBeenCalledWith({ versionId: "v1", takeId: "t2" }),
  );
});

it("explains a suggestion that comes from the ending, not from the words", async () => {
  await openTakes(
    scored(
      scores({ fidelity: 0.7, truncated: true }),
      scores({ fidelity: 0.7 }),
    ),
  );
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("radio", { name: /Take 2/u })).toBeChecked();
  expect(dialog.getByText("finale completo")).toBeVisible();
  expect(dialog.queryByText(/parole riconosciute/u)).toBeNull();
});

it("suggests nothing and keeps take 1 selected when the scores do not decide", async () => {
  await openTakes(
    scored(scores({ fidelity: 0.84 }), scores({ fidelity: 0.83 })),
  );
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.queryByText("Consigliata")).toBeNull();
  expect(dialog.getByRole("radio", { name: /Take 1/u })).toBeChecked();
});

it("shows no badge before scoring has landed", async () => {
  await openTakes(scored(null, null));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.queryByText("Consigliata")).toBeNull();
  expect(dialog.getByRole("radio", { name: /Take 1/u })).toBeChecked();
});

it("lets the owner pick the other take over the suggestion", async () => {
  await openTakes(
    scored(scores({ fidelity: 0.72 }), scores({ fidelity: 0.91 })),
  );
  const dialog = within(screen.getByRole("dialog"));
  await userEvent.click(dialog.getByRole("radio", { name: /Take 1/u }));
  await userEvent.click(dialog.getByRole("button", { name: "Crea il video" }));
  await waitFor(() =>
    expect(mock.pick).toHaveBeenCalledWith({ versionId: "v1", takeId: "t1" }),
  );
});

const engines = parseEngines({
  yue2: { installed: true, passedLangs: ["it"], minutesPerAudioMinute: 1.6 },
  "ace-step": {
    installed: true,
    passedLangs: ["it"],
    minutesPerAudioMinute: 0.8,
  },
});
const withWorker = (
  node: React.ReactNode,
  patch: Partial<WorkerState> = {},
) => (
  <WorkerStateProvider value={{ ...NO_WORKER, engines, ...patch }}>
    {node}
  </WorkerStateProvider>
);

it("shows a local song as free, with the PC minutes, in the approval window", async () => {
  render(
    withWorker(<NextStep clip={clip({ settings: { engine: "yue2" } })} />),
  );
  await userEvent.click(screen.getByRole("button", { name: "Approva e crea" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(
    dialog.getByText(
      "YuE2 genera due versioni della canzone. Gratis · circa 6 minuti sul PC.",
    ),
  ).toBeVisible();
  expect(dialog.queryByText(/crediti/u)).toBeNull();
  await userEvent.click(
    dialog.getByRole("button", { name: "Approva · gratis" }),
  );
  await waitFor(() =>
    expect(mock.approve).toHaveBeenCalledWith({
      versionId: "v1",
      pack: frPack,
    }),
  );
});

it("follows the chosen duration of an ACE-Step song", async () => {
  render(
    withWorker(
      <NextStep
        clip={clip({ settings: { engine: "ace-step", duration: 120 } })}
      />,
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Approva e crea" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "ACE-Step genera due versioni della canzone. Gratis · circa 2 minuti sul PC.",
  );
});

it("still says free when the worker has not reported the engine", async () => {
  render(
    withWorker(<NextStep clip={clip({ settings: { engine: "ace-step" } })} />, {
      engines: {},
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Approva e crea" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "ACE-Step genera due versioni della canzone. Gratis · sul PC.",
  );
  expect(
    screen.getByRole("button", { name: "Approva · gratis" }),
  ).toBeVisible();
});

it("says it in English too", async () => {
  render(
    <LocaleProvider value="en">
      <WorkerStateProvider value={{ ...NO_WORKER, engines }}>
        <NextStep clip={clip({ settings: { engine: "yue2" } })} />
      </WorkerStateProvider>
    </LocaleProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Approve and create" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "YuE2 generates two versions of the song. Free · about 6 minutes on the PC.",
  );
  expect(screen.getByRole("button", { name: "Approve · free" })).toBeVisible();
});

it("keeps the kie wording for a kie song whatever the worker reports", async () => {
  render(withWorker(<NextStep clip={clip({ settings: { engine: "kie" } })} />));
  await userEvent.click(screen.getByRole("button", { name: "Approva e crea" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "kie genera due versioni della canzone: 12 crediti.",
  );
});
