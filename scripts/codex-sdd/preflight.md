Pre-flight conflict scan of an implementation plan before execution starts. You are read-only: do not modify files or git state.

Plan: @PLAN@ (47 tasks). Design (binding authority): @SPEC@ revision 6. Read the plan in full and the design where a task points to it. Check the real repo where a task names existing files, scripts, ports or migration numbers.

Produce tables, not a verdict:
1. One row for every pair of tasks that share a file or an interface: the two tasks, what one produces vs what the other consumes (names, signatures, paths, env vars, ports, migration numbers), match or mismatch.
2. One row for every task: does its own text agree with itself (tests vs code, files created vs touched later, commands that exist or are created earlier)?
3. Findings: contradictions between tasks, with the design or with the Global Constraints; mandated things a reviewer would call a defect; false assumptions about the existing repo.

End with a section "## Rulings" - one numbered line per finding with the smallest fix, decided with the design as the authority, written as an instruction the implementer of the named task must follow ("Task 12: ...").

Your whole reply is the document (it is saved to @OUT@).
