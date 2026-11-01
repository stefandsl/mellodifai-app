import type { SupabaseClient } from "@supabase/supabase-js";

import { type Clip, loadClips } from "./clips";

// One user playlist as the sidebar and the lists show it. songCount leaves out songs in the
// trash.
export type PlaylistInfo = {
  id: string;
  name: string;
  songCount: number;
  createdAt: string;
  updatedAt: string;
};

// "Mi piace" is a system playlist computed from the liked songs, not a stored one; this is its
// id in routes and menus.
export const LIKED_ID = "liked";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type PlaylistRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  song_count: number;
};

export async function loadPlaylists(
  supabase: SupabaseClient,
): Promise<{ playlists: PlaylistInfo[]; likedCount: number }> {
  const [{ data }, liked] = await Promise.all([
    supabase.rpc("my_playlists"),
    supabase
      .from("versions")
      .select("id", { count: "exact", head: true })
      .eq("liked", true)
      .is("trashed_at", null),
  ]);
  return {
    playlists: ((data ?? []) as PlaylistRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      songCount: row.song_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    likedCount: liked.count ?? 0,
  };
}

// A playlist page's data: its songs in order (songs in the trash are left out), or null when
// the playlist does not exist or is not the caller's.
export async function loadPlaylistPage(
  supabase: SupabaseClient,
  id: string,
  likedName: string,
): Promise<{ playlist: PlaylistInfo; clips: Clip[]; system: boolean } | null> {
  if (id === LIKED_ID) {
    const clips = await loadClips(supabase, 500, { liked: true });
    return {
      playlist: {
        id: LIKED_ID,
        name: likedName,
        songCount: clips.length,
        createdAt: "",
        updatedAt: "",
      },
      clips,
      system: true,
    };
  }
  if (!UUID.test(id)) return null;
  const { data: row } = await supabase
    .from("playlists")
    .select("id,name,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return null;
  const { data: items } = await supabase
    .from("playlist_items")
    .select("version_id,position")
    .eq("playlist_id", id)
    .order("position", { ascending: true });
  const order = ((items ?? []) as { version_id: string }[]).map(
    (item) => item.version_id,
  );
  const byId = new Map(
    (await loadClips(supabase, Math.max(order.length, 1), { ids: order })).map(
      (clip) => [clip.id, clip],
    ),
  );
  const clips = order.flatMap((songId) => {
    const clip = byId.get(songId);
    return clip ? [clip] : [];
  });
  return {
    playlist: {
      id: row.id as string,
      name: row.name as string,
      songCount: clips.length,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    },
    clips,
    system: false,
  };
}
