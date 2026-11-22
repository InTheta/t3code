#!/usr/bin/env bash
# Merge pingdotgg/t3code main into InTheta/t3code main with a normal merge commit.
# Never rebases, squashes or force-pushes. Fork main moves only when typecheck, lint and format pass on the merged result.
# On any conflict or failure the sync branch is left local and a status file says why; main is untouched.
set -uo pipefail
ROOT=${T3_SYNC_ROOT:-/mnt/dell-workloads/builds/workspaces}
SRC=${T3_SYNC_SOURCE:-$ROOT/codex-test-t3code-upstream-sync-xv8xl4w3}    # holds toolchain (env.sh) and the clone
STATE=${T3_SYNC_STATE:-$HOME/.local/state/t3code-sync}; mkdir -p "$STATE"
STATUS=$STATE/last-status.json
G=(git -c user.name=InTheta -c user.email=17220028+InTheta@users.noreply.github.com)
say() { printf '%s\n' "$*"; }
finish() { printf '{"at":"%s","result":"%s","detail":"%s"}\n' "$(date -u +%FT%TZ)" "$1" "${2//\"/\'}" > "$STATUS"; say "$1: $2"; exit "${3:-0}"; }

[ -d "$SRC/repo/.git" ] || finish error "source clone missing" 2
cd "$SRC/repo"
git fetch -q origin && git fetch -q upstream || finish error "fetch failed" 2
# Tidy this script's own leftovers: worktrees kept after a conflict or failure, once they are 3 days old (the branches stay).
git worktree prune
git worktree list --porcelain | sed -n 's/^worktree //p' | grep -E '/t3code-sync-[0-9]{8}-[0-9]{4}$' | while read -r old; do
  [ -d "$old" ] && [ -n "$(find "$old" -maxdepth 0 -mtime +3)" ] && git worktree remove --force "$old" 2>/dev/null
done
BEHIND=$(git rev-list --count origin/main..upstream/main)
[ "$BEHIND" -gt 0 ] || finish up-to-date "fork main is not behind upstream"

# Remember how each conflict was resolved so the same conflict never needs a person twice (shared by all worktrees).
git config rerere.enabled true; git config rerere.autoupdate false
STAMP=$(date +%Y%m%d-%H%M); BR=sync/upstream-$STAMP; WT=$ROOT/t3code-sync-$STAMP
git worktree add -q -b "$BR" "$WT" origin/main || finish error "worktree failed" 2
cd "$WT"
BUDGET=apps/server/src/provider/agentContextBudget.json
if ! "${G[@]}" merge --no-ff --no-commit upstream/main >/dev/null 2>&1; then
  FILES=$(git diff --name-only --diff-filter=U | tr '\n' ' ' | sed 's/ $//')
  if [ "$FILES" = "$BUDGET" ]; then
    # Generated size file that both sides edit: take upstream's, then set it to the value its own test measures.
    git checkout --theirs "$BUDGET" && git add "$BUDGET"
    . "$SRC/env.sh"; export PATH="$WT/node_modules/.bin:$PATH"
    vp i >"$STATE/install.log" 2>&1 || finish failed "install failed while resolving the budget file (branch $BR kept)" 1
    # Use the task runner (vpr): right after an install, plain `vp test run` reports "no tests" (vitest cannot find its suite) until a task-runner run has happened.
    # The first cold vitest run sometimes reports "no tests"; retry until a run actually executes the suite.
    for _try in 1 2 3; do
      (cd apps/server && vpr test src/provider/AgentContextBudget.test.ts >"$STATE/budget.log" 2>&1) || true
      grep -q "Tests " "$STATE/budget.log" && ! grep -q "no tests" "$STATE/budget.log" && break
      sleep 3
    done
    python3 - "$BUDGET" "$STATE/budget.log" <<'PY' || finish failed "could not read the measured budget (branch $BR kept)" 1
import json, re, sys
path, log = sys.argv[1], sys.argv[2]
text = re.sub(r"\x1b\[[0-9;]*m", "", open(log, errors="ignore").read())
measured = dict(re.findall(r'^\+\s+"(\w+)":\s*(\d+),?$', text, re.M))
budget = json.load(open(path))
if not measured:
    sys.exit(0)  # already matches
budget.update({k: int(v) for k, v in measured.items() if k in budget})
json.dump(budget, open(path, "w"), indent=2); open(path, "a").write("\n")
PY
    git add "$BUDGET"
    (cd apps/server && vpr test src/provider/AgentContextBudget.test.ts >"$STATE/budget2.log" 2>&1) || finish failed "budget file still wrong after regenerating (branch $BR kept)" 1
  elif [ -z "$(git rerere remaining 2>/dev/null)" ] && [ -n "$(git rerere status 2>/dev/null)" ]; then
    # Every conflicted file was resolved by a recorded earlier resolution: stage them and carry on to the gates.
    git add -A
  else
    git merge --abort 2>/dev/null
    finish conflict "needs a person: $FILES (branch $BR kept local, main untouched)" 1
  fi
fi
"${G[@]}" commit -q -m "Merge upstream pingdotgg/t3code main into fork [skip ci]

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" || finish error "commit failed" 2
# .github must stay identical to upstream
if ! git diff --quiet upstream/main -- .github; then finish workflow-drift ".github differs from upstream (branch $BR kept, main untouched)" 1; fi

. "$SRC/env.sh"; export PATH="$WT/node_modules/.bin:$PATH"
vp i >"$STATE/install.log" 2>&1 || finish failed "install failed, see $STATE/install.log (branch $BR kept)" 1
vp run typecheck >"$STATE/typecheck.log" 2>&1 || finish failed "typecheck failed (branch $BR kept)" 1
vp lint --report-unused-disable-directives >"$STATE/lint.log" 2>&1 || finish failed "lint failed (branch $BR kept)" 1
vp fmt --check >"$STATE/fmt.log" 2>&1 || finish failed "format check failed (branch $BR kept)" 1

# Plain (fast-forward) push of main: refuses automatically if main moved meanwhile. No force.
git push -q origin "HEAD:refs/heads/main" 2>"$STATE/push.log" || finish failed "push of main refused, see $STATE/push.log (branch $BR kept)" 1
git push -q origin "HEAD:refs/heads/$BR" 2>/dev/null || true
NEW=$(git rev-parse --short HEAD)
cd "$SRC/repo" && git worktree remove --force "$WT" 2>/dev/null
finish merged "upstream merged ($BEHIND commits), main now $NEW"
