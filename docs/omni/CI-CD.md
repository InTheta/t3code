# CI/CD for the T3 Code fork (InTheta/t3code)

Goal: the fork stays mergeable with `pingdotgg/t3code`, every change is checked on exact commits, and a Windows build can be produced and installed on request. `.github/` stays byte-identical to upstream so a sync never conflicts.

## Where each job runs

| Job | Where | How it is started |
|---|---|---|
| Install, format, typecheck, lint, unit and browser tests | **Dell** (`scripts/omni/dell-check.sh <ref>`) | By hand, or `--status` to post one commit status `dell/checks` on the exact commit |
| Upstream sync | **Dell** user timer `t3code-sync-upstream` (every 6 hours) | Timer; opens an issue and leaves `main` untouched if a merge conflicts |
| Linux install | **Dell** (`scripts/omni/build-cli-mirror.sh`) | By hand |
| Windows installer | **GitHub-hosted** `windows-fork-qualification.yml`, on a branch named `qualification/windows-<date><letter>` only | Push the branch (previous qualification branch + merge of `main`, trigger renamed). Never a pull request, never a schedule |
| macOS installer | Not built. Needs a Mac runner | Parked |

Upstream's own workflows (`ci.yml`, release, mobile, previews) use paid third-party runners the fork does not have. They are **not edited**. They are switched off in the repository's Actions settings (a setting, not a file change, so syncing is unaffected). `windows-fork-qualification.yml` lives only on qualification branches.

## Rules

1. Merge commits only. Never force-push, rebase or squash `main`. Merge tips carry `[skip ci]`.
2. A change merges only after `dell-check.sh` is green on its exact head (or only baseline failures listed in `scripts/omni/known-test-failures.txt` remain).
3. A Windows build is requested on purpose, from a merged `main`. Its artifact is downloaded to Dell, checksum-verified, then copied to Windows and installed with `Install-T3Omni.ps1`. Installers are never built on Windows.
4. No self-hosted runner on this repository: it is a public fork, so a pull request could run code on the runner. Revisit only if the repository becomes private.

## Rollback

Windows: reinstall the previous `download-<date><letter>` folder (its checksums are kept). Sidecar: relink the previous release directory and restart `omni-symphony-sidecar-http`. `main`: revert commit, never rewrite history.