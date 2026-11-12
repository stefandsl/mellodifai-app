# Task 5: engine choice in the studio

Date: 2026-11-01. Branch `build/studio-ui`, commit `7a0a56e`. Status: done.

## What the studio does now

- **Selector** (`components/studio/create/engine-select.tsx`): next to the language and model pills, shown only
  when `profiles.role = 'admin'`. Lists "Suno (kie)" always, then "ACE-Step · locale" and "YuE2 · locale" for each
  engine whose `workers.engines` entry has `installed: true`, whose `passedLangs` contains every language chosen in
  the form, and whose worker `last_seen` is at most 60 s old. Each row has a one-line description.
- **Controls per engine** (`engineControls` in `lib/studio/engines.ts`): kie shows everything. A local engine hides
  the model menu (header), exclude, weirdness, style influence and variety. ACE-Step keeps duration; YuE2 hides it
  too (the model stops on its own). Vocal gender, styles, lyrics and video stay.
- **Fallback**: when the selected local engine stops qualifying (PC offline, not installed, a language it has not
  passed was added) the form switches to kie, stores it, and shows one line under the header, for example
  "ACE-Step · locale non disponibile (PC offline): uso Suno (kie).". Someone who is not the admin gets the silent
  switch only. The line disappears when the admin picks an engine.
- **Payload**: `settings.engine` is always sent. For a local engine the payload leaves out model, exclude,
  weirdness, styleWeight and variety, and sends `duration` only for ACE-Step with a custom duration.
  `createSong` and the SQL `create_song` are unchanged.
- **Cost texts**: local songs read "Gratis · circa N minuti sul PC" with N = round(minutesPerAudioMinute x
  expected minutes), at least 1; expected minutes = the form duration (ACE-Step) else 3.5. YuE2 always uses 3.5.
  Without a worker report for the engine the text is "Gratis · sul PC" (no invented number).
  - `create.cost` under the Create button.
  - Approval window in the feed (`next-step.tsx`): cost line "YuE2 genera due versioni della canzone. Gratis · circa
    6 minuti sul PC." and the confirm button "Approva · gratis". The song's engine and duration come from
    `clip.settings`; the minutes come from the live worker row.
  - Song page (`projects/[id]`): lyric approval button and dialog, take picker and failed-generation "Genera di
    nuovo" button ("Genera di nuovo (gratis)" and "Gratis: il PC genera due versioni della canzone in circa N
    minuti."). The page passes `project.song_settings` to `ProjectWorkspace`.
  - Credits page: the kie figures stay as they are (they are the kie balance); the admin gets one extra line that
    ACE-Step and YuE2 are free and leave the balance alone.
- **Plumbing**: the shell now has one `WorkerProvider` (`components/studio/worker-state.tsx`) that polls the worker
  row every 15 s and provides `{ lastSeen, online, balance, engines, isAdmin, now }`; the sidebar reads it instead of
  polling on its own. The server layout reads `workers.engines` and passes `isAdmin` from the profile. The clock
  and the row are updated together, so a row about to be replaced is never judged against a newer clock.
- Form store: `engine` field (default kie, kept by Clear, localStorage-persisted without a version bump: old drafts
  simply have no value and the default applies).

## Files

New: `lib/studio/engines.ts` (parse, availability rules, labels, controls, cost), `components/studio/worker-state.tsx`,
`components/studio/create/engine-select.tsx`, `components/studio/create/use-engine.ts`.
Changed: `create-panel.tsx`, `more-options-card.tsx`, `next-step.tsx`, `lyric-editor.tsx`, `take-picker.tsx`,
`project-workspace.tsx`, `sidebar.tsx`, `studio-shell.tsx`, `store/create-form.ts`, `lib/studio/i18n.ts` (IT and EN
strings and a small `stf` for `{placeholders}`), `app/(app)/layout.tsx`, `credits/page.tsx`, `projects/[id]/page.tsx`.

## Tests

Gates from the repo root: `npx biome check --write .` and `npx biome check .` clean, `npx tsc -b` clean (it does
not cover the web tests, so I also ran `tsc --noEmit -p apps/web`: clean), `pnpm -r --if-present test`: shared 20,
worker 216 passed + 2 skipped, web 163 passed (was 115).

New web tests (48):
- `lib/studio/engines.test.ts` (17): parsing of the jsonb, the five availability rules (admin, installed, languages,
  60 s boundary, no languages yet), reasons, 3.5 min default, YuE2 ignoring the duration, rounding and the minimum 1,
  labels and plurals, controls per engine.
- `create-panel.test.tsx` (17): selector absent for non-admin, options listed, options dropped for not installed or
  language, payload with the chosen engine and without kie-only fields, kie default, hidden controls for ACE-Step and
  YuE2, controls back on kie, cost text for both engines, with a custom duration, in English, fallback for offline and
  for an added language, stale choice for a non-admin, fallback line cleared on a new choice.
- `next-step.test.tsx` (+5), `local-engine-text.test.tsx` (6), `credits/page.test.tsx` (2), `studio.test.ts` (payloads).
- Mutation check: six mutations (60 s window, `tuning` and `duration` flags, local flag in the approval window,
  fallback line, admin gate on the selector) each fail at least one test.

## Visual check

Dev server on :3000, the studio-shots script for `/create` at desktop, laptop and phone, plus a temporary
Playwright script (deleted) for the interactive states. To see the engines I set `workers.engines` in the local
database and seeded one `lyrics_review` project with `engine: yue2` for the stefandsl account; both were removed
and restored afterwards (`engines = {}`, test rows deleted, the other project's settings untouched).

Screenshots in `E:\mellodifai\shots\task5\`:
- `final-empty-engines\_create-desktop.png`, `_create-laptop.png`, `_create-phone.png`: the studio-shots script run with the real
  state (the worker row has no engines): admin sees the selector with Suno (kie) only.
- `base\_create-desktop.png`, `_create-laptop.png`, `_create-phone.png`: the same with both engines present.
- `states\01-desktop-engine-menu.png`, `02-desktop-ace-step-advanced.png`, `03-desktop-yue2-advanced.png`,
  `04-desktop-kie-advanced.png`, `05-desktop-fallback-line.png`, `06-phone-engine-menu.png`, `07-phone-yue2.png`,
  `08-desktop-approve-local.png`, `09-desktop-project-lyrics-local.png`, `10-desktop-project-approve-dialog-local.png`,
  `11-desktop-credits.png`.

Fixed after looking: the first fallback text wrapped to two lines at 420 px (shortened to one line); the credits note
left "kie." alone on a line (`text-balance`); the header row wraps cleanly at laptop width when three pills do not fit.

## Notes and concerns

1. **A live local worker overwrites `last_seen` every few seconds** on the local database, so the 60 s staleness could
   not be shown by editing `last_seen` (the fallback shot uses `installed: false` instead). The offline path is
   covered by the unit test with a stale `lastSeen` and by the 60 s boundary test.
2. **Admin with no qualifying local engine** (for example the production worker not restarted yet, `engines = {}`)
   still sees the selector, with Suno (kie) as the only row. I kept it, since the rule says shown to the admin and kie
   is always listed; hiding it when there is nothing to choose is a one-line change if you prefer it.
3. **Freshness granularity**: the page checks `last_seen` against the clock of the last poll (15 s), so a worker that
   went quiet is noticed within 60 to 75 s, and the 15 s poll is slower than the heartbeat by design.
4. **Estimate for ACE-Step Auto** uses 3.5 minutes as decided, while the worker's real length follows the lyric
   pack (120 to 300 s). A 60 s custom duration shows "circa 1 minuto" (the minimum is 1).
5. Legacy `dialog.cost` / `action.approveGeneration` in `packages/shared` are untouched; the local variants live in
   the studio dictionary and only the song page components switch to them for a local song.
6. `docs/` is untracked (as for the earlier reports), so this report is not part of the commit.
