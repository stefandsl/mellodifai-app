# Task 7 report: Library likes, plays, rename, multi-select, trash, filters, queue position

Branch `build/studio-ui`. Plan: `feature-parity-plan.md` T7.

## What was built

Database (migration `20261101000018_library_reactions_trash.sql`, applied locally and recorded in
`supabase_migrations.schema_migrations`):

- `versions` gets `liked`, `disliked` (check: never both), `play_count`, `trashed_at`, `display_title`
  (1-100 chars). `authenticated` has SELECT only on `versions`, so all writes go through RPCs.
- Security definer RPCs, owner-checked through `web_version()`: `set_reaction(p_version, 'like'|'dislike'|'none')`,
  `count_play`, `rename_version` (trimmed, 1-100; `lyric_pack` is untouched), `trash_versions(uuid[])` and
  `restore_versions(uuid[])` (return the number of songs that really changed; foreign ids and songs already in
  the wanted state do not count; 1-500 ids).
- `my_queue_positions()`: for each of the caller's songs with a claimable queued job, 1 + the running jobs and the
  older claimable queued jobs of any owner (only the count crosses owners). Trashed songs do not appear or count.
- Worker guard: `claim_job` skips jobs of trashed versions (they stay queued and resume on restore; a running job
  finishes). `web_version()` now also refuses trashed versions, so no web checkpoint (approve, pick, render...)
  can advance a trashed song.

Web:

- Feed cards: like/dislike buttons (`aria-pressed`, optimistic, rolled back with an error toast on failure),
  inline rename (pencil on hover and always on touch screens; Enter saves, Esc or leaving the field cancels, error
  toast on failure), play count in the subtitle ("12 ascolti"), "In coda #N" badge (shown from #2), "Sposta nel
  cestino" in the "..." menu with an Annulla action in the toast.
- Toolbar: "Seleziona" toggle (checkboxes), "Seleziona tutto", "Deseleziona tutto", "Sposta nel cestino" with a
  toast "2 di 3 spostate nel cestino" on partial results. Only songs currently visible are acted on. Moved songs
  vanish at once and leave the player queue (`usePlayer.drop`).
- Filter chips and menu: Mi piace, In creazione, Solo audio (status `audio_ready`) next to the old ones.
- Library > Cestino (`/library?tab=trash`, link in the Library header): hidden songs with Ripristina (single and
  bulk), no playback or editing, explanatory note that the render PC does not work on them.
- Player bar: like/dislike for the playing song (synced with the cards through `store/reactions.ts`), and the play
  counter: one `count_play` per track after 30 s of real listening (`lib/studio/play-counter.ts`; seeking does not
  count, a repeat counts again). Take previews are neither likeable nor counted (`Track.reaction === null`).
- Italian (accents) and English strings in `lib/studio/i18n.ts`. `runAction` now forwards a `count`.

## Tests

- DB: `supabase/tests/library.test.ts` (11 tests): reaction exclusivity and table constraint, owner-only plays,
  direct owner writes refused, anonymous callers refused, rename rules, trash/restore counting and foreign ids,
  checkpoints blocked while trashed, `claim_job` guard and resume, queue positions (ahead count, trashed, per-user).
- Web: `library-controls.test.tsx` (like, rename Enter/Esc/failure, filters, plays/queue badge, select mode, partial
  toast, undo, menu trash, trash view, bulk restore, links), `player-bar.test.tsx` (like in the bar, no buttons for
  takes, 30 s count, no count for skips/previews), `play-counter.test.ts`, `library.test.ts` (actions),
  `studio.test.ts` (loadClips fields, trash query, filters, `drop`).
- Fixed a flaky assertion in `components/web-flow.test.tsx` (the confirm button re-enables after the toast).

## Visual check

Throwaway admin user seeded through the service role (songs in every state, a real 90 s tone, queued jobs held
with row locks so the live worker could not take them), driven with Playwright at 1440, 1024 and 390 px; user and
files removed afterwards. Real users' songs were not touched. Found and fixed: the grid checkbox hid the cover
title (moved to the bottom right), the phone row overlapped the "..." button (compact reaction buttons), grid
action rows were not aligned (bottom aligned). Verified live: play count went 12 -> 13 after 30 s of playback.

Screenshots in `docs/egm/v2-local-engines/task-7-shots/`.

## Not done / notes

- `purge_trash` (30 days, admin) from the plan was not built: it would hard-delete rows whose storage files stay
  behind, and it was not in the task's decisions. Trashed songs stay until restored.
- Queue positions refresh through the existing live refresh, which only fires for the user's own rows, so a
  position can lag when another user's job finishes (hourly refresh at worst).
