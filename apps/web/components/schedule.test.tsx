import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setPrivacy: vi.fn(async () => {}) }));
vi.mock("@/app/actions/checkpoints", () => ({
  ...mocks,
  approveLyrics: vi.fn(),
  approveVideo: vi.fn(),
  generateAgain: vi.fn(),
  pickTake: vi.fn(),
  rerenderVideo: vi.fn(),
  uploadPrivate: vi.fn(),
}));

import { ProjectWorkspace } from "./project-workspace";

it("sends an explicit future ISO date only after scheduled confirmation", async () => {
  render(
    <ProjectWorkspace
      version={{ id: "v", status: "approved", lyric_pack: null }}
      takes={[]}
      renders={[]}
      publication={{ id: "p", youtube_video_id: "abc123", privacy: "private" }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Data e ora di pubblicazione"), {
    target: { value: "2099-01-01T12:00" },
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Make scheduled" }));
  expect(mocks.setPrivacy).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Confirm", exact: true }),
  );
  expect(mocks.setPrivacy).toHaveBeenCalledWith({
    publicationId: "p",
    privacy: "scheduled",
    publishAt: new Date("2099-01-01T12:00").toISOString(),
  });
});
