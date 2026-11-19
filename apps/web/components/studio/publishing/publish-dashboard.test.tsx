import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/actions/publishing", () => ({}));

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
