# mellodifai plan, rewritten 01/11/2026: the app stays local

Decision (owner, 01/11/2026): for now mellodifai runs only on the owner's PC. No Vercel, no public
domain, no paying customers yet. Multi-tenant RLS stays in the code (it costs nothing and keeps the
door open), but nothing is deployed.

## What changes

Dropped for now (parked, not deleted):
- Vercel project, mellodifai.com DNS on Hostinger, hosted auth settings (Site URL, redirect allowlist).
- Supabase keep-alive repo secrets.
- Google + Microsoft OAuth sign-in and the "wait for approval" page (one local owner account is enough).
- YouTube OAuth consent "In production": "Testing" mode with the owner as test user is enough locally.

Kept:
- Local Supabase stack (supabase start) as the database, auth and storage. The hosted project
  gzxynoomfosktqrzukiw stays as it is, unused; decide later whether to keep or delete it.
- The PC worker (renders, ACE-Step, kie/Suno).
- YouTube publishing from the PC (private unless --confirm).

## Phase L1: one-click local app (first)

Goal: the owner double-clicks one icon and the app opens in the browser. No terminal.
1. A launcher (`Mellodifai.cmd` + desktop shortcut) that starts, in order: Docker Desktop if needed,
   `supabase start`, the worker, the web app (production build, `next start` on 127.0.0.1), then opens
   the browser. Plain Italian status window; a second click reuses what is already running.
2. A stop action that shuts everything down cleanly (worker, web, supabase stop).
3. Local auth: email + password for the owner; mail stays in Mailpit (no real inbox needed).
4. Backup: nightly-free manual "Esporta backup" (pg_dump + storage copy to E:\mellodifai\backup).
5. Apply migrations 00012+ locally; merge build/platform into main.
   Exit: cold PC to working app in one click, e2e 3/3, all unit suites green.

## Phase L2: merge the parallel branches

1. Finish the v2 studio UI on `build/studio-ui` (other session, studio brief).
2. Merge `feat/ace-step-native` on top: reconcile generate-song.ts and db.ts, keep migrations 016 and 017.
3. Drop the ComfyUI runtime from the v2-local-engines plan (owner chose no ComfyUI); YuE2 is parked.
   Exit: one branch, all suites + e2e green.

## Phase L3: ACE-Step for real

1. Real install from the official repo to E:\mellodifai\ace-step (about 15 GB).
2. Italian bake-off: 5 real topics, 2 takes each, ACE-Step vs kie, scored by ear + jury.
3. Timing chain: `workspace_pipeline.sh` tolerates a missing aligned file (Whisper fallback).
4. Hide the sliders ACE-Step ignores.
   Exit: an Italian ACE-Step song goes through lyrics, takes, timing and video in the app.

## Phase L4: ACE-Step UI ideas (reimplemented, not copied)

1. "Use this song as...": drag a take onto the create panel; Cover / Reference / Extend menu items.
2. Cost on the submit button ("2 canzoni, 4 versioni, 24 crediti" or "gratis"), variations count,
   "In coda #N" on waiting cards.
3. Library tools: inline rename, multi-select + bulk delete, filter chips (piaciuti, in corso).
4. Player: fullscreen "In riproduzione", speed, repeat-one, Media Session.
5. ACE-Step extras: seed, repaint a section, stems, more than 2 takes.

## Phase L5: any-topic video look (old plan 2)

The motion engine is hardwired to the LGTM song concept; make the theme driven by the song's topic.

## Later, when customers come

Bring back the parked items above (Vercel, DNS, hosted auth, OAuth providers, keep-alive), plus
billing. Nothing in L1-L5 blocks it.
