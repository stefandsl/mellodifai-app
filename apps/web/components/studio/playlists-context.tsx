"use client";

import { createContext, useContext } from "react";

import type { PlaylistInfo } from "@/lib/studio/playlists";

// The caller's playlists and how many songs are liked, loaded once by the app layout and
// refreshed with the page data after every change.
export type PlaylistsState = { playlists: PlaylistInfo[]; likedCount: number };

const EMPTY: PlaylistsState = { playlists: [], likedCount: 0 };
const Context = createContext<PlaylistsState>(EMPTY);

export function PlaylistsProvider({
  value,
  children,
}: {
  value: PlaylistsState;
  children: React.ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePlaylists(): PlaylistsState {
  return useContext(Context);
}
