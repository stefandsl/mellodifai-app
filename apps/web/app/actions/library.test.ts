// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => ({
      data: { project_id: "project" },
      error: null,
    })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    from: vi.fn(() => query),
    rpc: vi.fn(async (_name: string, _args: unknown) => ({
      data: null as unknown,
      error: null as { message: string } | null,
    })),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/auth", () => ({
  actionProfile: async () => ({ supabase: mocks, user: { id: "owner" } }),
}));

import {
  countPlay,
  renameVersion,
  restoreVersions,
  setReaction,
  trashVersions,
} from "./library";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

it("sends reactions, plays and renames to their RPCs", async () => {
  expect(await setReaction({ versionId: id, reaction: "dislike" })).toEqual({
    ok: true,
    id: "project",
  });
  expect(mocks.rpc).toHaveBeenLastCalledWith("set_reaction", {
    p_version: id,
    p_reaction: "dislike",
  });
  await countPlay({ versionId: id });
  expect(mocks.rpc).toHaveBeenLastCalledWith("count_play", { p_version: id });
  await renameVersion({ versionId: id, title: "  Lunedì  " });
  expect(mocks.rpc).toHaveBeenLastCalledWith("rename_version", {
    p_version: id,
    p_title: "Lunedì",
  });
});

it("rejects input the database would also refuse, before calling it", async () => {
  for (const call of [
    setReaction({ versionId: id, reaction: "love" }),
    setReaction({ versionId: "not-a-uuid", reaction: "like" }),
    renameVersion({ versionId: id, title: "   " }),
    renameVersion({ versionId: id, title: "x".repeat(101) }),
    trashVersions({ versionIds: [] }),
    trashVersions({ versionIds: ["nope"] }),
    restoreVersions({ versionIds: Array(501).fill(id) }),
  ])
    expect(await call).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("returns how many songs the trash and restore RPCs changed", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: 2, error: null });
  expect(await trashVersions({ versionIds: [id, other, id] })).toEqual({
    ok: true,
    count: 2,
  });
  expect(mocks.rpc).toHaveBeenLastCalledWith("trash_versions", {
    p_versions: [id, other, id],
  });
  mocks.rpc.mockResolvedValueOnce({ data: 0, error: null });
  expect(await restoreVersions({ versionIds: [id] })).toEqual({
    ok: true,
    count: 0,
  });
  expect(mocks.rpc).toHaveBeenLastCalledWith("restore_versions", {
    p_versions: [id],
  });
});

it("reports a database error as a failed action", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "owned version required" },
  });
  expect(await setReaction({ versionId: id, reaction: "like" })).toMatchObject({
    ok: false,
  });
});
