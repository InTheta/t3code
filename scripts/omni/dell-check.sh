#!/usr/bin/env bash
# Dell check for the T3 Code fork: the checks upstream's ci.yml runs on hosted runners, run on Dell instead.
#
#   scripts/omni/dell-check.sh [ref]            check origin's `ref` (default: main), print and record the result
#   scripts/omni/dell-check.sh [ref] --status   also post one commit status (context dell/checks) to the fork
#
# Needs T3_SRC: a Dell workspace holding env.sh (the Vite+ toolchain) and a git checkout at $T3_SRC/repo or any
# worktree of the fork; the check runs in its own throwaway worktree under T3_SRC so installs and caches stay on the
# Toshiba build disk. Never touches another worktree. Results: $T3_SRC/checks/<sha>.json and .log.
#
# Steps: install, format, typecheck, lint, unit tests. Test files that already fail on upstream main are listed in
# scripts/omni/known-test-failures.txt and reported separately, so a new failure is never hidden by an old one.
set -uo pipefail
ref="main"; post=0
for arg in "$@"; do case "$arg" in --status) post=1;; *) ref="$arg";; esac; done
: "${T3_SRC:?set T3_SRC to the Dell workspace that holds env.sh}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
gh_home="$HOME"; gh_xdg="$XDG_CONFIG_HOME"  # env.sh may move HOME; gh must keep using the real login
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/mnt/dell-workloads/builds/playwright-browsers}"
here="$(cd "$(dirname "$0")" && pwd)"
anchor="$(ls -d "$T3_SRC"/repo "$T3_SRC"/wt-* 2>/dev/null | head -n 1)"
[ -n "$anchor" ] || { echo "no checkout under $T3_SRC" >&2; exit 2; }
git -C "$anchor" fetch -q origin || { echo "fetch failed" >&2; exit 2; }
sha="$(git -C "$anchor" rev-parse --verify --quiet --end-of-options "origin/$ref^{commit}" || git -C "$anchor" rev-parse --verify --end-of-options "$ref^{commit}")" || exit 2
short="${sha:0:10}"; out="$T3_SRC/checks"; mkdir -p "$out"
work="$T3_SRC/wt-check-$short"; log="$out/$short.log"; : > "$log"
git -C "$anchor" worktree add -q --detach "$work" "$sha" 2>>"$log" || { echo "worktree failed" >&2; exit 2; }
trap 'git -C "$anchor" worktree remove --force "$work" >/dev/null 2>&1' EXIT
# shellcheck disable=SC1091
. "$T3_SRC/env.sh"
cd "$work" && export PATH="$PWD/node_modules/.bin:$PATH"
known="$work/scripts/omni/known-test-failures.txt"
declare -A result
step() { # name command...
  local name="$1"; shift; echo "== $name" >>"$log"
  if "$@" >>"$log" 2>&1; then result[$name]=pass; else result[$name]=fail; fi
  echo "$name: ${result[$name]}"
}
step install vp i
step format vp fmt --check
step typecheck vp run typecheck
step lint vp lint
step tests vpr test
test_log="$out/$short.tests.log"
sed -n '/^== tests$/,$p' "$log" | sed 's/\x1b\[[0-9;]*m//g' >"$test_log"
failed="$(sed -nE 's/^[[:space:]]*FAIL[[:space:]]+([[:alnum:]_-]+[[:space:]]+(\([^)]*\)[[:space:]]+)?)?([^[:space:]]+\.test\.[mc]?[jt]sx?).*/\3/p' "$test_log" | sort -u)"
new="$failed"
if [ -f "$known" ]; then new="$(comm -23 <(printf '%s\n' "$failed" | sort -u) <(sort -u "$known"))"; fi
failed_files="$(awk '/^[[:space:]]*Test Files[[:space:]]+[0-9]+ failed/ { total += $3 } END { print total+0 }' "$test_log")"
if [ "$failed_files" -gt 0 ] && [ -n "$failed" ] && [ -z "$new" ] &&
   [ "$failed_files" -eq "$(printf '%s\n' "$failed" | wc -l)" ] &&
   ! grep -Eq '^[[:space:]]*Errors[[:space:]]+[1-9][0-9]* error' "$test_log" &&
   [ "${result[tests]}" = fail ]; then
  result[tests]="pass-with-known-failures"
fi
overall=success; for k in install format typecheck lint tests; do case "${result[$k]}" in pass|pass-with-known-failures) ;; *) overall=failure;; esac; done
{
  printf '{"sha":"%s","ref":"%s","finishedAt":"%s","overall":"%s"' "$sha" "$ref" "$(date -u +%FT%TZ)" "$overall"
  for k in install format typecheck lint tests; do printf ',"%s":"%s"' "$k" "${result[$k]}"; done
  printf ',"newTestFailures":%s}\n' "$(printf '%s\n' "$new" | sed '/^$/d' | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().split()))')"
} >"$out/$short.json"
cat "$out/$short.json"
if [ "$post" = 1 ]; then
  HOME="$gh_home" XDG_CONFIG_HOME="$gh_xdg" gh api "repos/InTheta/t3code/statuses/$sha" -f state="$overall" -f context="dell/checks" \
    -f description="install ${result[install]}, typecheck ${result[typecheck]}, lint ${result[lint]}, tests ${result[tests]}" >/dev/null && echo "status posted"
fi
[ "$overall" = success ]