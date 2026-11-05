# Goldfish Annotated Review Report

**Target:** `docs/superpowers/specs/2026-10-31-mellodifai-design.md` (full file, lines 1-160)
**Source:** `docs/egm/critic_report.md` (Stage 7: egm-design [D], egm-structural [S], egm-style [W]).
**Elephant context:** the v2 studio brief (`docs/superpowers/specs/2026-10-31-studio-brief.md`, 2026-10-31)
now supersedes plan 2 and the multi-user parts of this design. Fixes below make this document an accurate
record of v1 as built, and hand forward-looking items to the v2 design instead of designing them here.

Tally: 22 PROPOSE FIX, 2 ESCALATE, 0 CONTEST, 7 DECLINE.

## Escalated (need the admin's knowledge)

### [E1] [`egm-design`] - Severity: High (Major 7, first half)

-   **Affected Scope:** [Lines 141-142](../superpowers/specs/2026-10-31-mellodifai-design.md#L141-L142) (§8 YouTube)
-   **Discrepancy Description:** YouTube forces uploads from unaudited API projects created after mid-2020 to private; `set_privacy` to public could be silently overridden.
-   **Rationale:** The audit status of the Google Cloud project that `publish/yt.py` uses is not documented.
-   _**AI Suggestion:**_ ESCALATE
-   _**Justification:**_ Only the admin knows whether that Google project passed the YouTube API compliance audit, or whether a video made public through it actually stayed public. No file in the repo records it.
-   _**Proposed Edit:**_ none until the admin answers; then one sentence in §8 YouTube stating the audit status.

### [E2] [`egm-design`] - Severity: High (Major 8, destination part)

-   **Affected Scope:** [Lines 56, 88-89, 159](../superpowers/specs/2026-10-31-mellodifai-design.md#L56)
-   **Discrepancy Description:** All paid assets and the database backups live on one disk (E:).
-   **Rationale:** One disk failure loses paid take audio, masters and the off-site database copy together.
-   _**AI Suggestion:**_ ESCALATE (the off-machine destination), PROPOSE FIX for the rest (see F11)
-   _**Justification:**_ Where the off-machine copy goes (OneDrive, Google Drive, an external disk, a paid bucket) is the admin's choice and cost.
-   _**Proposed Edit:**_ after the answer, name the destination in the Durability row of the new Risks table.

## Prioritized Findings & AI Suggestions

### [F1] [`egm-design`, `egm-structural`] - Severity: High (Blocker 1)

-   **Affected Scope:** §6 Architecture (lines 63-92)
-   **Discrepancy Description:** No "Alternatives Considered" section.
-   **Rationale:** The standard requires rejected options with reasons.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Justification:**_ Valid. The reasons exist (session decisions) but were never written.
-   _**Proposed Edit:**_ new section "6.3 Alternatives considered" with one row per choice: Postgres jobs table vs pgmq / pg-boss / Inngest (rejected: an extra service or extension for one worker, while SKIP LOCKED on a table is enough and testable locally); PC worker vs Edge Functions for network-only stages (rejected: secrets would live on Supabase, and stages would be split across two runtimes); local vs cloud rendering (rejected for v1 on cost; v2 adds a `Renderer` adapter with cloud as a later option, per the studio brief); local desktop app vs Vercel + Supabase (rejected: the admin wants phone access and v2 is a web product); Realtime vs polling (Realtime chosen, with a 5 s poll fallback while jobs run, as built); port `yt.py` to Node vs wrap it (wrap: it is proven on 11 uploads, and porting OAuth adds risk); one master lyric translated vs one song per language (per language: each language gets its own singable lyrics).

### [F2] [`egm-design`, `egm-structural`] - Severity: High (Blocker 2)

-   **Affected Scope:** whole document
-   **Discrepancy Description:** No "Risks & Mitigations" section.
-   **Rationale:** Risks are scattered over §4, §5, §8, §9.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Justification:**_ Valid.
-   _**Proposed Edit:**_ new section "10. Risks and mitigations", a table with rows: paid call with unknown outcome (F4), poison job (F5), single PC (jobs wait; badge shows offline; v2 Renderer adapter), single disk (F11 + E2), auth misconfiguration at deploy (F9), free-plan limits (Nit N1 budgets), YouTube quota and audit (E1, F12), service key on a consumer PC (rotation steps in the README).

### [F3] [`egm-design`, `egm-structural`, `egm-style`] - Severity: High (Major 1)

-   **Affected Scope:** §9 item 2 (lines 153-160)
-   **Discrepancy Description:** Superseded and current Supabase decisions mixed.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Justification:**_ Valid; a reader cannot tell which sentences bind.
-   _**Proposed Edit:**_ heading becomes "Supabase: a fresh free project". Body: current decision (project `gzxynoomfosktqrzukiw`, eu-central-1, free plan, local Docker Supabase for development and CI), then the free-plan constraints as built (1 GB storage and 50 MB per file, so previews are 480p and capped at 15 MB; a daily GitHub Actions keepalive ping; a manual `pg_dump` script `apps/worker/scripts/backup.ps1`). One dated history line: "2026-10-31: the old MellodifAI project could not be restored (paused more than 400 days)."

### [F4] [`egm-design`] - Severity: High (Major 2)

-   **Affected Scope:** lines 3, 61, 85-89, 118, 159
-   **Discrepancy Description:** The spec drifted from what was built.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Justification:**_ Valid; each drift is a recorded user ruling or a build fact.
-   _**Proposed Edit:**_ Status line: "v1 built 2026-10-31; this document records v1 as built. v2: see the studio brief." Worker: "started by hand (user's choice 2026-10-31; no scheduled task)". Images: "v1 thumbnail = `tools/make_thumb.py`; generated art moves to v2". Previews: "480p, at most 15 MB". Pipeline order: `art` runs before the video-review checkpoint. Keepalive and backup as in F3.

### [F5] [`egm-structural`, `egm-design`] - Severity: High (Major 3)

-   **Affected Scope:** §2 vs §9.1 (lines 20-35, 148-152)
-   **Discrepancy Description:** The any-topic theme is in §9 but not in Goals, has no architecture, plan 1 forces 80-line VBP packs.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Justification:**_ Valid; the studio brief now owns this scope.
-   _**Proposed Edit:**_ §9.1 becomes: "Any topic, new look: moved to v2 (studio brief, video modes §6). In v1 every new project uses the VBP theme: 80 sung lines, office-satire visuals, whatever the topic." Goal 1 gains "(v1: VBP theme only)".

### [F6] [`egm-design`, `egm-style`] - Severity: High (Major 4)

-   **Affected Scope:** lines 33, 51, 83-84, 109, 136
-   **Discrepancy Description:** Paid side effects with an unknown outcome are not designed; the retry rule is stated three ways.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Justification:**_ Valid; the protocol exists in code (migrations 0007, 0010, 0011; `generate-song.ts`; `publish.ts`).
-   _**Proposed Edit:**_ new subsection "6.4 Paid and public side effects (at most once)", stated once and referenced from §2, §4, §6 and §8:
    -   kie: `kie_submit_state` is set to `submitting` before the call, then the task id is saved (`submitted`).
    -   A refusal before kie charged (exit 4, or an HTTP error on the credit or createTask call) clears the marker and can be retried for free.
    -   Any other failure after the call is terminal "submission state unknown". The admin checks the kie dashboard and records the task id or "not charged" (`resolve_kie_submission`).
    -   `wait` exit 2 means the task failed; 1 or 3 means still pending, and Retry is free.
    -   YouTube follows the same pattern with `upload_state` (reserve, upload, confirm) and "check YouTube Studio" for the unknown case.

    Lines 51, 109 and 136 then say only "see 6.4".

### [F7] [`egm-design`] - Severity: High (Major 5)

-   **Affected Scope:** lines 82-84
-   **Discrepancy Description:** No cap on stale requeues: a job that crashes the worker loops forever and is claimed first.
-   _**AI Suggestion:**_ PROPOSE FIX (design) + code task
-   _**Justification:**_ Valid; `requeue_stale` (migration 0002 line 123) has no attempts limit.
-   _**Proposed Edit:**_ Queue bullet adds: "A job requeued after a lost worker 3 times becomes `failed` with 'worker lost 3 times'; the version shows Retry." Code fix tracked separately.

### [F8] [`egm-design`] - Severity: High (Major 6)

-   **Affected Scope:** line 18; migrations 0009 line 15, 0012
-   **Discrepancy Description:** Multi-tenancy exists only in the data model; compute, kie account, YouTube project and worker status are single-tenant; `reserve_publication_upload` contradicts migration 0012.
-   _**AI Suggestion:**_ PROPOSE FIX (narrow the claim) + code task
-   _**Justification:**_ Valid. v2 design work belongs to the studio brief.
-   _**Proposed Edit:**_ line 18 becomes: "v1 makes data and access rules multi-tenant (`owner_id` and RLS everywhere). Compute (one PC), the kie account, the YouTube project and quotas stay single-tenant; the v2 studio brief redesigns them (credits ledger, Renderer adapter, per-user workspaces)." The owner-equality check in `reserve_publication_upload` is a code fix for when non-admin owners exist.

### [F9] [`egm-design`] - Severity: Medium (Major 7, second half)

-   **Affected Scope:** line 142
-   **Discrepancy Description:** The quota counter undercounts CLI uploads on the same Google project.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ "the counter is a lower bound: CLI uploads on the same project are not counted, so a `quotaExceeded` error from YouTube also defers the job to the next Pacific midnight."

### [F10] [`egm-design`] - Severity: High (Major 9)

-   **Affected Scope:** lines 46, 80-81, 85-87
-   **Discrepancy Description:** Deploy-time auth and secret invariants missing.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ new list "Security invariants (each with its check)":
    -   Hosted signups off and email confirmation on. Check: an anonymous signUp probe must fail.
    -   Redirect URLs exactly `https://mellodifai.com/**` and `https://www.mellodifai.com/**`, never a `*.vercel.app` wildcard. Check: dashboard review before the first sign-in.
    -   Engine child processes get no secrets. Check: a worker test asserts the child env.
    -   Service-role key rotation if the PC is compromised. Check: README procedure.

### [F11] [`egm-design`] - Severity: High (Major 8, rest)

-   **Affected Scope:** lines 56, 88-89, 159
-   **Discrepancy Description:** No RPO/RTO, no retention policy for E:.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ Durability row:
    -   RPO 1 week for the database (weekly `backup.ps1`), 0 for chosen take audio once copied off-machine (destination per E2).
    -   RTO: restore the dump into a fresh Supabase project.
    -   E: retention: unchosen takes and workspaces of deleted projects may be pruned; chosen takes, masters and the published hook are kept.

### [F12] [`egm-structural`] - Severity: Medium (Major 10)

-   **Affected Scope:** §6 data model (lines 94-103)
-   **Discrepancy Description:** Allowlist, QA flags, quota counter, kie balance, override record missing.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ add `admin_allowlist (email)`; `versions.qa_flags`, `generation_count`, `kie_submit_state`, `kie_task_id`, `render_attempt`; `workers.kie_balance`, `youtube_uploads_today`, `youtube_quota_day`; `renders.qa_override_reason`; `publications.upload_state`.

### [F13] [`egm-design`, `egm-structural`, `egm-style`] - Severity: Medium (Major 11)

-   **Affected Scope:** lines 111-117, 138-140
-   **Discrepancy Description:** QA gates defined three times, inconsistently, without thresholds.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Justification:**_ Valid. Built gates (`apps/worker/src/stages/qa.ts` lines 90-103): integrated loudness -15 to -13 LUFS, true peak at or below -1 dBTP, crushed words = 0, video duration within 0.5 s of timing.
-   _**Proposed Edit:**_ one table in §8, "QA gates (as built)", plus the gates not built yet: pace, stamp overshoot, chant count and outro via `clip_whisper.py`, marked "planned". §6 steps 3 and 6 point to it. "Contact sheet" is an artifact, not a gate.

### [F14] [`egm-style`] - Severity: Medium (Major 12)

-   **Affected Scope:** throughout
-   **Discrepancy Description:** Undefined project terms.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ a glossary after §1, one line each:
    -   **kie:** a third-party Suno API reseller with its own credit balance.
    -   **VBP:** "Va bene, passa", the first song and its office-satire theme.
    -   **OKBOT:** the VBP robot mascot.
    -   **take:** one of the two songs Suno returns per generation.
    -   **hook:** the 9:16 short clip, about 30 s.
    -   **lyric pack:** title, lyrics, style, exclude, settings, display map, l10n.
    -   **display map:** on-screen text fixes, applied as regex to the sung text.
    -   **chant count:** the number of chant repeats Suno sings before the Final Chorus.
    -   **danger-spot:** a known place where Suno often deviates from the lyrics.
    -   **stamp overshoot:** an on-screen stamp that runs past its line.
    -   **cut sheet:** the storyboard scene list.
    -   **jury:** an LLM panel that scores a render.
    -   **the mellodifai skill:** the Claude skill that drives the same engine from chat.

### [F15] [`egm-style`] - Severity: Medium (Major 13)

-   **Affected Scope:** lines 33, 49, 78, 152
-   **Discrepancy Description:** Unmeasurable claims.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_
    -   line 33: "a crash loses at most the stage in progress, never kie credits (6.4)".
    -   line 49: "until the admin records an override with a reason (stored on the render)".
    -   line 78: "easy UI: every checkpoint is one screen with one primary action".
    -   line 152: removed by F5.

### [F16] [`egm-style`] - Severity: Medium (Major 14)

-   **Affected Scope:** lines 3, 14, 22, 41, 55, 59
-   **Discrepancy Description:** "the user" means two things.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ "the admin" for the role everywhere; "user" only for accounts in general.

### [F17] [`egm-design`] - Severity: Low (Nit 2)

-   **Discrepancy Description:** Rejecting em dashes makes Russian and French drafts fail.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Justification:**_ Worth it: a draft retry costs money and the fix is deterministic.
-   _**Proposed Edit:**_ §5: "LLM output has em dashes replaced by ' - ' before validation; the validator still rejects them in admin-edited text." Code task.

### [F18] [`egm-structural`, `egm-style`] - Severity: Low (Nit 9)

-   **Discrepancy Description:** Dates in three formats.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ ISO dates throughout (applied with the other edits).

### [F19] [`egm-structural`] - Severity: Low (Nit 4)

-   **Discrepancy Description:** The stage list does not match the 11 `STAGES`.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ list `render_master` and `render_hook` separately, and add `set_privacy` and `import_legacy`.

### [F20] [`egm-structural`] - Severity: Low (Nit 6)

-   **Discrepancy Description:** `lang_pipeline.sh` and the skill have no path; no link to the plan.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ "`lang_pipeline.sh` (`E:\suno-remake-render\out\`, outside the engine repo; ported as `tools/workspace_pipeline.sh`)", the skill path `~/.claude/skills/mellodifai/SKILL.md`, and links to the plan and the studio brief.

### [F21] [`egm-structural`, `egm-style`] - Severity: Low (Nit 10)

-   **Discrepancy Description:** "Italian first, English second" is unclear and is a decision.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ move to §5: "UI in Italian (default) and English; system copy written in Italian first."

### [F22] [`egm-style`] - Severity: Low (Nit 13)

-   **Discrepancy Description:** Status labels conflict; "builder check" undefined.
-   _**AI Suggestion:**_ PROPOSE FIX
-   _**Proposed Edit:**_ covered by the F4 status line; §8 heading becomes "Builder's calls (made during the build; the admin can overrule)".

## Declined (Nits recorded, not fixed)

-   N1 free-plan budgets beyond the 50 MB / 15 MB facts already in F3: budgets for `job_events` growth and Realtime quotas move to the v2 design.
-   N3 render times and cost come from one VBP song: true, low value for an as-built record.
-   N5 §9 answers questions not shown: the answers are self-explanatory once F5 and F3 rewrite them.
-   N7 punctuation after bold lead-ins, N8 diagram fence tag and H3 numbering: cosmetic.
-   N11 "production-quality" vs "production ready", test bar: the bar is the green CI suite.
-   N12 vague quantities ("hours per language", "cheap", "~0.1 USD"): low value once F13 and F6 land.
