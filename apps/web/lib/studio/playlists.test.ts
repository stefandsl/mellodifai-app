import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  loadClips: vi.fn(),
}));
vi.mock("./clips", () => ({ loadClips: mock.loadClips }));

import { LIKED_ID, loadPlaylistPage, loadPlaylists } from "./playlists";

const clip = (id: string) => ({ id, title: id });
const UUID = "11111111-1111-4111-8111-111111111111";

// A tiny query builder that answers by table and records the filters it was given.
function client(tables: Record<string, unknown>, count = 0) {
  const calls: string[] = [];
  const chain = (table: string) => {
    const result = Promise.resolve({
      data: tables[table] ?? null,
      count,
    });
    // biome-ignore lint/suspicious/noExplicitAny: a chainable test double refers to itself.
    const self: any = Object.assign(result, {
      select: () => self,
      eq: (column: string, value: unknown) => {
        calls.push(`${table}.eq ${column}=${String(value)}`);
        return self;
      },
      is: (column: string) => {
        calls.push(`${table}.is ${column}`);
        return self;
      },
      order: () => self,
      maybeSingle: async () => ({
        data: Array.isArray(tables[table]) ? tables[table][0] : tables[table],
      }),
    });
    return self;
  };
  return {
    calls,
    from: chain,
    rpc: async (name: string) => ({
      data: name === "my_playlists" ? tables.my_playlists : null,
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("loadPlaylists", () => {
  it("maps the RPC rows and counts the liked songs that are not in the trash", async () => {
    const db = client(
      {
        my_playlists: [
          {
            id: "p1",
            name: "Sera",
            created_at: "c",
            updated_at: "u",
            song_count: 3,
          },
        ],
      },
      5,
    );
    const result = await loadPlaylists(db as never);
    expect(result).toEqual({
      playlists: [
        {
          id: "p1",
          name: "Sera",
          songCount: 3,
          createdAt: "c",
          updatedAt: "u",
        },
      ],
      likedCount: 5,
    });
    expect(db.calls).toEqual([
      "versions.eq liked=true",
      "versions.is trashed_at",
    ]);
  });

  it("is empty when there is nothing", async () => {
    expect(await loadPlaylists(client({}) as never)).toEqual({
      playlists: [],
      likedCount: 0,
    });
  });
});

describe("loadPlaylistPage", () => {
  it("builds the system playlist from the liked songs", async () => {
    mock.loadClips.mockResolvedValue([clip("b"), clip("a")]);
    const page = await loadPlaylistPage(
      client({}) as never,
      LIKED_ID,
      "Mi piace",
    );
    expect(mock.loadClips).toHaveBeenCalledWith(expect.anything(), 500, {
      liked: true,
    });
    expect(page?.system).toBe(true);
    expect(page?.playlist).toMatchObject({
      id: "liked",
      name: "Mi piace",
      songCount: 2,
    });
    expect(page?.clips.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("returns a playlist's songs in the stored order, leaving out the ones in the trash", async () => {
    const db = client({
      playlists: [
        { id: UUID, name: "Notte", created_at: "c", updated_at: "u" },
      ],
      playlist_items: [
        { version_id: "c", position: 1 },
        { version_id: "gone", position: 2 },
        { version_id: "a", position: 3 },
      ],
    });
    // loadClips answers in another order and without the trashed song.
    mock.loadClips.mockResolvedValue([clip("a"), clip("c")]);
    const page = await loadPlaylistPage(db as never, UUID, "Mi piace");
    expect(mock.loadClips).toHaveBeenCalledWith(expect.anything(), 3, {
      ids: ["c", "gone", "a"],
    });
    expect(page?.system).toBe(false);
    expect(page?.clips.map((c) => c.id)).toEqual(["c", "a"]);
    expect(page?.playlist).toMatchObject({
      id: UUID,
      name: "Notte",
      songCount: 2,
    });
  });

  it("is null for an id that is not a playlist of the caller", async () => {
    expect(await loadPlaylistPage(client({}) as never, UUID, "x")).toBeNull();
    expect(
      await loadPlaylistPage(client({}) as never, "not-a-uuid", "x"),
    ).toBeNull();
  });
});
