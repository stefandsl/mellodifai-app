#!/usr/bin/env bash
# Codex-driven plan execution: one Codex implementer per plan task, one read-only
# Codex reviewer per task, up to 3 fix rounds, progress in a ledger that survives restarts.
# Usage (from the repo or worktree root, Git Bash):
#   bash scripts/codex-sdd/run.sh [FIRST_TASK] [LAST_TASK]
# Re-running is safe: tasks with a "Task N: complete" ledger line are skipped.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
PLAN="${PLAN:-docs/superpowers/plans/2026-11-02-m1-agent-access.md}"
SPEC="${SPEC:-docs/superpowers/specs/2026-11-01-agentic-studio-design.md}"
NAME="$(basename "$PLAN" .md)"
W="$ROOT/.superpowers/sdd/$NAME"
LEDGER="$W/progress.md"
FIRST="${1:-1}"
LAST="${2:-$(grep -oE '^### Task [0-9]+' "$PLAN" | awk '{print $3}' | sort -n | tail -1)}"
# Tasks that touch production or rotate live credentials wait for the owner (see docs/HANDOFF.md).
OWNER_GATE="${OWNER_GATE:-33 34 47}"
MAX_ROUNDS="${MAX_ROUNDS:-3}"
TIMEOUT="${CODEX_TIMEOUT:-5400}"
CODEX="${CODEX:-codex}"
BRANCH="$(git branch --show-current)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$W"
[ -f "$LEDGER" ] || printf '# SDD ledger - plan: %s\n' "$PLAN" > "$LEDGER"
log() { printf '%s\n' "$*" | tee -a "$LEDGER"; }

brief() { # task text from "### Task N:" up to the next task or section heading
  awk -v n="$1" '
    $0 ~ "^### Task "n":" {on=1; print; next}
    on && (/^### Task [0-9]+:/ || /^## /) {exit}
    on {print}' "$PLAN"
}

thread_of() { grep -o '"thread_id":"[^"]*"' "$1" | head -1 | cut -d'"' -f4; }

codex_write() { # prompt-file out-last json-out
  timeout "$TIMEOUT" "$CODEX" exec --sandbox danger-full-access -C "$ROOT" --json \
    -o "$2" "$(cat "$1")" < /dev/null > "$3" 2> "$3.err"
}
codex_resume() { # thread prompt-file out-last json-out
  timeout "$TIMEOUT" "$CODEX" exec resume "$1" -c sandbox_mode="danger-full-access" --json \
    -o "$3" "$(cat "$2")" < /dev/null > "$4" 2> "$4.err"
}
codex_read() { # prompt-file out-last json-out
  # The Windows read-only sandbox kills Codex's tool host ("code-mode host exited during
  # handshake"), so reviewers run with access and are held to read-only by their prompt;
  # any commit or tracked change they leave is undone here.
  local before tree; before="$(git rev-parse HEAD)"; tree="$(git status --porcelain --untracked-files=no)"
  timeout "$TIMEOUT" "$CODEX" exec --sandbox danger-full-access -C "$ROOT" --json \
    -o "$2" "$(cat "$1")" < /dev/null > "$3" 2> "$3.err"
  if [ "$(git rev-parse HEAD)" != "$before" ] || [ "$(git status --porcelain --untracked-files=no)" != "$tree" ]; then
    log "Warning: read-only reviewer changed the tree ($1); restored to ${before:0:7}"
    [ -z "$tree" ] && git reset -q --hard "$before" || git reset -q --soft "$before"
  fi
}

package() { # base head out
  { git log --oneline "$1..$2"; echo; git diff --stat "$1..$2"; echo; git diff -U10 "$1..$2"; } > "$3"
}

review() { # N base head round -> sets VERDICT
  local n=$1 base=$2 head=$3 r=$4 pkg="$W/task-$1-diff-r$4.patch" out="$W/task-$1-review-r$4.md"
  package "$base" "$head" "$pkg"
  sed -e "s#@N@#$n#g" -e "s#@BRIEF@#$W/task-$n-brief.md#g" -e "s#@REPORT@#$W/task-$n-report.md#g" \
      -e "s#@DIFF@#$pkg#g" -e "s#@PLAN@#$PLAN#g" -e "s#@SPEC@#$SPEC#g" -e "s#@OUT@#$out#g" \
      "$HERE/reviewer.md" > "$W/task-$n-review-prompt.md"
  codex_read "$W/task-$n-review-prompt.md" "$out" "$W/task-$n-review-r$r.jsonl"
  VERDICT="$(grep -oE 'VERDICT: (APPROVED|REVISE)' "$out" 2>/dev/null | tail -1 | cut -d' ' -f2)"
  [ -n "$VERDICT" ] || VERDICT=REVISE
}

if [ ! -s "$W/preflight.md" ]; then
  log "Preflight: running"
  sed -e "s#@PLAN@#$PLAN#g" -e "s#@SPEC@#$SPEC#g" -e "s#@OUT@#$W/preflight.md#g" "$HERE/preflight.md" > "$W/preflight-prompt.md"
  codex_read "$W/preflight-prompt.md" "$W/preflight.md" "$W/preflight.jsonl"
  log "Preflight: written to $W/preflight.md (rulings in its last section bind every task)"
fi

for n in $(seq "$FIRST" "$LAST"); do
  grep -q "^Task $n: complete" "$LEDGER" && continue
  if [[ " $OWNER_GATE " == *" $n "* ]]; then
    grep -q "^Task $n: owner gate" "$LEDGER" || log "Task $n: owner gate - production step, waits for the owner (docs/HANDOFF.md)"
    continue
  fi
  brief "$n" > "$W/task-$n-brief.md"
  [ -s "$W/task-$n-brief.md" ] || { log "Task $n: no such task in plan"; continue; }
  BASE="$(git rev-parse HEAD)"
  log "Task $n: started at ${BASE:0:7} $(date -u +%FT%TZ)"
  sed -e "s#@N@#$n#g" -e "s#@BRIEF@#$W/task-$n-brief.md#g" -e "s#@REPORT@#$W/task-$n-report.md#g" \
      -e "s#@PLAN@#$PLAN#g" -e "s#@SPEC@#$SPEC#g" -e "s#@PREFLIGHT@#$W/preflight.md#g" \
      -e "s#@LEDGER@#$LEDGER#g" -e "s#@BRANCH@#$BRANCH#g" \
      "$HERE/implementer.md" > "$W/task-$n-impl-prompt.md"
  codex_write "$W/task-$n-impl-prompt.md" "$W/task-$n-impl-last.txt" "$W/task-$n-impl.jsonl"
  THREAD="$(thread_of "$W/task-$n-impl.jsonl")"
  STATUS="$(grep -oE 'STATUS: [A-Z_]+' "$W/task-$n-impl-last.txt" 2>/dev/null | tail -1 | cut -d' ' -f2)"
  HEAD="$(git rev-parse HEAD)"
  if [ "$STATUS" = BLOCKED ] || [ "$STATUS" = NEEDS_CONTEXT ] || [ "$HEAD" = "$BASE" ]; then
    log "Task $n: stopped - status ${STATUS:-none}, head ${HEAD:0:7}; see $W/task-$n-impl-last.txt"
    exit 2
  fi
  [ -n "$(git status --porcelain --untracked-files=no)" ] && log "Task $n: warning - uncommitted tracked changes left by implementer"
  r=1; FIXBASE="$BASE"
  review "$n" "$BASE" "$HEAD" "$r"
  while [ "$VERDICT" != APPROVED ] && [ "$r" -le "$MAX_ROUNDS" ]; do
    log "Task $n: review round $r REVISE - $W/task-$n-review-r$r.md"
    FIXBASE="$(git rev-parse HEAD)"
    printf 'The task reviewer asked for changes. Read %s and fix every Critical and Important finding (Minor ones too when cheap). Re-run the tests that cover what you changed, append a fix report to %s (what changed, tests run, command, output), commit, push, and end with the same STATUS line.\n' \
      "$W/task-$n-review-r$r.md" "$W/task-$n-report.md" > "$W/task-$n-fix-r$r-prompt.md"
    if [ -n "$THREAD" ]; then
      codex_resume "$THREAD" "$W/task-$n-fix-r$r-prompt.md" "$W/task-$n-fix-r$r-last.txt" "$W/task-$n-fix-r$r.jsonl"
    else
      cat "$W/task-$n-impl-prompt.md" "$W/task-$n-fix-r$r-prompt.md" > "$W/task-$n-fix-r$r-full.md"
      codex_write "$W/task-$n-fix-r$r-full.md" "$W/task-$n-fix-r$r-last.txt" "$W/task-$n-fix-r$r.jsonl"
    fi
    r=$((r+1))
    review "$n" "$BASE" "$(git rev-parse HEAD)" "$r"
  done
  HEAD="$(git rev-parse HEAD)"
  git push -q -u origin "$BRANCH" 2>>"$W/push.err" || log "Task $n: push failed (see $W/push.err)"
  if [ "$VERDICT" = APPROVED ]; then
    log "Task $n: complete (commits ${BASE:0:7}..${HEAD:0:7}, review clean after $r review(s))"
  else
    log "Task $n: complete (commits ${BASE:0:7}..${HEAD:0:7}, PARKED - open findings in $W/task-$n-review-r$r.md; final review must triage)"
  fi
done
log "Run finished for tasks $FIRST-$LAST at $(date -u +%FT%TZ)"
