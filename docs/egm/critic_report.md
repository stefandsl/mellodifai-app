# EGM Stage 7 - Critic Review

Target: `docs/superpowers/specs/2026-10-31-mellodifai-design.md` (full file, v1 design).
Reviewers (fresh context, read-only, registered EGM adapters): `egm-design` and `egm-structural` against
`resources/document_standards/feature-spec-standard.md`; `egm-style` against its persona only.
Goldfish context: `docs/superpowers/plans/2026-10-31-mellodifai-platform.md` and this repo (design reviewer).
Date: 2026-10-31.

Verdict: the spec fails the feature-spec standard. 2 Blockers, 14 Major, 13 Nit after deduplication.
Reviewer tags: [D] design, [S] structural, [W] style.

## Blockers

1. **No "Alternatives Considered" section** [D][S]. Every choice in section 6 is stated as decided with no
   rejected option: Postgres jobs table vs pgmq / pg-boss / Inngest; PC worker vs Edge Functions for the
   network-only stages; local rendering vs Remotion Lambda or cloud GPU; Vercel + Supabase vs a local
   desktop app for one admin; Realtime vs polling; wrapping `yt.py` vs porting it; one song per language vs
   translating one master. Add the section with a concrete rejection reason for each.
2. **No "Risks & Mitigations" section** [D][S]. Risks are spread over sections 4, 5, 8 and 9. Add one table
   covering at least Majors 4-10 below.

## Major

1. **Section 9 item 2 mixes the superseded and the current Supabase decision** [D][S][W] (lines 153-160).
   The heading says "reuse" while the update says that is impossible; "Original plan" is still in the
   present tense; the free-plan limits sit inside the obsolete paragraph; a hand-spliced line wrap. Keep
   one current decision, move the rest to a dated history note.
2. **The spec has drifted from what was built** [D] (lines 3, 61, 85-89, 118, 159).
   - Still "draft for approval".
   - It says the worker starts at logon via Task Scheduler; it is started by hand.
   - It says the heartbeat keeps Supabase awake; a GitHub Actions ping does, and whether that counts as
     activity is unverified.
   - It calls the weekly `pg_dump` scheduled; it is a manual script.
   - It says images come from GPT Image with a kie fallback and include a cover; there is only a Pillow
     thumbnail.
   - It says 720p previews; they are 480p with a 15 MB cap.
   - It puts `art` after QA approval; `art.ts` itself sets `video_review`.

   Align the spec, or record each change as a ruling.
3. **Goals vs scope** [S] [D] (section 2 vs 9.1). The any-topic theme is "the largest piece of work in v1"
   but not in Goals, has no architecture (no scene-props schema, no validation, no section-to-scene
   mapping, a "jury pass" bar without a rubric), and plan 1 forces 80-line VBP packs. State the interim
   behaviour and give the theme its own design or milestone. (Now owned by the v2 studio brief.)
4. **Paid side effects with unknown outcome are not designed** [D] [W] (lines 33, 51, 83-84, 109, 136).
   "Never double-spends" and "stale jobs requeue and reuse outputs" cannot both hold across the window
   between kie accepting a request and the task id being saved (same for a YouTube upload before its video
   id is saved). The code invented `kie_submit_state`, a marker file, exit code 4, `resolve_kie_submission`,
   the pending-task guard and `upload_state`. The retry rule is also stated three different ways (lines
   51, 109, 136). Specify one at-most-once rule, the states, terminal vs free-retry outcomes and the
   operator reconciliation steps.
5. **No limit on poison jobs** [D] (lines 82-84; `requeue_stale`, `claim_job`). A job that crashes the
   worker is requeued forever and claimed first (oldest first) after every restart, blocking the only
   worker. Specify a maximum number of stale requeues, then `failed` with a retry option.
6. **Multi-tenancy is only in the data model** [D] (line 18; migrations 0009 line 15 and 0012).
   - Compute is one PC with serial stages: about 8-10 languages per hour for everyone.
   - Claiming is strict first-in-first-out.
   - There is one kie account and one YouTube API project (about 4 uploads a day in total).
   - `workers` RLS is owner-scoped, so a customer sees "offline".
   - `reserve_publication_upload` requires the worker owner to equal the render owner, which contradicts
     migration 0012.
   - There is no unit cost per song.

   Narrow the claim or add a v2 section.
7. **YouTube assumptions** [D] (lines 27-28, 57, 141-142). Unaudited API projects created after mid-2020
   may be forced to private, so `set_privacy` could be overridden: document the project's audit status. The
   quota counter on the worker row undercounts CLI uploads on the same project; treat `quotaExceeded` as a
   wait signal.
8. **Durability** [D] (lines 56, 88-89, 159). Masters, stems, paid take audio, workspaces and even the
   `pg_dump` backups live on one disk (E:), the backup is manual, previews are not backed up, there is no
   free-space or retention policy. Specify RPO/RTO, an off-machine copy, a cleanup policy.
9. **Auth and secret invariants are missing from the spec** [D] (lines 46, 80-81, 85-87).
   - Hosted signups must be off and email confirmation on (ledger Critical C1).
   - The redirect allowlist must be exactly the two production domains (a wildcard `*.vercel.app`
     allowed an admin takeover).
   - Child processes must not inherit the service-role key.
   - There is no key rotation procedure for a compromised PC.

   Write each as an invariant with a verification probe.
10. **Data model incomplete** [S] (lines 94-103). Admin allowlist, QA flags, the YouTube quota counter,
    the kie balance and the override record are required by the spec but absent, so the plan invented
    `admin_allowlist`, `qa_flags`, `workers.youtube_uploads_today` and `workers.kie_balance`.
11. **QA gates defined three times, inconsistently** [D][S][W] (lines 111-117, 116, 138-140).
    - Step 6 lists loudness, pace, stamp overshoot and the contact sheet.
    - Section 8 adds true peak, a "lyric gate" and crushed words.
    - A contact sheet is an image, not a check.
    - There are no tolerances: "loudness off" has none, and "pace vs target" names no target.
    - "Cut-off outro" has no gate.

    One table: gate, threshold, blocking or advisory, source.
12. **Undefined project terms** [W] (throughout). kie, VBP, OKBOT, hook, chant count, exclude, display map,
    danger-spot, stamp overshoot, lyric gate, cut sheet, contact sheet, jury, `produce_song`. Add a
    glossary.
13. **Unmeasurable claims** [W]. "a crash ... never loses work" (line 33; the in-progress stage is lost),
    "overrides it knowingly" (line 49; state the recorded override), "a calm, easy UI" (line 78), "a jury
    pass" with no criteria and "the largest piece of work" with no support (line 152).
14. **"The user" means two things** [W] (lines 3, 14, 22, 41, 55, 59). The admin vs any account in a
    multi-tenant design. Use "the admin" for the role.

## Nit

1. Free-plan budgets: 50 MB per-file limit (already blocked legacy hook previews of about 70 MB), 500 MB
   database with unbounded `job_events`, Realtime quotas, no pruning policy [D].
2. Em dash rule vs Russian/French typography: replace em dashes deterministically before validation
   instead of rejecting and retrying the LLM [D].
3. Render times and the 12-credit cost come from one VBP song; say so, and give USD per credit [D].
4. "One row per stage" list does not match the 11 `STAGES` (step 5 packs two, `set_privacy` and
   `import_legacy` missing) [S].
5. Section 9 answers questions that are never shown [S].
6. `lang_pipeline.sh` and "the mellodifai skill" have no path; no Markdown links, not even to the plan [S].
7. Inconsistent punctuation after bold lead-ins [S].
8. Diagram fence without a language tag, unnumbered H3s under numbered H2s [S].
9. Dates in three formats (`31/10/2026`, `31/10`, ISO); use ISO [S][W].
10. "Italian first, English second" is unclear and is a decision, not a builder item [S][W].
11. "production-quality" vs "production ready"; "Typed, linted, tested" without a bar [W].
12. "for hours per language", "~4/day", "cheap", "per-day cap" without values, "(~0.1 USD)" without a
    unit, "exactly as today" without a check, "Burning" for "Spending" [W].
13. Status labels conflict ("draft for approval" vs "(decided)" vs "the user can overrule"); "builder
    check" undefined [W].
