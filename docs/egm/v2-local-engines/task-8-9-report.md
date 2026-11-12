# Tasks 8 and 9 report: player and create panel

Branch `build/studio-ui`, commit `7699b73`. Plan: `feature-parity-plan.md` T8, T9 and the video additions.

## T8 Player

- **Repeat** cycles off, all, one (`store/player.ts`, `RepeatButton`). The old boolean "repeat" did a seek to 0 on an
  element that had already ended, so it never started again; repeat one now seeks and resumes (the bar plays again when a
  seek arrives while the store says playing), and the play counter resets so the repeat counts as a new play. Repeat all
  wraps to the first song, and a one-song queue restarts. Shuffle no longer picks the song that just ended.
- **Speed** 0.5x to 2x (menu in the bar from lg width and in the listening view), applied as `playbackRate` and
  `defaultPlaybackRate` (a new source resets the rate), stored in localStorage (`mellodifai-player`, speed only,
  rehydrated after mount like the create form, clamped on load).
- **Download** of the audio the player plays, as a link with the storage `download` parameter (the file lives on another
  origin, where the `download` attribute alone is ignored). Note: it is the 128 kbps mp3 preview the player plays, not the
  320 kbps master (that file stays on the PC).
- **Like/dislike** in the bar were already there from T7; the listening view reuses them (also while a take preview plays).
- **Listening view** (`components/studio/now-playing.tsx`): the title and the cover in the bar (and an expand button)
  open a full-screen dialog (base-ui Dialog: focus trap, Esc closes, close button, following "Apri il progetto" closes
  it). It shows the cover with a centred play/pause and an equaliser glyph, title, subtitle, date ("Creata il 4 febbraio
  2026"), the first 4 style phrases, takes as chips (a chip previews that take as its own track, the song's own take goes
  back to the song with like and counting), like/dislike, share (copies the link), download, link to the project, lyrics
  with muted section tags, and the full transport (seek, prev, play, next, shuffle, repeat, speed). Two columns on desktop,
  one scrolling column on phone. Tracks now carry an optional `detail` (lyrics, style, takes), set by `trackFor` and by the
  take previews of the approval window.
- **Link previews**: there is no public song route (every page needs the sign-in), so `generateMetadata` is on the project
  page: title, description (style), Open Graph `music.song` with cover and `og:audio`, Twitter card. Checked live (meta tags
  present with the song's title and audio). Because the page is behind the sign-in, the preview only appears where the reader
  is signed in; a public share route would be a separate decision.

## T9 Create panel

- **Settings** (`packages/shared/src/song-settings.ts`, all optional, Auto = absent): `bpm` 40-240, `keyscale` (the 34 keys
  the ACE-Step encoder accepts), `timeSignature` 2/3/4/6 (2/4, 3/4, 4/4, 6/8), `seed` (below 2^48, form limit leaves room
  for the extra songs of a click), `steps` 10-100 (default 30), `guidance` 1-15 in steps of 0.5 (default 7, the sampler cfg).
  Helpers: `musicTags`, `withMusicTags`, `styleWithout`, `readControls` (tolerant per-field reader).
- **Worker**: kie gets the chosen tempo, key and signature appended to the style written for `kie.mjs` ("120 BPM, D minor,
  3/4 time"; the stored lyric pack is not changed; tags that would overflow 1000 characters are dropped, never the user's
  words); YuE2 gets the same tags in its style input; ACE-Step gets `bpm`, `keyscale`, `timesignature` as text-encoder inputs,
  plus `steps` and `cfg` on the KSampler, and the same words in the drafted style are removed so the two never disagree.
  Auto keeps the old behaviour (tempo and key read from the style, 4/4, 30 steps, cfg 7). A fixed seed is take 1's seed and
  take 2 uses seed + 1 (saved in the job payload as before, stored on the takes). Out-of-range values in a hand-written
  project are ignored one by one.
- **Panel**: new "Parametri musicali" card (advanced mode, every engine): BPM EditableSlider whose minimum reads Auto,
  key select (Auto + 34 keys, "D minore" in Italian), time signature segmented. "Altre opzioni" gets Seed (local engines only:
  Casuale/Fisso, typed digits, dice) and "Esperto" (ACE-Step only: steps, guidance; opens by itself when a saved draft changed
  them). Hidden controls are hidden, not disabled (same rule as T5).
- **EditableSlider** replaces TickSlider everywhere (duration, weirdness, style influence, variety, BPM, steps, guidance): click the
  number to type, Enter commits, Esc cancels (and does not close a window around it), a blur commits, out-of-range values clamp
  and snap to the step, a decimal comma works, duration also reads "2:30", the minimum reads Auto where Auto exists (typing the
  minimum of BPM gives Auto).
- **Several songs per click**: a 1 to 4 control above the Create button, persisted. `createSong` takes `count` and calls
  `create_song` N times in one server action (so no migration and no DB change); a fixed seed goes up by 2 for each further song so
  no two share a seed. If a later call fails the already created songs stay and the panel says "Create 2 canzoni su 3". Button:
  "Crea" for one song, "Crea 3 canzoni · 36 crediti" or "Crea 3 canzoni · gratis" otherwise; the total is songs x languages
  (3 songs in 2 languages reads "Crea 6 canzoni · 72 crediti"), and the line above says kie charges when lyrics are approved.
  Local engines: "Gratis · 3 canzoni, una dopo l'altra, circa 18 minuti sul PC".
- **Clear buttons** on lyrics, styles, title, simple description and excluded styles, each clearing only its field with a 5 s
  "Annulla" toast (undo never overwrites text typed since). The lyrics "Nuova bozza" button with `window.confirm` is replaced by this.
- **Lyrics box** resizes by dragging a grip below it (or Up/Down/Home/End), 120-720 px, remembered.
- **Formatta con AI** (sparkle on the styles card, off with a tooltip while the styles are empty, spinner while working): rewrites
  the styles as a music prompt and fills BPM, key and time signature that are still on Auto, with a toast listing what changed and an
  "Annulla" that restores everything while the styles are untouched.
  - **Path chosen: a server action** (`app/actions/format-style.ts`), not a worker job. A worker job needs a table or a job without a
    version plus polling, and the worker may be asleep; a server action answers in 3 s. The key is read on the server only
    (`lib/openrouter-key.ts`: `LYRICS_OPENROUTER_KEY` then `OPENROUTER_API_KEY` from the process environment, else from the same
    env files the worker loads, listed in `WORKER_ENV_FILES`). It is never sent to the browser and never logged; the action returns
    only the formatted data. Model: `LYRICS_MODEL_FAST`, default `anthropic/claude-sonnet-5.5` (the lyric pipeline's fast writer). A
    signed-in user only, 20 calls per 10 minutes per user (in memory). The reply is validated (style cut to 1000, em dash replaced,
    privacy-filter tags refused, BPM range, key normalised to the ACE-Step spelling, only 2/4 3/4 4/4 6/8).
  - **To make it work**: on a deploy set `OPENROUTER_API_KEY` (or `LYRICS_OPENROUTER_KEY`) in the web environment. For local dev I added
    `WORKER_ENV_FILES=<the three paths of the README worker command>` to `apps/web/.env.local` (gitignored, paths only, no secret).
    Without a key the panel says "La formattazione con AI non è configurata su questo server."
  - Checked live once (one OpenRouter call): Italian input "sognante, voce femminile, sintetizzatori anni 80" gave an English tag list,
    BPM 100, A minor, 4/4.

## Tests

From the repo root: `npx biome check --write .` and `npx biome check .` clean, `npx tsc -b` clean, `tsc --noEmit` in apps/web clean,
`pnpm -r --if-present test`: shared 32, worker 225 passed + 2 skipped (was 216), web 353 (was 163 after T5; T7 added more). DB tests
75 passed (no migration: `create_song` is unchanged, settings are a jsonb the web action validates and the worker reads tolerantly).

New: `ui.test.tsx` (EditableSlider), `store/player.test.ts`, `player-bar.test.tsx` (+9: repeat, speed, download),
`now-playing.test.tsx` (21), `create-controls.test.tsx` (49: music card, seed, Esperto, slider typing, count and label, clear
buttons, grip, AI format), `app/actions/create-song.test.ts`, `format-style.test.ts`, `lib/openrouter-key.test.ts`,
`rate-limit.test.ts`, `ai-format.test.ts`, `now-playing.test.ts`, `song-metadata.test.ts`, `studio.test.ts` (payloads, draft repair),
`engines.test.ts`; worker `comfy.test.ts`, `local-engine.test.ts` (settings mapping, fixed seed, YuE2 tags), `stages.test.ts` (kie tags);
shared `song-settings.test.ts`. Mutation check: 11 mutations (time signature input, fixed seed + 1, kie tags, repeat one resume,
slider clamp, seed offset, AI fill-only-on-Auto, seed gated to local engines, download parameter, own take restore, songs x
languages total) each fail at least one test. The shuffle rule (never the same song) is covered by a 40-draw test that I did not mutate.

## Visual check

Throwaway admin user with one song and two real tone takes (seeded through the service role, removed afterwards with its files; no
job was created, so the live worker had nothing to run), Playwright at 1440 and 390 px in dark and light. Screenshots in
`E:\mellodifai\shots\task8-9\`: `create-kie-*`, `create-kie-music-*`, `create-ace-seed-expert-*` (desktop and phone, dark and light),
`create-lyrics-resized-bpm-typing-desktop-dark.png`, `library-player-*`, `player-speed-menu-desktop-*`, `now-playing-*` (desktop and
phone, dark and light), `ai\ai-format-desktop-dark.png`. Found and fixed while looking: the equaliser bars were not drawn in the first
run (the dev server had not compiled the new CSS yet; a second run shows them), nothing else needed changing.

## Notes and concerns

1. **Download is the preview file** (128 kbps) the player plays, not the master.
2. **Link previews need a public route** to unfurl for people who are not signed in; today only the project page has metadata.
3. **BPM 40 means Auto** (the slider's minimum), so 40 BPM itself cannot be chosen; the real range is 41-240.
4. **Repeat all with shuffle**: shuffle wins (it always moves on), as before.
5. **Fixed seed on "Genera di nuovo"**: a regeneration of the same project reuses the fixed seed, so with unchanged lyrics it gives the same
   songs. That is what a fixed seed means, but it may surprise.
6. The create panel is rendered twice below 900 px (hidden desktop copy plus the sheet), so element ids such as `more-title` and
   `music-title` repeat in the DOM; this existed before and I did not change it.
7. The in-memory limiter of the AI format counts per server instance; on Vercel serverless it is a guard against a runaway client, not a quota.
