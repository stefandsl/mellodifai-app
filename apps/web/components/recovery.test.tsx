import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  resolveUpload: vi.fn(async () => ({ ok: true })),
  resolveKieSubmission: vi.fn(async () => ({ ok: true })),
  retryStage: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/checkpoints", () => ({ ...actions }));

import { LocaleProvider } from "./locale-provider";
import {
  ProjectWorkspace,
  type PublicationView,
  PublishPanel,
} from "./project-workspace";

beforeEach(() => vi.clearAllMocks());
it("localizes the current privacy in the Italian publication panel", () => {
  render(
    <LocaleProvider value="it">
      <PublishPanel
        defaults={{ title: "Song", description: "", tags: "", chapters: "" }}
        publication={{
          id: "p",
          youtube_video_id: "video",
          privacy: "private",
          upload_state: "uploaded",
        }}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("Visibilità: Privato")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "YouTube" })).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=video",
  );
});
it.each(["it", "en"] as const)(
  "offers only the safe Kie action and localized copy in %s",
  (lang) => {
    for (const state of ["pending", "failed", "missing"]) {
      const view = render(
        <LocaleProvider value={lang}>
          <ProjectWorkspace
            version={{
              id: "v",
              status: "failed",
              lang: "en",
              lyric_pack: null,
              generation_count: 1,
              render_attempt: 1,
              kie_task_id: state === "missing" ? null : "task",
              kie_task_state: state === "failed" ? "failed" : null,
            }}
            takes={[]}
            renders={[]}
            publication={null}
            failedJob={{ id: "j", stage: "generate_song", error: "reason" }}
            isAdmin
          />
        </LocaleProvider>,
      );
      const free =
        lang === "it"
          ? "Riprova (gratis, controlla di nuovo kie)"
          : "Retry (free, checks kie again)";
      const paid =
        lang === "it"
          ? "Genera di nuovo (12 crediti)"
          : "Generate again (12 credits)";
      expect(
        screen.getByRole("button", { name: state === "pending" ? free : paid }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: state === "pending" ? paid : free,
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: lang === "it" ? "Torna ai testi" : "Back to lyrics",
        }),
      ).toBeInTheDocument();
      view.unmount();
    }
  },
);
it.each(["it", "en"] as const)(
  "shows the future quota time in %s, but not expired waits",
  (lang) => {
    const time = new Date(Date.now() + 86400000).toISOString();
    const props = {
      defaults: { title: "Song", description: "", tags: "", chapters: "" },
      publication: null,
      uploading: true,
    };
    const view = render(
      <LocaleProvider value={lang}>
        <PublishPanel {...props} quotaNotBefore={time} />
      </LocaleProvider>,
    );
    expect(
      screen.getByText(
        lang === "it"
          ? /In attesa della quota YouTube di domani/
          : /Waiting for tomorrow's YouTube quota/,
      ),
    ).toHaveTextContent(new Date(time).toLocaleString(lang));
    view.rerender(
      <LocaleProvider value={lang}>
        <PublishPanel {...props} quotaNotBefore="2020-01-01T00:00:00Z" />
      </LocaleProvider>,
    );
    expect(
      screen.queryByText(/quota YouTube|YouTube quota/),
    ).not.toBeInTheDocument();
  },
);
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
