import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
const actions = vi.hoisted(() => ({
  reopenPublication: vi.fn(async () => ({ ok: true })),
  cancelPublication: vi.fn(async () => ({ ok: true })),
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
