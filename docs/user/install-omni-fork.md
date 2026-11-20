# Install this fork

This is the InTheta fork of T3 Code. It adds the Delivery page, managed-run evidence and isolated approval on top of upstream. Upstream's install commands (`t3.codes`, Homebrew, winget, the `.deb` on pingdotgg's Releases page) install upstream, not this fork. Use the commands here for the fork.

## One command

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/InTheta/t3code/main/scripts/omni/install.sh | sh
```

Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/InTheta/t3code/main/scripts/omni/install.ps1 | iex
```

Each script finds the latest fork release, downloads the installer for your system, checks it against the SHA-256 in the release's `SHA256SUMS`, and installs it. A file that does not match is never installed. To read a script before running it, open the URL in a browser.

| System | What it installs | Where |
| --- | --- | --- |
| macOS arm64, x64 | `T3 Code (Beta).app` from the DMG | `/Applications`, or `~/Applications` if that is not writable |
| Linux x64 | The AppImage, a `t3code-desktop` link and an application-menu entry | `~/.local/share/t3code-omni`, `~/.local/bin` |
| Windows x64 | The NSIS installer, run silently, per user, no administrator rights | `%LOCALAPPDATA%\Programs` and the Start menu |

Linux arm64 and Windows arm64 builds are not published. Windows on ARM runs the x64 installer under emulation.

Each release also carries a Linux `.deb`. The install script does not use it and CI does not install-test it; install it yourself with `sudo apt install ./T3-Code-<version>-linux-x64.deb` if you prefer a package.

## First launch

Fork builds are not signed or notarized, because the fork has no Apple Developer ID or Windows signing certificate.

- **macOS.** The script installs with `curl`, which does not mark the app as downloaded from the internet, so Gatekeeper normally does not block it. If macOS still says the app cannot be opened, right-click it in Applications, choose Open, then Open.
- **Windows.** SmartScreen may show "Windows protected your PC" the first time. Choose More info, then Run anyway.
- **Linux.** The AppImage uses a static runtime that does not need `libfuse2`. It has been unpacked in CI but not yet launched on a real Linux desktop (see "What is and is not verified"), so first-launch behaviour, such as Electron sandbox restrictions on newer Ubuntu releases, is untested.

## Replaces upstream's desktop app

The fork's desktop app uses the same app id and product name as upstream's. Installing it replaces an installed upstream desktop app and shares its data folder. Quit T3 Code before running the script. On macOS the script refuses to replace a running app. On Windows the installer may fail while the app is open, and the script then reports the installer's exit code.

The upstream `t3` command-line install (`scripts/install.sh`, `scripts/install.ps1`) is separate and unchanged. It still installs upstream's CLI.

## Options

Set these environment variables before the command.

| Variable | Effect |
| --- | --- |
| `OMNI_T3_VERSION` | Install an exact version, for example `0.1.9-omni.1`, instead of the latest |
| `OMNI_T3_DRY_RUN=1` | Print what would be installed and stop |
| `OMNI_T3_INTERACTIVE=1` | Windows: show the installer window instead of installing silently |
| `OMNI_T3_REPO` | Read releases from another repository |
| `OMNI_T3_BASE_URL` | Install from a mirror, as an https URL or a local folder laid out like `releases/download` |

For example, `OMNI_T3_VERSION=0.1.9-omni.1 sh install.sh` on Linux or macOS, and `$env:OMNI_T3_VERSION = "0.1.9-omni.1"; irm ... | iex` on Windows.

## How a release is made

Releases come from [`.github/workflows/release-fork.yml`](../../.github/workflows/release-fork.yml), which is separate from upstream's `release.yml` and leaves it untouched.

1. Merge the change to `main`.
2. Tag the commit and push the tag. The version is `<upstream base>-omni.<n>`:

   ```bash
   git tag v0.1.9-omni.1
   git push origin v0.1.9-omni.1
   ```

3. The workflow builds each installer on a GitHub-hosted runner, then installs every one on a clean runner of the same system by running the public install script against the built files. Only if all four installs pass does it publish a GitHub Release marked latest, with `SHA256SUMS`.

To build and test without publishing, run **Fork release** from the Actions tab and enter a version. That run builds and install-tests, then stops. Its installers stay downloadable from the run for 14 days.

A tag is published only if its commit is already on `main`.

## What is and is not verified

The release workflow installs each build and checks that the app is present, that the macOS app passes `codesign --verify`, and that the Linux AppImage unpacks. It does not launch the app: the runners have no display. A launch check on a real desktop of each system is a separate step and is not part of this workflow.

## Files owned by the fork

These files exist only in the fork, so upstream syncs do not conflict with them: `.github/workflows/release-fork.yml`, `scripts/omni/`, and this page. The only edit to an upstream file is the "Install this fork" section in `README.md`.
