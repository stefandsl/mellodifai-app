import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
const actions = vi.hoisted(() => ({
  reopenPublication: vi.fn(async () => ({ ok: true })),
  cancelPublication: vi.fn(async () => ({ ok: true })),
  vetoLegacyPublication: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/publishing", () => actions);

import { LocaleProvider } from "@/components/locale-provider";
import type { ScheduleView } from "@/lib/ops/defs/publishing";
import { scheduleView } from "@/test/api-cases";
import { PublishDashboard } from "./publish-dashboard";

const defaults = {
  title: "API test",
  description: "",
  tags: ["pop"],
  thumbnail_text: "",
};
function view(over: Partial<ScheduleView> = {}): ScheduleView {
  const base = structuredClone(scheduleView) as unknown as ScheduleView;
  return { ...base, state: "draft", approval: null, ...over };
}
function show(current: ScheduleView) {
  return render(
    <LocaleProvider value="it">
      <PublishDashboard
        versionId={current.version_id}
        songTitle="API test"
        canPublish
        thumbnailUrl={null}
        defaults={defaults}
        current={current}
        past={[]}
      />
    </LocaleProvider>,
  );
}

it("shows why a plan cannot be approved when the thumbnail text has no base image", () => {
  const current = view();
  const destination = current.destinations[0];
  if (!destination) throw new Error("fixture destination missing");
  destination.draft = { ...destination.draft, thumbnail_text: "Ciao" };
  destination.problems = [{ field: "thumbnail_text", code: "no_base_image" }];
  show(current);
  expect(screen.getByTestId("lint-errors")).toHaveTextContent(
    "Testo della miniatura: manca l'immagine di base della miniatura",
  );
  expect(screen.getByRole("button", { name: "Programma" })).toBeDisabled();
});

it("shows that a video whose QA failed cannot be published, also while the draft is being edited", () => {
  const current = view();
  const destination = current.destinations[0];
  if (!destination) throw new Error("fixture destination missing");
  destination.problems = [{ field: "render", code: "qa_failed" }];
  const { container } = show(current);
  const reason = "Video: il controllo qualità non è passato";
  expect(screen.getByTestId("lint-errors")).toHaveTextContent(reason);
  expect(screen.getByRole("button", { name: "Programma" })).toBeDisabled();
  // An unsaved edit hides the problems of the saved draft, never the render's.
  const title = container.querySelector("#pub-title");
  if (!title) throw new Error("title field missing");
  fireEvent.change(title, { target: { value: "Un altro titolo" } });
  expect(screen.getByTestId("lint-errors")).toHaveTextContent(reason);
  expect(screen.getByRole("button", { name: "Programma" })).toBeDisabled();
});

it("says why a plan was held when the video's QA failed", () => {
  show(view({ state: "held", held_reason: "qa_failed" }));
  expect(
    screen.getByText(/controllo qualità di questo video non è passato/),
  ).toBeInTheDocument();
});

it("lets the owner send a held plan back to draft", async () => {
  show(view({ state: "held", held_reason: "thumbnail_missing" }));
  expect(screen.getByText(/manca l'immagine di base/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Rimetti in bozza" }));
  await waitFor(() =>
    expect(actions.reopenPublication).toHaveBeenCalledWith({
      schedule_id: scheduleView.schedule_id,
    }),
  );
});

it("offers the owner a veto on an old-flow YouTube schedule", async () => {
  const id = crypto.randomUUID();
  render(
    <LocaleProvider value="it">
      <PublishDashboard
        versionId={scheduleView.version_id}
        songTitle="API test"
        canPublish
        thumbnailUrl={null}
        defaults={defaults}
        current={null}
        past={[]}
        legacy={[
          {
            publication_id: id,
            video_id: "old-1",
            privacy: "scheduled",
            publish_at: "2026-12-01T10:00:00Z",
            upload_state: "uploaded",
          },
        ]}
      />
    </LocaleProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Veto: rendilo privato" }),
  );
  const dialog = await screen
    .findByRole("alertdialog")
    .catch(() => screen.findByRole("dialog"));
  const buttons = Array.from(dialog.querySelectorAll("button"));
  const confirm = buttons.find((b) =>
    /Veto|Conferma/u.test(b.textContent ?? ""),
  );
  if (!confirm) throw new Error("confirm button missing");
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(actions.vetoLegacyPublication).toHaveBeenCalledWith({
      publication_id: id,
    }),
  );
});
