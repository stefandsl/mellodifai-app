# Task 10 report: playlists, details panel, search, share, procedural covers

Branch `build/studio-ui`. Plan: `feature-parity-plan.md` T10 and the T10 bullets of "Additions from the video".

## What was built

### Database (migration `20261101000019_playlists.sql`, applied locally and recorded)

- `playlists` (owner, name 1-100) and `playlist_items` (primary key `(playlist_id, version_id)`, so a song is in a list once;
  `position` is dense 1..n but not unique, so a reorder is one update). RLS: the owner can SELECT; `authenticated` has no
  INSERT/UPDATE/DELETE, every write is a security definer RPC that checks the owner.
- RPCs: `create_playlist` (trimmed name, at most 100 playlists per user), `rename_playlist`, `delete_playlist` (entries go, songs
  stay), `add_to_playlist` (appends in the given order; skips repeats, foreign songs and songs in the trash; returns how many were
  added), `remove_from_playlist` (returns how many left, renumbers), `reorder_playlist` (listed songs first in the given order, the
  rest keep their order after them, unknown ids ignored, so a stale list never loses a song), `my_playlists()` (song counts hide
  trashed songs, so they reappear on restore), `playlist_membership(uuid[])`.
- `versions.liked_at`, set by `set_reaction` (kept on a repeated like, cleared by dislike/none; backfilled from `updated_at`), so
  the "Mi piace" system playlist lists the newest like first. "Mi piace" itself is computed from `liked`, not stored.

### Web

- **Playlists**: `/playlists` (Mi piace first, then the user's, with a procedural cover each and "Nuova playlist"), `/playlists/[id]`
  and `/playlists/liked` (same page, `PlaylistView`): header tile, eyebrow PLAYLIST, inline rename, count, big play button that plays
  the list in order through the existing queue (songs without audio are skipped), numbered rows whose number becomes a play icon on
  hover, playing row highlighted, delete with confirmation. Rows: menu with details, queue, add to another playlist, share, move up /
  down, remove (with an Annulla that puts the song back in its place). Drag and drop on desktop, up/down in the menu everywhere.
  In "Mi piace" the heart (or the menu) unlikes with an undo toast and the row leaves; no rename, delete or drag.
- **Add to playlist** (`playlist-dialog.tsx`): from the card button, the card menu, the details panel and, for several songs, a
  new "Aggiungi a playlist" button in the select-mode toolbar. For one song a playlist that holds it shows a check and a click takes
  it out; for several, a click adds them all and reports "2 di 3 aggiunte". A new playlist can be made in the same window.
- **Sidebar**: Playlist and Cerca entries (also in the phone top bar, which now uses the compact logo), and from `xl` a list under
  the nav: Mi piace first, the playlists with counts, "+" and "Nuova playlist". The layout loads the list once (`loadPlaylists`) and
  refreshes it with the page data after each change.
- **Details panel** (`details-panel.tsx`, `store/details.ts`): a click on a card body (not on its buttons, links, menu or checkbox)
  opens it; "Dettagli canzone" in the menu opens it instead of navigating. Cover with play/pause and plays chip, title with rename and
  the card's menu, engine/model badge, language, status, queue position, created date, plays and likes, like/dislike, share, add to
  playlist, download, takes as chips (a chip plays that take as its own preview), style tags clamped to six with "+ altri N" and
  Copia, lyrics with Copia (Copiato for 2 s, toast if the clipboard refuses), "Apri pagina completa". A song being made shows its
  stage instead of the tools; a song waiting for a checkpoint shows its NextStep. Docked on the right from 1280 px, a bottom/side
  sheet below; Esc or X closes; open state and selection are remembered.
- **Tool extension point** (`lib/studio/song-tools.ts`): `registerSongTool({id, label, icon, order, available, run})` returns an
  unregister function; the panel shows the tools available for the song, sorted by `order`. Only "Riusa il prompt" is registered
  (T11-T13 buttons do not exist yet).
- **Search** (`/search`): one input, 200 ms debounce, searches title, style, lyrics and prompt of the user's songs plus playlist names,
  accent and case insensitive, every word must match. Songs (title matches first) and playlists in sections with counts; a result
  plays from its play button and opens the details panel when the row is clicked; Up/Down/Enter/Esc work from the input. Empty query:
  hint plus "Più ascoltate" and "Ultime create". "Nessun risultato per ..." when empty. The feed search uses the same matcher (now
  also lyrics and accent-insensitive).
- **Share window** (`share-dialog.tsx`, `lib/studio/share.ts`): copy link, WhatsApp, Telegram, X, Facebook, LinkedIn, Reddit (new
  tab, `noopener`), email (`mailto:`), plus the Web Share API button only when the browser has it. Opened from the card button and
  menu, the details panel and the listening view (which used to copy the link silently).
- **Procedural covers** (`lib/studio/cover-art.ts`): `artFor(id)` now picks one of six pure-CSS families (mesh, orbs, rays, waves,
  conic, blobs) from an FNV hash of the song id, in the brand's reds, oranges, pinks and violets over a deep ink; every layer is a
  gradient so a real cover still goes first in the same `background`. The playlist tiles use the same function.
- **Playing card**: tinted brand background, accent edge, brand title, `aria-current`, pause over the cover (card, playlist row,
  search row).
- `runAction` can return an explicit `id` (the new playlist) and revalidates the playlist and search paths.

## Tests

- DB `supabase/tests/playlists.test.ts` (14): RLS read, direct writes refused, foreign playlists untouched through every RPC, name
  rules, delete cascade keeps songs, the 100 cap, append order / skips, remove + dense positions, reorder rules, cascade on song
  deletion, `my_playlists` counts with trash/restore, membership, `liked_at`.
- Web (all new): `cover-art`, `share`, `search`, `song-tools`, `playlists` (loader), `store/details`, `playlists` actions,
  `share-dialog` (8), `playlist-dialog` (11), `details-panel` (39), `playlist-view` (28), `search-view` (16), `feed-details` (14: card
  click vs buttons, select mode, playing card, playlists and share from the feed, lyric search), `sidebar` (10), `playlists-index`
  (4). `now-playing.test.tsx` updated for the share window. `studio.test.ts` covers the new `loadClips` options.
- Results: `biome check` clean, `tsc -b` and `tsc --noEmit` clean, shared 32, worker 225 + 2 skipped, web 524, DB 89.
- Mutation check: 19 web and 8 SQL mutations (card click guard, selection rules, docking query, sheet `picked` rule, reorder
  payload and rollback, toggle-vs-add, debounce, ArrowUp wrap, AbortError, lyrics in the matcher, trash drop, tool order, trashed
  filters, owner check, renumber, `liked_at` keep, playlist cap...). Three survived at first and were fixed or removed: a test
  that never passed its `onDone`, an Esc guard that base-ui already makes redundant (removed), and one SQL mutation that is an
  equivalent mutant (`order by g.n` already puts NULLs last).

## Bugs found by looking and by the tests

- The persisted panel choice was erased on every load: a page's songs were registered in the same store, and that write ran before
  the panel read the saved value. The registry is now a separate, non-persisted store (and has a test with the page effect first).
- Up from "no highlight" in search jumped to the second result instead of wrapping to the last (found by a test).
- On a phone the remembered open state would have greeted the user with a sheet over the page at every load: a sheet now opens
  only for a song picked in the current visit; docked, the panel comes back as it was.
- With the create form beside the feed, docking the panel at 1280/1440 px crushed the feed rows. On `/create` the panel docks from
  1600 px (below it opens as a sheet); everywhere else from 1280 px.

## Visual check

Throwaway admin user (`e2e-t10-...@mellodifai.test`) with 7 songs (two with two real tone takes, likes, plays, one queued without a
job) seeded through the service role, driven with Playwright (a walk-through derived from `studio-shots.mjs`, since that script
cannot click) at 1440, 1280, 1920 and 390 px, dark and light; playlists were made through the UI. The user, its files and the helper
scripts were removed afterwards. No console errors. Screenshots (36) in `docs/egm/v2-local-engines/task-10-shots/`: feed with covers
(`01-*`), details panel docked and as sheet (`02-*`, `02b-*`), share (`03-*`), add to playlist (`04-*`, `05-*`), select mode (`06-*`),
playlists (`07-*`), a playlist, playing and reordered (`08-*` to `10-*`), Mi piace (`11-*`), search (`12-*` to `14-*`).

## Concerns and things not done

1. **Shared links need the owner's session.** Every page is behind the sign-in and there is no public song route, so a shared link only
   opens for someone who can sign in to the same account (the window says so). A public share route is a separate decision, as in T8.
2. **Search is in memory** over the 500 newest songs the page loads (same cap as the Library), not a database query; fine for this app's
   size, but a library beyond 500 songs would not be fully searched. "Recenti" (last played) is "Ultime create" because there is no
   last-played column.
3. **Details panel docks from 1600 px on /create** (1280 px elsewhere), a deliberate deviation from "1280 and up" in the replica prompt,
   because the create form already takes 450 px. Below that it is a sheet.
4. Likes in the panel are 0 or 1 (one user); the cover shows plays but no duration chip (the feed does not carry the duration).
5. Limits chosen: 100 playlists per user, 500 songs per add/remove call, 1000 per reorder call. There is no cap on songs per playlist.
6. The playlist membership read in the add window uses the browser Supabase client (`playlist_membership` RPC), not a server action.
7. The playlist tiles use a procedural cover of the playlist id, not a mosaic of its songs' covers.
8. Dislike is unchanged (T7 behaviour); the "Sources" block of the panel belongs to T12.
