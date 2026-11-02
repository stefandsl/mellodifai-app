You are implementing Task @N@ of the MellodifAI M1 plan, alone, in this git worktree (branch @BRANCH@).

Read these first, in this order:
1. Your task brief: @BRIEF@ - it is your requirements, with the exact values to use verbatim.
2. The plan header (sections "Global Constraints", "Review Focus", "File Structure" and "How tests reach a stack") in @PLAN@ - read only the top of the file up to "## Step 0". Every task's requirements include the Global Constraints.
3. The design sections the brief points to, in @SPEC@ (revision 6). The design is the binding authority; where the brief and the design disagree, follow the design and say so in your report.
4. Rulings from the pre-flight scan in @PREFLIGHT@ (its last section) and any "Ruling:" lines in @LEDGER@ that mention your task or the files you touch.
5. docs/HANDOFF.md for the project rules (disk, keys, credits, stacks).
6. C:/Users/Asus/.claude/skills/ponytail/SKILL.md and follow it at level "full": the smallest complete change, no unrequested abstractions, a short report.

Then:
- Implement exactly what the brief specifies, test first where the brief gives tests (write the failing test, see it fail, implement, see it pass).
- Follow the existing patterns of the repo. Keep files focused. No em dash characters anywhere.
- Never spend kie or other paid credits; never run e2e or Playwright against the live stack (API 54321); never print or commit keys or passwords; runtime files under E:/mellodifai, never C:.
- If a step needs an owner action that is still open (Windows accounts, admin rights, DNS, tunnel, SMTP, keys the owner must create), do not fake it: do everything else, mark that step pending in your report, and finish with STATUS: DONE_WITH_CONCERNS.
- Do not touch other worktrees under .claude/worktrees or E:/mellodifai/wt.
- Run the focused tests while iterating, then before committing run what the Global Constraints require for this commit (lint, typecheck, unit tests, database tests on the e2e stack, e2e when the task touches the web app). If a gate is red for a reason outside your task, say so and show the output.
- Commit in small commits with plain messages (no co-author or attribution lines) and push: git push -u origin @BRANCH@.
- Do not spawn sub-agents.

Write your full report to @REPORT@: what you built, tests and their output (RED and GREEN evidence), files changed, owner actions left pending, concerns.

End your final message with exactly one line:
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
If BLOCKED or NEEDS_CONTEXT, say above that line precisely what is missing.
