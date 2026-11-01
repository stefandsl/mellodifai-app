import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import {
  NO_WORKER,
  type WorkerState,
  WorkerStateProvider,
} from "@/components/studio/worker-state";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parseEngines } from "@/lib/studio/engines";
import { initialForm, useCreateForm } from "@/store/create-form";
import { CreatePanel } from "./create-panel";

const mock = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  });
  return {
    create: vi.fn(async (input: { count?: number }) => ({
      ok: true as const,
      id: "p",
      count: input.count ?? 1,
    })),
    format: vi.fn(),
    refresh: vi.fn(),
    toast,
  };
});
vi.mock("@/app/actions/create-song", () => ({ createSong: mock.create }));
vi.mock("@/app/actions/format-style", () => ({ formatStyle: mock.format }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ENGINES = parseEngines({
  yue2: {
    installed: true,
    passedLangs: ["it", "en"],
    minutesPerAudioMinute: 1.6,
  },
  "ace-step": {
    installed: true,
    passedLangs: ["it", "en"],
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

function panel(state: WorkerState = worker(), lang: "it" | "en" = "it") {
  return (
    <LocaleProvider value={lang}>
      <TooltipProvider>
        <WorkerStateProvider value={state}>
          <CreatePanel />
        </WorkerStateProvider>
      </TooltipProvider>
    </LocaleProvider>
  );
}

function setForm(patch: Partial<ReturnType<typeof useCreateForm.getState>>) {
  act(() => useCreateForm.setState(patch));
}

async function sent() {
  await waitFor(() => expect(mock.create).toHaveBeenCalled());
  return mock.create.mock.calls.at(-1)?.[0] as unknown as {
    count: number;
    settings: Record<string, unknown>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useCreateForm.setState({
    ...initialForm("it"),
    mode: "advanced",
    styles: "pop",
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

describe("music parameters", () => {
  it("start on Auto and send nothing", async () => {
    render(panel());
    expect(
      screen.getByRole("button", { name: "Tempo (BPM): Auto" }),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Tonalità" })).toHaveValue(
      "auto",
    );
    expect(
      within(screen.getByRole("radiogroup", { name: "Metrica" })).getByRole(
        "radio",
        { name: "Auto", checked: true },
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    const input = await sent();
    for (const key of ["bpm", "keyscale", "timeSignature"])
      expect(input.settings).not.toHaveProperty(key);
  });

  it("send the tempo typed into the slider's value", async () => {
    render(panel());
    await userEvent.click(
      screen.getByRole("button", { name: "Tempo (BPM): Auto" }),
    );
    const field = screen.getByRole("textbox", { name: "Tempo (BPM)" });
    await userEvent.clear(field);
    await userEvent.type(field, "96{Enter}");
    expect(
      screen.getByRole("button", { name: "Tempo (BPM): 96" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    expect((await sent()).settings).toMatchObject({ bpm: 96 });
  });

  it("send the chosen key and time signature", async () => {
    render(panel());
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Tonalità" }),
      "D minor",
    );
    await userEvent.click(screen.getByRole("radio", { name: "3/4" }));
    expect(useCreateForm.getState()).toMatchObject({
      keyscale: "D minor",
      timeSignature: "3",
    });
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    expect((await sent()).settings).toMatchObject({
      keyscale: "D minor",
      timeSignature: "3",
    });
  });

  it("name the key in Italian or English", () => {
    const { unmount } = render(panel());
    expect(
      screen.getByRole("option", { name: "Eb maggiore" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "A minore" }),
    ).toBeInTheDocument();
    unmount();
    render(panel(worker(), "en"));
    expect(
      screen.getByRole("option", { name: "Eb major" }),
    ).toBeInTheDocument();
  });

  it("go back to Auto with the reset button", async () => {
    setForm({ bpm: 120, keyscale: "C major", timeSignature: "6" });
    render(panel());
    await userEvent.click(
      screen.getByRole("button", { name: "Riporta tutto su Auto" }),
    );
    expect(useCreateForm.getState()).toMatchObject({
      bpm: 40,
      keyscale: "auto",
      timeSignature: "auto",
    });
  });

  it("are there for every engine", async () => {
    render(panel());
    for (const name of [/ACE-Step/u, /YuE2/u, /Suno/u]) {
      await userEvent.click(screen.getByRole("button", { name: /^Motore:/u }));
      await userEvent.click(await screen.findByRole("menuitem", { name }));
      expect(screen.getByRole("combobox", { name: "Tonalità" })).toBeVisible();
    }
  });
});

describe("seed", () => {
  async function choose(name: RegExp) {
    await userEvent.click(screen.getByRole("button", { name: /^Motore:/u }));
    await userEvent.click(await screen.findByRole("menuitem", { name }));
  }

  it("is for local engines only", async () => {
    render(panel());
    expect(screen.queryByText("Seme")).not.toBeInTheDocument();
    await choose(/ACE-Step/u);
    expect(screen.getByText("Seme")).toBeVisible();
    await choose(/YuE2/u);
    expect(screen.getByText("Seme")).toBeVisible();
    await choose(/Suno/u);
    expect(screen.queryByText("Seme")).not.toBeInTheDocument();
  });

  it("is random by default and sends nothing", async () => {
    setForm({ engine: "ace-step" });
    render(panel());
    expect(
      screen.queryByRole("textbox", { name: "Valore del seme" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    expect((await sent()).settings).not.toHaveProperty("seed");
  });

  it("can be fixed to a typed number, which is sent", async () => {
    setForm({ engine: "ace-step" });
    render(panel());
    await userEvent.click(screen.getByRole("radio", { name: "Fisso" }));
    const field = screen.getByRole("textbox", { name: "Valore del seme" });
    // Fixing the seed starts from a real number.
    expect(Number((field as HTMLInputElement).value)).toBeGreaterThan(0);
    await userEvent.clear(field);
    await userEvent.type(field, "4242");
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    expect((await sent()).settings).toMatchObject({ seed: 4242 });
  });

  it("keeps digits only and stays below the ceiling", async () => {
    setForm({ engine: "yue2", seedMode: "fixed", seed: 5 });
    render(panel());
    const field = screen.getByRole("textbox", { name: "Valore del seme" });
    await userEvent.clear(field);
    await userEvent.type(field, "12ab3");
    expect(field).toHaveValue("123");
    await userEvent.clear(field);
    fireEvent.change(field, { target: { value: "9".repeat(20) } });
    expect(useCreateForm.getState().seed).toBeLessThan(2 ** 48);
  });

  it("can roll a new one", async () => {
    setForm({ engine: "ace-step", seedMode: "fixed", seed: 5 });
    render(panel());
    await userEvent.click(
      screen.getByRole("button", { name: "Estrai un nuovo seme" }),
    );
    expect(useCreateForm.getState().seed).not.toBe(5);
  });

  it("never travels with a kie request even if it was fixed earlier", async () => {
    setForm({ engine: "kie", seedMode: "fixed", seed: 99 });
    render(panel());
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    expect((await sent()).settings).not.toHaveProperty("seed");
  });
});

describe("Esperto (ACE-Step)", () => {
  it("is for ACE-Step only", async () => {
    setForm({ engine: "yue2" });
    const { unmount } = render(panel());
    expect(
      screen.queryByRole("button", { name: "Esperto" }),
    ).not.toBeInTheDocument();
    unmount();
    setForm({ engine: "kie" });
    const again = render(panel());
    expect(
      screen.queryByRole("button", { name: "Esperto" }),
    ).not.toBeInTheDocument();
    again.unmount();
    setForm({ engine: "ace-step" });
    render(panel());
    expect(screen.getByRole("button", { name: "Esperto" })).toBeVisible();
  });

  it("sends the steps and guidance that were typed", async () => {
    setForm({ engine: "ace-step" });
    render(panel());
    await userEvent.click(screen.getByRole("button", { name: "Esperto" }));
    expect(
      screen.getByRole("button", { name: "Passi di campionamento: 30" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Aderenza al prompt: 7" }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Passi di campionamento: 30" }),
    );
    let field = screen.getByRole("textbox", { name: "Passi di campionamento" });
    await userEvent.clear(field);
    await userEvent.type(field, "999{Enter}");
    // Out of range: clamps to the top of the range.
    expect(
      screen.getByRole("button", { name: "Passi di campionamento: 100" }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Aderenza al prompt: 7" }),
    );
    field = screen.getByRole("textbox", { name: "Aderenza al prompt" });
    await userEvent.clear(field);
    await userEvent.type(field, "9.5{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Crea canzone" }));
    expect((await sent()).settings).toMatchObject({
      steps: 100,
      guidance: 9.5,
    });
  });

  it("opens by itself when a saved draft changed them", () => {
    setForm({ engine: "ace-step", steps: 50 });
    render(panel());
    expect(
      screen.getByRole("button", { name: "Passi di campionamento: 50" }),
    ).toBeVisible();
  });
});

describe("EditableSlider in the options", () => {
  it("lets the duration be typed as minutes and seconds", async () => {
    setForm({ durationMode: "custom", duration: 180 });
    render(panel());
    await userEvent.click(screen.getByRole("button", { name: "Durata: 3:00" }));
    const field = screen.getByRole("textbox", { name: "Durata" });
    await userEvent.clear(field);
    await userEvent.type(field, "2:30{Enter}");
    expect(useCreateForm.getState().duration).toBe(150);
  });

  it.each([
    ["Stranezza", "weirdness"],
    ["Influenza dello stile", "styleInfluence"],
  ] as const)("lets %s be typed and clamps it", async (label, key) => {
    render(panel());
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(`^${label}:`, "u") }),
    );
    const field = screen.getByRole("textbox", { name: label });
    await userEvent.clear(field);
    await userEvent.type(field, "250{Enter}");
    expect(useCreateForm.getState()[key]).toBe(100);
  });

  it("lets the variety be typed as a number from 0 to 4", async () => {
    render(panel());
    await userEvent.click(screen.getByRole("button", { name: /^Varietà:/u }));
    const field = screen.getByRole("textbox", { name: "Varietà" });
    await userEvent.clear(field);
    await userEvent.type(field, "4{Enter}");
    expect(useCreateForm.getState().variety).toBe(4);
  });
});

describe("several songs per click", () => {
  it("is 1 by default and the button reads Crea", () => {
    render(panel());
    expect(
      screen.getByRole("radio", { name: "1", checked: true }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Crea canzone" }),
    ).toHaveTextContent(/^Crea$/u);
  });

  it("shows the count and the kie credits on the button", async () => {
    render(panel());
    await userEvent.click(screen.getByRole("radio", { name: "3" }));
    expect(
      screen.getByRole("button", { name: "Crea 3 canzoni · 36 crediti" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "3 canzoni da 12 crediti kie ciascuna, usati quando approvi i testi",
      ),
    ).toBeVisible();
  });

  it("multiplies by the languages", async () => {
    setForm({ languages: ["it", "en"], songCount: 3 });
    render(panel());
    expect(
      screen.getByRole("button", { name: "Crea 6 canzoni · 72 crediti" }),
    ).toBeVisible();
  });

  it("counts two languages even for one song", () => {
    setForm({ languages: ["it", "en"], songCount: 1 });
    render(panel());
    expect(
      screen.getByRole("button", { name: "Crea 2 canzoni · 24 crediti" }),
    ).toBeVisible();
  });

  it("says gratis for a local engine, with the PC minutes for all of them", async () => {
    setForm({ engine: "yue2", songCount: 3 });
    render(panel());
    expect(
      screen.getByRole("button", { name: "Crea 3 canzoni · gratis" }),
    ).toBeVisible();
    // YuE2: 1.6 x 3.5 = 6 minutes a song, 18 for three.
    expect(
      screen.getByText(
        "Gratis · 3 canzoni, una dopo l'altra, circa 18 minuti sul PC",
      ),
    ).toBeVisible();
  });

  it("is English in the English interface", () => {
    setForm({ songCount: 2 });
    render(panel(worker(), "en"));
    expect(
      screen.getByRole("button", { name: "Create 2 songs · 24 credits" }),
    ).toBeVisible();
  });

  it("asks for that many songs and says how many were made", async () => {
    render(panel());
    await userEvent.click(screen.getByRole("radio", { name: "4" }));
    await userEvent.click(
      screen.getByRole("button", { name: /^Crea 4 canzoni/u }),
    );
    expect((await sent()).count).toBe(4);
    await waitFor(() =>
      expect(mock.toast.success).toHaveBeenCalledWith("4 canzoni create"),
    );
  });

  it("reports a partial result", async () => {
    mock.create.mockResolvedValueOnce({ ok: true, id: "p", count: 2 });
    setForm({ songCount: 3 });
    render(panel());
    await userEvent.click(
      screen.getByRole("button", { name: /^Crea 3 canzoni/u }),
    );
    await waitFor(() =>
      expect(mock.toast.error).toHaveBeenCalledWith("Create 2 canzoni su 3"),
    );
    expect(mock.toast.success).not.toHaveBeenCalled();
  });

  it("is remembered, and survives clearing the form", async () => {
    render(panel());
    await userEvent.click(screen.getByRole("radio", { name: "2" }));
    expect(
      JSON.parse(localStorage.getItem("mellodifai-create-form") ?? "{}").state
        .songCount,
    ).toBe(2);
    act(() => useCreateForm.getState().clear());
    expect(useCreateForm.getState().songCount).toBe(2);
  });
});

describe("clear buttons", () => {
  it("empties the lyrics and brings them back with Annulla", async () => {
    setForm({ lyrics: "[Verse]\nCiao" });
    render(panel());
    await userEvent.click(
      screen.getByRole("button", { name: "Svuota il testo" }),
    );
    expect(useCreateForm.getState().lyrics).toBe("");
    const [message, options] = mock.toast.mock.calls.at(-1) as unknown as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Testo svuotato");
    expect(options.duration).toBe(5000);
    expect(options.action.label).toBe("Annulla");
    act(() => options.action.onClick());
    expect(useCreateForm.getState().lyrics).toBe("[Verse]\nCiao");
  });

  it("does not overwrite new text when Annulla comes late", async () => {
    setForm({ lyrics: "vecchio" });
    render(panel());
    await userEvent.click(
      screen.getByRole("button", { name: "Svuota il testo" }),
    );
    const options = mock.toast.mock.calls.at(-1)?.[1] as {
      action: { onClick: () => void };
    };
    act(() => useCreateForm.getState().set({ lyrics: "nuovo" }));
    act(() => options.action.onClick());
    expect(useCreateForm.getState().lyrics).toBe("nuovo");
  });

  it("is disabled while the field is empty", () => {
    setForm({ lyrics: "", styles: "", title: "", exclude: "" });
    render(panel());
    for (const name of [
      "Svuota il testo",
      "Svuota gli stili",
      "Svuota il titolo",
      "Svuota gli stili esclusi",
    ])
      expect(screen.getByRole("button", { name })).toBeDisabled();
  });

  it.each([
    ["styles", "Svuota gli stili", "Stili svuotati"],
    ["title", "Svuota il titolo", "Titolo svuotato"],
    ["exclude", "Svuota gli stili esclusi", "Stili esclusi svuotati"],
  ] as const)("clears %s only", async (field, button, message) => {
    setForm({
      lyrics: "tieni",
      styles: "pop",
      title: "Titolo",
      exclude: "metal",
    });
    render(panel());
    await userEvent.click(screen.getByRole("button", { name: button }));
    const state = useCreateForm.getState();
    expect(state[field]).toBe("");
    expect(state.lyrics).toBe("tieni");
    expect(mock.toast.mock.calls.at(-1)?.[0]).toBe(message);
  });

  it("clears the description in simple mode", async () => {
    setForm({ mode: "simple", prompt: "una canzone" });
    render(panel());
    await userEvent.click(
      screen.getByRole("button", { name: "Svuota la descrizione" }),
    );
    expect(useCreateForm.getState().prompt).toBe("");
  });
});

describe("lyrics box height", () => {
  const grip = () =>
    screen.getByRole("separator", {
      name: "Trascina per cambiare l'altezza del testo",
    });

  it("starts at the saved height", () => {
    setForm({ lyricsHeight: 300 });
    render(panel());
    expect(grip()).toHaveAttribute("aria-valuenow", "300");
    expect(screen.getByRole("textbox", { name: "Testo" })).toHaveStyle({
      height: "300px",
    });
  });

  it("follows a drag and remembers the height", () => {
    render(panel());
    fireEvent.pointerDown(grip(), { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(grip(), { clientY: 580, pointerId: 1 });
    expect(useCreateForm.getState().lyricsHeight).toBe(224 + 80);
    fireEvent.pointerUp(grip(), { pointerId: 1 });
    fireEvent.pointerMove(grip(), { clientY: 900, pointerId: 1 });
    expect(useCreateForm.getState().lyricsHeight).toBe(304);
    expect(
      JSON.parse(localStorage.getItem("mellodifai-create-form") ?? "{}").state
        .lyricsHeight,
    ).toBe(304);
  });

  it("stays between 120 and 720 pixels", () => {
    render(panel());
    fireEvent.pointerDown(grip(), { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(grip(), { clientY: 5000, pointerId: 1 });
    expect(useCreateForm.getState().lyricsHeight).toBe(720);
    fireEvent.pointerMove(grip(), { clientY: -5000, pointerId: 1 });
    expect(useCreateForm.getState().lyricsHeight).toBe(120);
  });

  it("can be moved with the arrow keys", async () => {
    render(panel());
    grip().focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(useCreateForm.getState().lyricsHeight).toBe(248);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(useCreateForm.getState().lyricsHeight).toBe(200);
  });
});

describe("Formatta con AI", () => {
  const button = () => screen.getByRole("button", { name: "Formatta con AI" });

  it("is off while the styles are empty", async () => {
    setForm({ styles: "" });
    render(panel());
    expect(button()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button());
    expect(mock.format).not.toHaveBeenCalled();
  });

  it("rewrites the styles and fills the parameters still on Auto", async () => {
    mock.format.mockResolvedValue({
      ok: true,
      styles: "synthwave, retro, dreamy",
      bpm: 108,
      keyscale: "A minor",
      timeSignature: "4",
    });
    setForm({ styles: "retro synth" });
    render(panel());
    await userEvent.click(button());
    await waitFor(() =>
      expect(useCreateForm.getState().styles).toBe("synthwave, retro, dreamy"),
    );
    expect(mock.format).toHaveBeenCalledWith({ styles: "retro synth" });
    expect(useCreateForm.getState()).toMatchObject({
      bpm: 108,
      keyscale: "A minor",
      timeSignature: "4",
    });
    expect(mock.toast.success.mock.calls.at(-1)?.[0]).toBe(
      "Stili formattati. Compilati: BPM 108, Tonalità A minore, Metrica 4/4",
    );
  });

  it("leaves a parameter the person already chose", async () => {
    mock.format.mockResolvedValue({
      ok: true,
      styles: "rock",
      bpm: 150,
      keyscale: "E minor",
      timeSignature: "4",
    });
    setForm({ styles: "rock", bpm: 90, keyscale: "C major" });
    render(panel());
    await userEvent.click(button());
    await waitFor(() => expect(useCreateForm.getState().styles).toBe("rock"));
    expect(useCreateForm.getState()).toMatchObject({
      bpm: 90,
      keyscale: "C major",
      timeSignature: "4",
    });
    expect(mock.toast.success.mock.calls.at(-1)?.[0]).toBe(
      "Stili formattati. Compilati: Metrica 4/4",
    );
  });

  it("just says it is done when nothing was filled in", async () => {
    mock.format.mockResolvedValue({ ok: true, styles: "lo-fi, chill" });
    setForm({ styles: "chill" });
    render(panel());
    await userEvent.click(button());
    await waitFor(() =>
      expect(useCreateForm.getState().styles).toBe("lo-fi, chill"),
    );
    expect(mock.toast.success.mock.calls.at(-1)?.[0]).toBe("Stili formattati");
  });

  it("undoes the whole change with Annulla", async () => {
    mock.format.mockResolvedValue({ ok: true, styles: "new", bpm: 100 });
    setForm({ styles: "old" });
    render(panel());
    await userEvent.click(button());
    await waitFor(() => expect(useCreateForm.getState().styles).toBe("new"));
    const options = mock.toast.success.mock.calls.at(-1)?.[1] as {
      action: { onClick: () => void };
    };
    act(() => options.action.onClick());
    expect(useCreateForm.getState()).toMatchObject({ styles: "old", bpm: 40 });
  });

  it("shows a spinner while it works and cannot be clicked twice", async () => {
    let finish: (value: unknown) => void = () => {};
    mock.format.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setForm({ styles: "pop" });
    render(panel());
    await userEvent.click(button());
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute("aria-busy", "true");
    finish({ ok: true, styles: "pop, bright" });
    await waitFor(() => expect(button()).not.toBeDisabled());
    expect(mock.format).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["noKey", "La formattazione con AI non è configurata su questo server."],
    ["limit", "Troppe richieste: riprova tra qualche minuto."],
    ["failed", "Non sono riuscito a formattare gli stili. Riprova."],
  ] as const)(
    "explains a %s failure and keeps the styles",
    async (error, text) => {
      mock.format.mockResolvedValue({ ok: false, error });
      setForm({ styles: "pop" });
      render(panel());
      await userEvent.click(button());
      await waitFor(() => expect(mock.toast.error).toHaveBeenCalledWith(text));
      expect(useCreateForm.getState().styles).toBe("pop");
    },
  );

  it("survives the call itself failing", async () => {
    mock.format.mockRejectedValue(new Error("network"));
    setForm({ styles: "pop" });
    render(panel());
    await userEvent.click(button());
    await waitFor(() =>
      expect(mock.toast.error).toHaveBeenCalledWith(
        "Non sono riuscito a formattare gli stili. Riprova.",
      ),
    );
    expect(button()).not.toBeDisabled();
  });
});
