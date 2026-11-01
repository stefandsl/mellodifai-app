import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import {
  NO_WORKER,
  type WorkerState,
  WorkerStateProvider,
} from "@/components/studio/worker-state";
import { parseEngines } from "@/lib/studio/engines";
import { initialForm, useCreateForm } from "@/store/create-form";
import { CreatePanel } from "./create-panel";

const mock = vi.hoisted(() => ({
  create: vi.fn(async () => ({ ok: true as const, data: { projectId: "p" } })),
  refresh: vi.fn(),
}));
vi.mock("@/app/actions/create-song", () => ({ createSong: mock.create }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ENGINES = parseEngines({
  yue2: { installed: true, passedLangs: ["it"], minutesPerAudioMinute: 1.6 },
  "ace-step": {
    installed: true,
    passedLangs: ["it"],
    minutesPerAudioMinute: 0.8,
  },
});

function worker(patch: Partial<WorkerState> = {}): WorkerState {
  return {
    ...NO_WORKER,
    id: "w",
    lastSeen: new Date(NOW - 10_000).toISOString(),
    online: true,
    engines: ENGINES,
    isAdmin: true,
    now: NOW,
    ...patch,
  };
}

function panel(state: WorkerState, lang: "it" | "en" = "it") {
  return (
    <LocaleProvider value={lang}>
      <WorkerStateProvider value={state}>
        <CreatePanel />
      </WorkerStateProvider>
    </LocaleProvider>
  );
}

async function chooseEngine(name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: /^Motore:/u }));
  await userEvent.click(await screen.findByRole("menuitem", { name }));
}

beforeEach(() => {
  mock.create.mockClear();
  localStorage.clear();
  useCreateForm.setState({
    ...initialForm("it"),
    open: {
      lyrics: true,
      styles: true,
      video: true,
      music: true,
      more: true,
      audio: true,
    },
  });
});

describe("engine selector", () => {
  it("is not there for anyone but the admin", () => {
    render(panel(worker({ isAdmin: false })));
    expect(
      screen.queryByRole("button", { name: /^Motore:/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Modello: v6" }),
    ).toBeInTheDocument();
  });

  it("lists kie and each local engine that qualifies", async () => {
    render(panel(worker()));
    await userEvent.click(
      screen.getByRole("button", { name: "Motore: Suno (kie)" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /Suno \(kie\)/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /ACE-Step · locale/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /YuE2 · locale/u }),
    ).toBeInTheDocument();
  });

  it("leaves out an engine that is not installed or has not passed the language", async () => {
    useCreateForm.setState({ languages: ["it", "en"] });
    render(
      panel(
        worker({
          engines: parseEngines({
            yue2: {
              installed: false,
              passedLangs: ["it"],
              minutesPerAudioMinute: 1.6,
            },
            "ace-step": {
              installed: true,
              passedLangs: ["it"],
              minutesPerAudioMinute: 0.8,
            },
          }),
        }),
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Motore: Suno (kie)" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /Suno \(kie\)/u }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(1);
  });

  it("sends the chosen engine to createSong", async () => {
    render(panel(worker()));
    await userEvent.type(
      screen.getByLabelText("Descrivi la canzone"),
      "una canzone sul lunedì",
    );
    await chooseEngine(/ACE-Step · locale/u);
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
    const [input] = mock.create.mock.calls[0] as unknown as [
      { settings: Record<string, unknown> },
    ];
    expect(input.settings).toMatchObject({
      engine: "ace-step",
      duration: null,
      video: "lyric",
    });
    expect(input.settings).not.toHaveProperty("model");
    expect(input.settings).not.toHaveProperty("weirdness");
  });

  it("still sends kie by default", async () => {
    render(panel(worker({ isAdmin: false })));
    await userEvent.type(
      screen.getByLabelText("Descrivi la canzone"),
      "una canzone sul lunedì",
    );
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
    const [input] = mock.create.mock.calls[0] as unknown as [
      { settings: Record<string, unknown> },
    ];
    expect(input.settings).toMatchObject({ engine: "kie", model: "V6" });
  });
});

describe("controls per engine", () => {
  it("shows every control for kie", () => {
    useCreateForm.setState({ mode: "advanced" });
    render(panel(worker()));
    expect(
      screen.getByRole("button", { name: "Modello: v6" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Escludi stili")).toBeInTheDocument();
    expect(screen.getByText("Stranezza")).toBeInTheDocument();
    expect(screen.getByText("Influenza dello stile")).toBeInTheDocument();
    expect(screen.getByText("Varietà")).toBeInTheDocument();
    expect(screen.getByText("Durata")).toBeInTheDocument();
  });

  it("hides model, weirdness, style influence, variety and exclude for ACE-Step but keeps duration", async () => {
    useCreateForm.setState({ mode: "advanced" });
    render(panel(worker()));
    await chooseEngine(/ACE-Step · locale/u);
    expect(
      screen.queryByRole("button", { name: /^Modello:/u }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Escludi stili")).not.toBeInTheDocument();
    expect(screen.queryByText("Stranezza")).not.toBeInTheDocument();
    expect(screen.queryByText("Influenza dello stile")).not.toBeInTheDocument();
    expect(screen.queryByText("Varietà")).not.toBeInTheDocument();
    expect(screen.getByText("Durata")).toBeInTheDocument();
    // What stays: language, vocal gender, styles, lyrics, video.
    expect(screen.getByText("Voce")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Stili" })).toBeInTheDocument();
  });

  it("hides duration as well for YuE2", async () => {
    useCreateForm.setState({ mode: "advanced" });
    render(panel(worker()));
    await chooseEngine(/YuE2 · locale/u);
    expect(screen.queryByText("Durata")).not.toBeInTheDocument();
    expect(screen.queryByText("Stranezza")).not.toBeInTheDocument();
    expect(screen.getByText("Voce")).toBeInTheDocument();
  });

  it("brings the controls back on kie", async () => {
    useCreateForm.setState({ mode: "advanced", engine: "yue2" });
    render(panel(worker()));
    expect(screen.queryByText("Stranezza")).not.toBeInTheDocument();
    await chooseEngine(/Suno \(kie\)/u);
    expect(screen.getByText("Stranezza")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Modello: v6" }),
    ).toBeInTheDocument();
  });
});

describe("cost under the Create button", () => {
  it("keeps the kie wording for kie", () => {
    render(panel(worker()));
    expect(
      screen.getByText(
        "Ogni canzone usa 12 crediti kie quando approvi il testo",
      ),
    ).toBeInTheDocument();
  });

  it("says Free and the PC minutes for a local song (3.5 min unless a duration is set)", async () => {
    render(panel(worker()));
    await chooseEngine(/YuE2 · locale/u);
    expect(screen.getByText("Gratis · circa 6 minuti sul PC")).toBeVisible();
    await chooseEngine(/ACE-Step · locale/u);
    expect(screen.getByText("Gratis · circa 3 minuti sul PC")).toBeVisible();
    expect(screen.queryByText(/crediti kie/u)).not.toBeInTheDocument();
  });

  it("follows the chosen duration for ACE-Step", async () => {
    useCreateForm.setState({
      mode: "advanced",
      durationMode: "custom",
      duration: 60,
    });
    render(panel(worker()));
    await chooseEngine(/ACE-Step · locale/u);
    expect(screen.getByText("Gratis · circa 1 minuto sul PC")).toBeVisible();
  });

  it("is English in the English interface", async () => {
    render(panel(worker(), "en"));
    await userEvent.click(screen.getByRole("button", { name: /^Engine:/u }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /YuE2 · local/u }),
    );
    expect(screen.getByText("Free · about 6 minutes on the PC")).toBeVisible();
  });
});

describe("when the engine stops qualifying", () => {
  it("falls back to kie and says why when the PC goes offline", async () => {
    useCreateForm.setState({ engine: "ace-step" });
    const { rerender } = render(panel(worker()));
    expect(
      screen.getByRole("button", { name: "Motore: ACE-Step · locale" }),
    ).toBeInTheDocument();
    rerender(
      panel(
        worker({
          lastSeen: new Date(NOW - 90_000).toISOString(),
          now: NOW + 5_000,
        }),
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Motore: Suno (kie)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "ACE-Step · locale non disponibile (PC offline): uso Suno (kie).",
    );
    expect(useCreateForm.getState().engine).toBe("kie");
    expect(
      screen.getByRole("button", { name: "Modello: v6" }),
    ).toBeInTheDocument();
  });

  it("falls back when a language the engine has not passed is added", async () => {
    useCreateForm.setState({ engine: "yue2" });
    render(panel(worker()));
    act(() => useCreateForm.setState({ languages: ["it", "en"] }));
    expect(
      await screen.findByRole("button", { name: "Motore: Suno (kie)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "YuE2 · locale non disponibile (lingue non coperte): uso Suno (kie).",
    );
  });

  it("sends kie, not the stale choice, for a user who is not the admin", async () => {
    useCreateForm.setState({ engine: "yue2" });
    render(panel(worker({ isAdmin: false })));
    await userEvent.type(
      screen.getByLabelText("Descrivi la canzone"),
      "una canzone sul lunedì",
    );
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
    const [input] = mock.create.mock.calls[0] as unknown as [
      { settings: Record<string, unknown> },
    ];
    expect(input.settings).toMatchObject({ engine: "kie" });
    expect(useCreateForm.getState().engine).toBe("kie");
    // No explanation for someone who never saw the engines.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears the line when the admin chooses an engine again", async () => {
    useCreateForm.setState({ engine: "ace-step" });
    const { rerender } = render(panel(worker()));
    rerender(panel(worker({ lastSeen: null })));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    rerender(panel(worker({ now: NOW + 1_000 })));
    await chooseEngine(/YuE2 · locale/u);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
