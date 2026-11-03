// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(
    async (
      _name: string,
      _args: unknown,
    ): Promise<{
      data: unknown;
      error: { message: string } | null;
    }> => ({ data: "p1", error: null }),
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/auth", () => ({
  actionProfile: async () => ({ supabase: mocks, user: { id: "owner" } }),
}));

import { createSong } from "./create-song";

const input = (extra: Record<string, unknown> = {}, settings = {}) => ({
  mode: "simple",
  prompt: "una canzone sul lunedì",
  lyrics: "",
  styles: "",
  languages: ["it"],
  vocalGender: null,
  settings: { engine: "kie", model: "V6", ...settings },
  ...extra,
});
const calls = () =>
  mocks.rpc.mock.calls.filter(([name]) => name === "create_song");
const sent = (index: number) => {
  const args = calls()[index]?.[1] as
    | { p_settings: Record<string, unknown> }
    | undefined;
  return args?.p_settings ?? {};
};

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  mocks.rpc.mockImplementation(async () => ({ data: `p${++n}`, error: null }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

it("makes one project for a plain click", async () => {
  const result = await createSong(input());
  expect(calls()).toHaveLength(1);
  expect(result).toEqual({ ok: true, id: "p1", count: 1 });
});

it("makes one project per song, in order, all with the same request", async () => {
  const result = await createSong(input({ count: 3 }));
  expect(calls()).toHaveLength(3);
  expect(result).toEqual({ ok: true, id: "p1", count: 3 });
  for (const [, args] of calls())
    expect(args).toMatchObject({
      p_prompt: "una canzone sul lunedì",
      p_languages: ["it"],
    });
});

it("gives each song of one click its own pair of seeds when the seed is fixed", async () => {
  await createSong(input({ count: 3 }, { engine: "ace-step", seed: 1000 }));
  expect([0, 1, 2].map((i) => sent(i).seed)).toEqual([1000, 1002, 1004]);
});

it("leaves the settings alone when there is no fixed seed", async () => {
  await createSong(input({ count: 2 }));
  expect(sent(0)).not.toHaveProperty("seed");
  expect(sent(1)).not.toHaveProperty("seed");
});

it("refuses a count outside 1 to 4 before calling the database", async () => {
  for (const count of [0, 5, 1.5, "2"]) {
    expect(await createSong(input({ count }))).toMatchObject({ ok: false });
  }
  expect(calls()).toHaveLength(0);
});

it("reports how many songs were made when one fails part way", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: "p1", error: null })
    .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
  const result = await createSong(input({ count: 3 }));
  expect(result).toEqual({ ok: true, id: "p1", count: 1 });
  expect(calls()).toHaveLength(2);
});

it("fails when the first song cannot be made", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
  expect(await createSong(input({ count: 2 }))).toMatchObject({ ok: false });
  expect(calls()).toHaveLength(1);
});

it("names a song made from audio alone after its source and sends the source", async () => {
  const take = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
  const result = await createSong(
    input(
      { mode: "advanced", prompt: "" },
      { source: { mode: "reference", takeId: take, title: "Solo un caffè" } },
    ),
  );
  expect(result).toMatchObject({ ok: true });
  expect(calls()[0]?.[1]).toMatchObject({ p_prompt: "Solo un caffè" });
  expect(sent(0).source).toEqual({
    mode: "reference",
    takeId: take,
    title: "Solo un caffè",
  });
});
