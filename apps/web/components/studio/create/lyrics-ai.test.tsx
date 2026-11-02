import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import { initialForm, useCreateForm } from "@/store/create-form";
import { LyricsAi } from "./lyrics-ai";

// "Scrivi con AI", "Rigenera" and "Migliora" (task 27) against mocked actions and a mocked
// lyrics_assist_state poll.
const mock = vi.hoisted(() => ({
  request: vi.fn(
    async (_input: Record<string, unknown>) =>
      ({ ok: true, id: "q1" }) as
        | { ok: true; id: string }
        | { ok: false; error: string },
  ),
  cancel: vi.fn(async () => ({ ok: true })),
  state: null as unknown,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/app/actions/lyrics-assist", () => ({
  requestLyricsAssist: mock.request,
  cancelLyricsAssist: mock.cancel,
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    rpc: async () => ({ data: mock.state, error: null }),
  }),
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

const TEXT = "[Verse 1]\nuno\ndue\n\n[Chorus]\ntre\nquattro";
const done = (lyrics: string, title: string | null = null) => ({
  status: "done",
  progress: 100,
  message: "assist.done",
  queuePosition: null,
  errorCode: null,
  result: {
    lyrics,
    title,
    jury: {
      available: true,
      passed: true,
      scores: { topic: 0.9, singable: 0.82 },
      issues: [],
      redacted: false,
    },
    writer: "anthropic/claude-sonnet-5.5",
    ms: 900,
  },
});

function bar(caret: number | null = null) {
  return render(
    <LocaleProvider value="it">
      <LyricsAi caret={caret} onBusy={() => {}} />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useCreateForm.setState(initialForm("it"));
  mock.state = null;
});

describe("LyricsAi", () => {
  it("writes from a brief and fills the empty title, with undo", async () => {
    useCreateForm.setState({ styles: "folk", languages: ["en"] });
    mock.state = done("[Verse 1]\nnew words", "Lake day");
    bar();
    expect(screen.getByRole("button", { name: "Rigenera" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Migliora" })).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Scrivi con AI" }),
    );
    await userEvent.type(
      screen.getByLabelText("Di cosa parla la canzone?"),
      "una gita al lago",
    );
    await userEvent.click(screen.getByRole("button", { name: "Scrivi" }));
    expect(mock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "write",
        lang: "en",
        brief: "una gita al lago",
        style: "folk",
        lyrics: "",
        section: null,
      }),
    );
    await waitFor(() =>
      expect(useCreateForm.getState().lyrics).toBe("[Verse 1]\nnew words"),
    );
    expect(useCreateForm.getState().title).toBe("Lake day");
    const [, options] = mock.toast.success.mock.calls[0] as [
      string,
      { description: string; action: { onClick: () => void } },
    ];
    expect(options.description).toBe("Giuria: minimo 0.82");
    options.action.onClick();
    expect(useCreateForm.getState()).toMatchObject({ lyrics: "", title: "" });
  });

  it("regenerates only the section the cursor is in", async () => {
    useCreateForm.setState({ lyrics: TEXT });
    mock.state = done("[Verse 1]\nuno\ndue\n\n[Chorus]\nsei\nsette");
    bar(TEXT.indexOf("quattro"));
    await userEvent.click(
      screen.getByRole("button", { name: "Rigenera [Chorus]" }),
    );
    expect(mock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "regenerate",
        lyrics: TEXT,
        section: { start: TEXT.indexOf("[Chorus]"), end: TEXT.length },
      }),
    );
    await waitFor(() =>
      expect(useCreateForm.getState().lyrics).toContain("sei\nsette"),
    );
  });

  it("says when the privacy filter stopped the request and keeps the text", async () => {
    useCreateForm.setState({ lyrics: TEXT });
    mock.state = {
      status: "failed",
      progress: null,
      message: null,
      queuePosition: null,
      result: null,
      errorCode: "privacy_filter",
    };
    bar();
    await userEvent.click(screen.getByRole("button", { name: "Migliora" }));
    await waitFor(() => expect(mock.toast.error).toHaveBeenCalled());
    expect(mock.toast.error.mock.calls[0]?.[0]).toMatch(
      /filtro privacy di OpenRouter/u,
    );
    expect(useCreateForm.getState().lyrics).toBe(TEXT);
  });

  it("explains a refused request", async () => {
    useCreateForm.setState({ lyrics: TEXT });
    mock.request.mockResolvedValueOnce({ ok: false, error: "busy" });
    bar();
    await userEvent.click(screen.getByRole("button", { name: "Migliora" }));
    expect(mock.toast.error).toHaveBeenCalledWith(
      "C'è già una richiesta di testo in corso.",
    );
  });
});
