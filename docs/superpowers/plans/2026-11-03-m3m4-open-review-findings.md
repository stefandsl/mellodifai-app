**Spec:** Both requested plans are committed and pushed. Read-only checks found 12 M3 tasks and 11 M4 tasks, each with Files, Interfaces, fixture assertions and five steps. The plans contain no em dash characters. The brief exempts runtime tests and screenshots for this docs-only workstream; those tests are specified for implementation, not claimed as run here.

**Critical:** none.

**Important:**

- [M3 plan:87](E:/mellodifai/wt/plan-m3m4/docs/superpowers/plans/2026-11-03-m3-visual-quality.md:87): A timed-out Midjourney submission is marked ambiguous, but the router contract does not forbid trying the next route. Design 8.6 requires the run to stop pending reconciliation. **Status 2026-11-20: obsolete as a review row.** No Midjourney route, kie Midjourney adapter or `midjourney_video_claims` table exists in code or migrations; the rule stays a requirement for whoever builds M3 Task 3. **Fix:** Specify `ambiguous_spend` as a terminal router result and assert zero downstream calls after an uncertain kie submission.
- [M3 plan:134](E:/mellodifai/wt/plan-m3m4/docs/superpowers/plans/2026-11-03-m3-visual-quality.md:134): R6 limits attached scene assets, while the router saves all four Midjourney outputs; this can exceed the design’s eight *generated images* per video. **Status 2026-11-20: obsolete as a review row.** No Midjourney code exists, so no candidates are saved; the count rule stays a requirement for M3 Tasks 3 and 6. **Fix:** Count every provider-generated candidate against the eight-image limit and test the count across shots and thumbnail requests.
- [M4 plan:96](E:/mellodifai/wt/plan-m3m4/docs/superpowers/plans/2026-11-03-m4-publishing.md:96): Veto conflicts as soon as dispatch wins the lock, before an external flip or handoff. A crash at that point leaves private media that the owner cannot veto, contrary to 12.2. **Fix:** Keep veto available through a pre-submission intent and test a crash and veto before provider handoff.

**Minor:** none.

VERDICT: REVISE