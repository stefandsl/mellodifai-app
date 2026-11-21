**Spec:** Both requested plans are present and contain named implementation tests. Those runtime assertions are planned, not executed; the brief waives runtime and browser gates for this docs-only change.

**Critical:** none.

**Important:**

- [M2a plan:346](<E:/mellodifai/wt/plan-m2/docs/superpowers/plans/2026-11-03-m2a-remade-song.md:346>) tests the extended Copilot lyric jury as fail-closed, while design 10.1 keeps the existing lyric jury fail-open in a human-approved Copilot flow. **Status 2026-11-20: closed.** The M2a plan (Task 7, Step 3) and design 10.1 now state the rule once: fail-open in Copilot, fail-closed only in Autopilot (M5). The code is already fail-open (`apps/worker/src/stages/lyric-jury.ts`, test `passes through when no judge answered` in `apps/worker/test/lyric-jury.test.ts`). **Fix:** align the assertion and behavior with 10.1, or document and justify the divergence.
- [M2a plan:406](<E:/mellodifai/wt/plan-m2/docs/superpowers/plans/2026-11-03-m2a-remade-song.md:406>) gives `web_tool_begin` caller-supplied `p_items` but no prompt, duration, or validated intent from which SQL can verify the estimate. The claimed database cap check cannot reject an understated reservation before a paid call. **Status 2026-11-20: obsolete as a review row.** `web_tool_begin` exists in no code and no migration, only as plan text; the rule stays a requirement for whoever builds M2a Task 12 and is now written in that task. **Fix:** derive billed units from trusted bounded inputs and add a zero or understated-items refusal test.

**Minor:**

- [M2a plan:23](<E:/mellodifai/wt/plan-m2/docs/superpowers/plans/2026-11-03-m2a-remade-song.md:23>) contains mojibake around the M1 section title. **Status 2026-11-20: closed.** The BOM and the broken quotation marks are removed from the plan. **Fix:** replace it with plain quotation marks.

No em dash was found in either plan. Screenshots were waived for this docs-only work; C: has over 20 GB free.

VERDICT: REVISE