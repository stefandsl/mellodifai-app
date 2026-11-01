"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { NewPlaylistDialog } from "../new-playlist-dialog";
import { LikedTile, PlaylistArt } from "../playlist-art";
import { usePlaylists } from "../playlists-context";
import { StudioPage } from "../studio-shell";
import { countLabel } from "./playlist-view";

// The list of all playlists: "Mi piace" first, then the user's own, and a way to make a new one.
export function PlaylistsIndex() {
  const lang = useLocale();
  const { playlists, likedCount } = usePlaylists();
  const [creating, setCreating] = useState(false);
  const tile =
    "group flex flex-col gap-2 rounded-2xl p-2.5 outline-none hover-glass focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
  return (
    <StudioPage
      title={st(lang, "pl.heading")}
      eyebrow={st(lang, "nav.playlists")}
      actions={
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="bg-cta inline-flex h-10 items-center gap-2 rounded-full px-5 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          <Plus className="size-4" />
          {st(lang, "pl.new")}
        </button>
      }
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <li>
          <Link href="/playlists/liked" className={tile}>
            <LikedTile className="aspect-square w-full rounded-xl" />
            <span className="px-0.5">
              <span className="block truncate font-medium">
                {st(lang, "pl.liked")}
              </span>
              <span className="text-[13px] text-[var(--fg-muted)]">
                {countLabel(lang, likedCount)}
              </span>
            </span>
          </Link>
        </li>
        {playlists.map((list) => (
          <li key={list.id}>
            <Link href={`/playlists/${list.id}`} className={tile}>
              <PlaylistArt
                id={list.id}
                className="aspect-square w-full rounded-xl ring-1 ring-[var(--hairline)]"
              />
              <span className="px-0.5">
                <span className="block truncate font-medium">{list.name}</span>
                <span className="text-[13px] text-[var(--fg-muted)]">
                  {countLabel(lang, list.songCount)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {playlists.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-[var(--hairline)] p-8 text-center text-[var(--fg-muted)]">
          {st(lang, "pl.listEmpty")}
        </p>
      ) : null}
      <NewPlaylistDialog open={creating} onOpenChange={setCreating} />
    </StudioPage>
  );
}
