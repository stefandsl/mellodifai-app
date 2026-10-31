import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  resolveUpload: vi.fn(async () => ({ ok: true })),
  resolveKieSubmission: vi.fn(async () => ({ ok: true })),
  retryStage: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/checkpoints", () => ({ ...actions }));

import { LocaleProvider } from "./locale-provider";
import { ProjectWorkspace, type PublicationView } from "./project-workspace";

beforeEach(() => vi.clearAllMocks());
function show(
  stage: string,
  publication: PublicationView | null = null,
  active = false,
  admin = true,
) {
  return render(
    <LocaleProvider value="en">
      <ProjectWorkspace
        version={{
          id: "v",
          status: "failed",
          lang: "en",
          lyric_pack: null,
          generation_count: 1,
          render_attempt: 1,
          kie_submit_state: stage === "generate_song" ? "submitting" : null,
        }}
        takes={[]}
        renders={[]}
        publication={publication}
        failedJob={{ id: "j", error: "outcome unknown", stage }}
        activeJob={active}
        isAdmin={admin}
      />
    </LocaleProvider>,
  );
}
const publication: PublicationView = {
  id: "p",
  privacy: "private",
  youtube_video_id: null,
  upload_state: "uploading",
};
it("resolves unknown upload as not uploaded", async () => {
  show("publish", publication);
  fireEvent.click(screen.getByRole("button", { name: "Not uploaded" }));
  await waitFor(() =>
    expect(actions.resolveUpload).toHaveBeenCalledWith({
      publicationId: "p",
      uploaded: false,
    }),
  );
  expect(
    screen.queryByRole("button", { name: "Generate again (12 credits)" }),
  ).not.toBeInTheDocument();
});
it("requires a video id and resolves an uploaded video", async () => {
  show("publish", publication);
  const submit = screen.getByRole("button", { name: "Uploaded, video id ..." });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("YouTube video id"), {
    target: { value: "abc123" },
  });
  fireEvent.click(submit);
  await waitFor(() =>
    expect(actions.resolveUpload).toHaveBeenCalledWith({
      publicationId: "p",
      uploaded: true,
      videoId: "abc123",
    }),
  );
});
it.each([
  [true, true],
  [false, false],
])("hides upload resolution when active=%s admin=%s", (active, admin) => {
  show("publish", publication, active, admin);
  expect(
    screen.queryByRole("button", { name: "Not uploaded" }),
  ).not.toBeInTheDocument();
});
it("retries a failed publish without showing a generation charge", async () => {
  show("publish", { ...publication, upload_state: "pending" });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(actions.retryStage).toHaveBeenCalledWith({
      versionId: "v",
      jobId: "j",
    }),
  );
  expect(screen.queryByText(/12 credits/)).not.toBeInTheDocument();
});
it.each([false, true])(
  "resolves a Kie unknown submission charged=%s with an inline form",
  async (charged) => {
    show("generate_song");
    expect(screen.getByRole("alert")).toHaveTextContent("outcome unknown");
    if (charged)
      fireEvent.change(screen.getByLabelText("Kie task id"), {
        target: { value: "task-123" },
      });
    fireEvent.click(
      screen.getByRole("button", {
        name: charged ? "Charged, task id ..." : "Not charged",
      }),
    );
    await waitFor(() =>
      expect(actions.resolveKieSubmission).toHaveBeenCalledWith({
        versionId: "v",
        charged,
        ...(charged ? { taskId: "task-123" } : {}),
      }),
    );
  },
);
