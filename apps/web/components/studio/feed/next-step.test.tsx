import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { Clip } from "@/lib/studio/clips";
import frPack from "../../../../../packages/shared/test/fixtures/fr-pack.json" with {
  type: "json",
};
import { NextStep } from "./next-step";

const mock = vi.hoisted(() => ({
  approve: vi.fn(async () => ({ ok: true as const })),
  refresh: vi.fn(),
}));
vi.mock("@/app/actions/checkpoints", () => ({ approveLyrics: mock.approve }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "v1",
    projectId: "p1",
    lang: "fr",
    title: frPack.title,
    style: frPack.style,
    prompt: "",
    lyrics: frPack.lyrics,
    model: "V6",
    status: "lyrics_review",
    createdAt: "",
    updatedAt: "",
    audioUrl: null,
    videoUrl: null,
    hookUrl: null,
    href: "/projects/p1?lang=fr",
    art: "",
    settings: {},
    pack: frPack,
    ...patch,
  };
}

beforeEach(() => {
  mock.approve.mockClear();
  mock.refresh.mockClear();
});

it("approves the drafted pack from the feed after showing lyrics and cost", async () => {
  render(<NextStep clip={clip()} />);
  await userEvent.click(screen.getByRole("button", { name: "Approva e crea" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("12 crediti");
  expect(
    screen.getByRole("link", { name: "Modifica il testo" }),
  ).toHaveAttribute("href", "/projects/p1?lang=fr");
  await userEvent.click(
    screen.getByRole("button", { name: "Approva · 12 crediti" }),
  );
  await waitFor(() =>
    expect(mock.approve).toHaveBeenCalledWith({
      versionId: "v1",
      pack: frPack,
    }),
  );
  expect(mock.refresh).toHaveBeenCalled();
});

it("does not spend credits on lyrics that would fail validation", async () => {
  render(
    <NextStep clip={clip({ pack: { ...frPack, lyrics: "[Verse]\nOne" } })} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Approva e crea" }));
  expect(
    screen.getByRole("button", { name: "Approva · 12 crediti" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("va sistemato");
});

it("links the other waiting steps to the song page", () => {
  const { rerender } = render(
    <NextStep clip={clip({ status: "takes_review" })} />,
  );
  expect(screen.getByRole("link", { name: /Scegli la take/u })).toHaveAttribute(
    "href",
    "/projects/p1?lang=fr",
  );
  rerender(<NextStep clip={clip({ status: "video_review" })} />);
  expect(screen.getByRole("link", { name: /Rivedi il video/u })).toBeVisible();
  rerender(<NextStep clip={clip({ status: "producing" })} />);
  expect(screen.queryByRole("link")).toBeNull();
});
