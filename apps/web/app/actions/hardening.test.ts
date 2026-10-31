// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const single = vi.fn(async () => ({
    data: {
      id: "publication",
      version_id: "version",
      render_attempt: 1,
      renders: { version_id: "version" },
    },
    error: null,
  }));
  const query = { single, eq: vi.fn(), select: vi.fn() };
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  const from = vi.fn(() => ({
    update: vi.fn(() => query),
    insert: vi.fn(() => query),
    select: vi.fn(() => query),
  }));
  return { from, rpc: vi.fn(async () => ({ data: "job", error: null })) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  actionProfile: async () => ({ supabase: mocks, user: { id: "owner" } }),
}));

import {
  generateAgain,
  pickTake,
  rerenderVideo,
  setPrivacy,
} from "./checkpoints";

const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => vi.clearAllMocks());
it("uses an atomic transition to pick a take and enqueue timing", async () => {
  await pickTake({ versionId: id, takeId: id });
  expect(mocks.rpc).toHaveBeenCalledWith("transition_version", {
    p_version: id,
    p_action: "pick_take",
    p_take: id,
  });
  expect(mocks.from).not.toHaveBeenCalled();
});
it("uses explicit transition RPCs for new paid generations and render attempts", async () => {
  await generateAgain({ versionId: id });
  await rerenderVideo({ versionId: id, overrideReason: "Fix timing" });
  expect(mocks.rpc).toHaveBeenCalledWith("transition_version", {
    p_version: id,
    p_action: "generate_again",
  });
  expect(mocks.rpc).toHaveBeenCalledWith("transition_version", {
    p_version: id,
    p_action: "render_again",
  });
  expect(mocks.from).not.toHaveBeenCalled();
});
it("confirms a scheduled publication through the authenticated RPC only", async () => {
  const publishAt = "2099-01-01T00:00:00Z";
  await setPrivacy({ publicationId: id, privacy: "scheduled", publishAt });
  expect(mocks.rpc).toHaveBeenCalledWith("confirm_publication", {
    p_publication: id,
    p_privacy: "scheduled",
    p_publish_at: publishAt,
  });
  expect(mocks.from).not.toHaveBeenCalled();
});
