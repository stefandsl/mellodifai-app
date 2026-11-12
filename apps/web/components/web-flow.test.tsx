import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  approveVideo: vi.fn(async () => ({ ok: true })),
  rerenderVideo: vi.fn(async () => ({ ok: true })),
  toast: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("@/app/actions/checkpoints", () => ({
  ...mocks,
  approveLyrics: vi.fn(),
  generateAgain: vi.fn(),
  pickTake: vi.fn(),
  setPrivacy: vi.fn(),
  uploadPrivate: vi.fn(),
  retryStage: vi.fn(),
}));

import { LyricPackSchema } from "@mellodifai/shared";
import { ConfirmDialog } from "./confirm-dialog";
import { LocaleProvider } from "./locale-provider";
import { LyricEditor } from "./lyric-editor";
import { ProjectWorkspace, PublishPanel } from "./project-workspace";

it.each(["approved", "published"] as const)(
  "offers a new render after %s",
  async (status) => {
    render(
      <LocaleProvider value="it">
        <ProjectWorkspace
          version={{
            id: "v",
            lang: "it",
            status,
            lyric_pack: null,
            generation_count: 1,
            render_attempt: 1,
          }}
          takes={[]}
          renders={[]}
          publication={null}
        />
      </LocaleProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Nuovo render" }));
    expect(mocks.rerenderVideo).toHaveBeenCalledWith({ versionId: "v" });
  },
);

it("hides the new render action while publication is in progress", () => {
  render(
    <LocaleProvider value="it">
      <ProjectWorkspace
        version={{
          id: "v",
          lang: "it",
          status: "publishing",
          lyric_pack: null,
          generation_count: 1,
          render_attempt: 1,
        }}
        takes={[]}
        renders={[]}
        publication={null}
      />
    </LocaleProvider>,
  );
  expect(
    screen.queryByRole("button", { name: "Nuovo render" }),
  ).not.toBeInTheDocument();
});

it("binds publication metadata and storyboard to the rendered take", () => {
  const pack = LyricPackSchema.parse({
    title: "Le port",
    lyrics: "Anciennes paroles",
    style: "Pop",
    exclude: "",
    settings: { model: "V5" },
    displayMap: {},
    l10n: {},
  });
  render(
    <LocaleProvider value="it">
      <ProjectWorkspace
        version={{
          id: "v",
          lang: "fr",
          status: "approved",
          lyric_pack: { ...pack, lyrics: "Nouvelles paroles" },
          generation_count: 1,
          render_attempt: 1,
          storyboard_sections: [{ title: "New section", start: 0 }],
        }}
        takes={[]}
        publication={null}
        renders={[
          {
            id: "r",
            kind: "master",
            previewUrl: null,
            qa_results: {
              assets: {
                lyric_pack: pack,
                lang: "fr",
                storyboard_sections: [{ title: "Rendered section", start: 0 }],
              },
            },
          },
        ]}
      />
    </LocaleProvider>,
  );
  const description = (
    screen.getByLabelText("Descrizione") as HTMLTextAreaElement
  ).value;
  expect(description).toContain("Anciennes paroles");
  expect(description).not.toContain("Nouvelles paroles");
  expect(description).not.toContain("Pop");
  expect(screen.getByText("Rendered section")).toBeInTheDocument();
  expect(screen.queryByText("New section")).not.toBeInTheDocument();
});

beforeEach(() => vi.clearAllMocks());
it("shows approved master, hook and thumbnail before the publish form without repeating status", () => {
  const { container } = render(
    <LocaleProvider value="en">
      <ProjectWorkspace
        version={{
          id: "v",
          lang: "it",
          status: "approved",
          lyric_pack: null,
          generation_count: 1,
          render_attempt: 1,
        }}
        takes={[]}
        publication={null}
        thumbnailUrl="https://example.test/signed-thumbnail"
        renders={[
          {
            id: "h",
            kind: "hook",
            previewUrl: "https://example.test/signed-hook",
            qa_results: {},
          },
          {
            id: "m",
            kind: "master",
            previewUrl: "https://example.test/signed-master",
            qa_results: {},
          },
        ]}
      />
    </LocaleProvider>,
  );
  const media = [...container.querySelectorAll("video, img, form")];
  expect(media.map((node) => node.tagName)).toEqual([
    "VIDEO",
    "VIDEO",
    "IMG",
    "FORM",
  ]);
  expect(media[0]).toHaveAttribute("src", "https://example.test/signed-master");
  expect(media[1]).toHaveAttribute("src", "https://example.test/signed-hook");
  expect(screen.queryByText("Approved")).not.toBeInTheDocument();
});
it.each(["it", "en"] as const)(
  "renders QA values and requires a reason before override in %s",
  async (lang) => {
    render(
      <LocaleProvider value={lang}>
        <ProjectWorkspace
          version={{
            id: "v",
            lang: "fr",
            status: "video_review",
            lyric_pack: null,
            generation_count: 2,
            render_attempt: 3,
          }}
          takes={[]}
          publication={null}
          renders={[
            {
              id: "r",
              kind: "master",
              previewUrl: null,
              qa_results: {
                gates: [
                  { name: "integrated_loudness", pass: false, value: -10 },
                  { name: "true_peak", pass: true, value: -1.5 },
                ],
              },
            },
          ]}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText("-10")).toBeInTheDocument();
    expect(screen.getByText("-1.5")).toBeInTheDocument();
    const approve = screen.getByRole("button", {
      name: lang === "en" ? "Approve video" : "Approva video",
    });
    expect(approve).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText(
        lang === "en"
          ? "Approval override reason"
          : "Motivo approvazione con eccezione",
      ),
      { target: { value: "Reviewed louder mix" } },
    );
    await userEvent.click(approve);
    expect(mocks.approveVideo).toHaveBeenCalledWith({
      versionId: "v",
      overrideReason: "Reviewed louder mix",
    });
  },
);
it("keeps a failed confirmation usable, toasts the error and disables pending clicks", async () => {
  let resolve: (r: { ok: false; error: string }) => void = () => {};
  const action = vi.fn(
    () =>
      new Promise<{ ok: false; error: string }>((r) => {
        resolve = r;
      }),
  );
  render(
    <LocaleProvider value="en">
      <ConfirmDialog trigger="Open" title="Review" onConfirm={action}>
        Song
      </ConfirmDialog>
    </LocaleProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  expect(action).toHaveBeenCalledTimes(1);
  resolve({ ok: false, error: "Try again" });
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Try again"));
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  // The toast fires before the dialog re-enables its button.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm" })).not.toBeDisabled(),
  );
});
it("prefills the editable publication form in English", () => {
  render(
    <LocaleProvider value="en">
      <PublishPanel
        renderId="r"
        publication={null}
        defaults={{
          title: "Song | Lyric video",
          description: "Brief and credits",
          tags: "song, en",
          chapters: "0:00 Intro",
        }}
      />
    </LocaleProvider>,
  );
  expect(screen.getByLabelText("Video title")).toHaveValue(
    "Song | Lyric video",
  );
  expect(screen.getByLabelText("Chapters")).toHaveValue("0:00 Intro");
});
it.each(["it", "en"] as const)(
  "localizes lyric cost confirmation and validates the pack in %s",
  async (lang) => {
    const cost =
      lang === "it"
        ? "Approva e genera la canzone: 12 crediti kie"
        : "Approve and generate song: 12 kie credits";
    const approve = vi.fn();
    const pack = {
      title: "",
      lyrics: "one",
      style: "Pop",
      exclude: "",
      settings: {
        model: "V6" as const,
        vocalGender: "f" as const,
        styleWeight: 0.7,
        weirdness: 0.35,
        variety: 1,
        duration: 310,
      },
      displayMap: {},
      l10n: {},
    };
    render(
      <LocaleProvider value={lang}>
        <LyricEditor pack={pack} theme="vbp" onApprove={approve} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: cost })).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText(lang === "it" ? "Titolo" : "Title"),
      {
        target: { value: "Song" },
      },
    );
    fireEvent.change(
      screen.getByLabelText(lang === "it" ? "Testo" : "Lyrics"),
      {
        target: { value: Array.from({ length: 80 }, () => "line").join("\n") },
      },
    );
    expect(screen.getByRole("button", { name: cost })).not.toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: cost }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(cost);
    expect(screen.getByRole("heading", { name: cost })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: lang === "it" ? "Annulla" : "Cancel",
      }),
    ).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", {
        name: lang === "it" ? "Conferma" : "Confirm",
      }),
    );
    expect(approve).toHaveBeenCalledTimes(1);
  },
);
