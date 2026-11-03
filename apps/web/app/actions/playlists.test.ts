// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async (_name: string, _args: unknown) => ({
    data: null as unknown,
    error: null as { message: string } | null,
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/auth", () => ({
  actionProfile: async () => ({ supabase: mocks, user: { id: "owner" } }),
}));

import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  removeFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
} from "./playlists";

const list = "00000000-0000-4000-8000-0000000000a1";
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

it("creates a playlist and returns its id", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: list, error: null });
  expect(await createPlaylist({ name: "  Sera  " })).toEqual({
    ok: true,
    id: list,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("create_playlist", { p_name: "Sera" });
});

it("renames and deletes through their RPCs", async () => {
  expect(await renamePlaylist({ playlistId: list, name: "Notte" })).toEqual({
    ok: true,
  });
  expect(mocks.rpc).toHaveBeenLastCalledWith("rename_playlist", {
    p_playlist: list,
    p_name: "Notte",
  });
  expect(await deletePlaylist({ playlistId: list })).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenLastCalledWith("delete_playlist", {
    p_playlist: list,
  });
});

it("adds and removes songs and reports how many changed", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: 2, error: null });
  expect(await addToPlaylist({ playlistId: list, versionIds: [a, b] })).toEqual(
    { ok: true, count: 2 },
  );
  expect(mocks.rpc).toHaveBeenLastCalledWith("add_to_playlist", {
    p_playlist: list,
    p_versions: [a, b],
  });
  mocks.rpc.mockResolvedValueOnce({ data: 1, error: null });
  expect(
    await removeFromPlaylist({ playlistId: list, versionIds: [a] }),
  ).toEqual({ ok: true, count: 1 });
  expect(mocks.rpc).toHaveBeenLastCalledWith("remove_from_playlist", {
    p_playlist: list,
    p_versions: [a],
  });
});

it("reorders with the full list", async () => {
  expect(
    await reorderPlaylist({ playlistId: list, versionIds: [b, a] }),
  ).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenLastCalledWith("reorder_playlist", {
    p_playlist: list,
    p_versions: [b, a],
  });
});

it("rejects bad input before any RPC", async () => {
  for (const result of [
    await createPlaylist({ name: "   " }),
    await createPlaylist({ name: "x".repeat(101) }),
    await renamePlaylist({ playlistId: "nope", name: "ok" }),
    await deletePlaylist({}),
    await addToPlaylist({ playlistId: list, versionIds: [] }),
    await addToPlaylist({ playlistId: list, versionIds: ["nope"] }),
    await removeFromPlaylist({ playlistId: list, versionIds: [a, "nope"] }),
    await reorderPlaylist({ playlistId: list, versionIds: [] }),
  ])
    expect(result.ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("returns a failure when the database refuses", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "owned playlist required" },
  });
  expect((await deletePlaylist({ playlistId: list })).ok).toBe(false);
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "too many playlists" },
  });
  expect((await createPlaylist({ name: "More" })).ok).toBe(false);
});
