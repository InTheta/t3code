#!/usr/bin/env bash
# Merge upstream (pingdotgg/t3code main) into this fork's main without losing fork work.
#
#   scripts/omni/sync-upstream.sh [--verify "<command>"] [--push]
#
# Safe by construction:
#   - never rebases, squashes, force-pushes or resets main; main only ever moves forward by a merge commit
#   - the merge happens on a throwaway branch sync/upstream-<UTC stamp>; main is untouched until verification passes
#   - on a conflict it aborts, leaves main alone and prints the conflicted files (exit 3)
#   - without --push it stops after verification and tells you the command to publish
# Requires: remotes `origin` (the fork) and `upstream`, a clean working tree, and main checked out.
set -euo pipefail

verify=""; push=0
while [ $# -gt 0 ]; do
  case "$1" in
    --verify) verify="${2:?--verify needs a command}"; shift 2 ;;
    --push) push=1; shift ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

git remote get-url upstream >/dev/null 2>&1 || { echo "no 'upstream' remote" >&2; exit 2; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "check out main first" >&2; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean; refusing" >&2; exit 2; }

git fetch -q origin main
git fetch -q upstream main
git merge-base --is-ancestor origin/main main || { echo "local main is behind or diverged from origin/main; update it first" >&2; exit 2; }
read -r ahead behind < <(git rev-list --left-right --count main...upstream/main)
echo "main is $ahead ahead and $behind behind upstream"
[ "$behind" -gt 0 ] || { echo "already up to date"; exit 0; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
branch="sync/upstream-$stamp"
git checkout -q -b "$branch" main
if ! git merge --no-ff --no-commit upstream/main >/dev/null 2>&1; then
  echo "CONFLICT merging upstream; main is untouched. Conflicted files:" >&2
  git diff --name-only --diff-filter=U >&2
  git merge --abort || true
  git checkout -q main
  git branch -D "$branch" >/dev/null
  exit 3
fi
git -c core.hooksPath=/dev/null commit -q --no-verify -m "Merge upstream pingdotgg/t3code main ($(git rev-parse --short=9 upstream/main)) [skip ci]"

# Workflows must stay identical to upstream: this fork does not run GitHub-hosted Actions.
if ! git diff --quiet upstream/main -- .github; then
  echo "warning: .github differs from upstream after the merge:" >&2
  git diff --stat upstream/main -- .github >&2
fi

if [ -n "$verify" ]; then
  echo "verifying: $verify"
  if ! bash -c "$verify"; then
    echo "verification FAILED on $branch; main is untouched. Inspect the branch, or delete it with: git branch -D $branch" >&2
    git checkout -q main
    exit 4
  fi
fi

if [ "$push" -eq 1 ]; then
  [ -n "$verify" ] || { echo "--push needs --verify" >&2; git checkout -q main; exit 2; }
  git push origin "$branch:main"                       # plain push: refused by GitHub unless it is a fast-forward
  git push origin upstream/main:refs/heads/upstream-main
  git checkout -q main
  git merge --ff-only "$branch"
  echo "published $(git rev-parse --short HEAD) to origin/main"
else
  git checkout -q main
  echo "ready: $branch contains the merge. To publish after checking it:"
  echo "  git push origin $branch:main && git push origin upstream/main:refs/heads/upstream-main && git merge --ff-only $branch"
fi