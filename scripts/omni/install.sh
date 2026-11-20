#!/bin/sh
# One-command installer for the InTheta T3 Code fork desktop app (macOS and Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/InTheta/t3code/main/scripts/omni/install.sh | sh
#
# It downloads the latest fork release, checks the SHA-256 listed in the
# release's SHA256SUMS, then installs the app:
#   macOS  copies the .app from the DMG to /Applications (or ~/Applications)
#   Linux  puts the AppImage in ~/.local/share/t3code-omni, links
#          ~/.local/bin/t3code-desktop and adds an application-menu entry
#
# The upstream CLI installer (scripts/install.sh) is separate and still installs
# upstream's `t3` command. This script installs the desktop app of the fork.
#
# Environment:
#   OMNI_T3_VERSION     exact version to install, for example 0.1.9-omni.1
#   OMNI_T3_REPO        GitHub repository to read releases from (default: InTheta/t3code)
#   OMNI_T3_BASE_URL    release mirror, as an https URL or a local directory laid out
#                       like releases/download (default: GitHub)
#   OMNI_T3_DRY_RUN=1   resolve and print what would be installed, then stop
#   OMNI_T3_PREFIX      Linux: folder for the AppImage
#   OMNI_T3_BIN_DIR     Linux: folder for the t3code-desktop link (default: ~/.local/bin)
#   OMNI_T3_OS, OMNI_T3_ARCH   override detection (tests only)
set -eu

repo="${OMNI_T3_REPO:-InTheta/t3code}"
base_url="${OMNI_T3_BASE_URL:-https://github.com/${repo}/releases/download}"
base_url="${base_url%/}"

fail() {
  printf '\nOmni T3 install: %s\n' "$1" >&2
  exit 1
}
say() {
  printf '  %s\n' "$*" >&2
}

os="${OMNI_T3_OS:-$(uname -s)}"
machine="${OMNI_T3_ARCH:-$(uname -m)}"
case "$os" in
  Darwin) platform=mac ;;
  Linux) platform=linux ;;
  *) fail "unsupported operating system $os. On Windows run scripts/omni/install.ps1." ;;
esac
case "$machine" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "unsupported architecture $machine" ;;
esac
# A shell started under Rosetta reports x86_64 on an Apple Silicon Mac; install the native build.
if [ "$platform" = mac ] && [ "$arch" = x64 ] && [ -z "${OMNI_T3_ARCH:-}" ] &&
  [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi
if [ "$platform" = linux ] && [ "$arch" != x64 ]; then
  fail "there is no Linux $arch build of the fork yet; only x64 is published"
fi

case "$platform" in
  mac) asset_suffix="mac-${arch}.dmg" ;;
  linux) asset_suffix="linux-x64.AppImage" ;;
esac

# Follows the github.com redirect, so it needs no API token and has no API rate limit.
latest_version() {
  command -v curl >/dev/null 2>&1 || fail "curl is required to find the latest release; set OMNI_T3_VERSION to skip this"
  final="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${repo}/releases/latest")" ||
    fail "could not reach github.com to find the latest release"
  tag="${final##*/}"
  case "$tag" in
    v[0-9]*-omni.[0-9]*) printf '%s' "${tag#v}" ;;
    releases | "") fail "${repo} has no published release yet" ;;
    *) fail "the latest release of ${repo} is '${tag}', which is not a fork release (expected v<x.y.z>-omni.<n>)" ;;
  esac
}

version="${OMNI_T3_VERSION:-}"
[ -n "$version" ] || version="$(latest_version)"
case "$version" in
  [0-9]*.[0-9]*.[0-9]*-omni.[0-9]*) ;;
  *) fail "version '$version' must look like 0.1.9-omni.1" ;;
esac
asset="T3-Code-${version}-${asset_suffix}"
release_dir="${base_url}/v${version}"

say "T3 Code (InTheta fork) ${version} for ${platform}-${arch}"
if [ "${OMNI_T3_DRY_RUN:-}" = 1 ]; then
  say "dry run: would download ${release_dir}/${asset}"
  say "dry run: would verify it against ${release_dir}/SHA256SUMS"
  exit 0
fi

if command -v sha256sum >/dev/null 2>&1; then
  checksum() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  checksum() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "sha256sum or shasum is required"
fi

# $1 is an https URL or a path; $2 is where to put it.
fetch() {
  case "$1" in
    http://* | https://*)
      command -v curl >/dev/null 2>&1 || fail "curl is required"
      curl -fsSL --retry 3 --retry-delay 2 -o "$2" "$1" || fail "could not download $1"
      ;;
    *) cp "$1" "$2" || fail "could not read $1" ;;
  esac
}

tmp="$(mktemp -d)"
mnt=
cleanup() {
  if [ -n "$mnt" ] && [ -d "$mnt" ]; then hdiutil detach "$mnt" -quiet -force >/dev/null 2>&1 || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

say "Downloading..."
fetch "${release_dir}/SHA256SUMS" "$tmp/SHA256SUMS"
expected="$(awk -v n="$asset" '$2 == n || $2 == "*" n { print $1; exit }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "${asset} is not listed in SHA256SUMS for v${version}"
fetch "${release_dir}/${asset}" "$tmp/$asset"

say "Verifying the download..."
actual="$(checksum "$tmp/$asset")"
[ "$actual" = "$expected" ] || fail "checksum mismatch for ${asset} (expected ${expected}, got ${actual})"

install_mac() {
  command -v hdiutil >/dev/null 2>&1 || fail "hdiutil is missing; this does not look like macOS"
  mnt="$tmp/mount"
  mkdir -p "$mnt"
  hdiutil attach -nobrowse -readonly -noverify -mountpoint "$mnt" "$tmp/$asset" >/dev/null ||
    fail "could not open the disk image"
  app="$(find "$mnt" -maxdepth 1 -name '*.app' | head -n 1)"
  [ -n "$app" ] || fail "no app inside the disk image"
  name="$(basename "$app")"
  dest_dir=/Applications
  if [ ! -w "$dest_dir" ]; then
    dest_dir="$HOME/Applications"
    mkdir -p "$dest_dir"
  fi
  if pgrep -f "${dest_dir}/${name}/Contents/MacOS" >/dev/null 2>&1; then
    fail "${name} is running. Quit it and run this again."
  fi
  say "Installing ${name} into ${dest_dir}..."
  # Copy beside the old app first so a failed copy never leaves nothing installed.
  rm -rf "${dest_dir}/.${name}.new"
  ditto "$app" "${dest_dir}/.${name}.new" || fail "could not copy the app"
  rm -rf "${dest_dir}/${name}"
  mv "${dest_dir}/.${name}.new" "${dest_dir}/${name}"
  hdiutil detach "$mnt" -quiet >/dev/null 2>&1 || true
  mnt=
  installed="${dest_dir}/${name}"
  # A download made with curl is not quarantined; clear the flag in case a mirror's was.
  xattr -dr com.apple.quarantine "$installed" 2>/dev/null || true
  # Apple Silicon refuses an app whose signature does not verify. Unsigned builds carry
  # an ad-hoc one; repair it here if the copy no longer verifies.
  if ! codesign --verify --deep --strict "$installed" >/dev/null 2>&1; then
    say "Repairing the ad-hoc signature..."
    codesign --force --deep --sign - "$installed" >/dev/null 2>&1 ||
      fail "the installed app does not pass codesign verification"
  fi
  say "Installed ${installed}"
  say "This build is not notarized. If macOS blocks the first launch, right-click the app and choose Open."
}

install_linux() {
  data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
  prefix="${OMNI_T3_PREFIX:-${data_home}/t3code-omni}"
  bin_dir="${OMNI_T3_BIN_DIR:-$HOME/.local/bin}"
  apps_dir="${data_home}/applications"
  mkdir -p "$prefix" "$bin_dir" "$apps_dir"
  target="${prefix}/T3-Code.AppImage"
  say "Installing into ${prefix}..."
  cp "$tmp/$asset" "${target}.new" || fail "could not write to ${prefix}"
  chmod 755 "${target}.new"
  mv -f "${target}.new" "$target"
  ln -sf "$target" "${bin_dir}/t3code-desktop"
  cat >"${apps_dir}/t3code-omni.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=T3 Code (InTheta fork)
Comment=Desktop GUI for coding agents
Exec="${target}" %U
Terminal=false
Categories=Development;
MimeType=x-scheme-handler/t3code;
StartupWMClass=com.t3tools.T3Code
EOF
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$apps_dir" >/dev/null 2>&1 || true
  fi
  say "Installed ${target}"
  say "Start it from your application menu, or run ${bin_dir}/t3code-desktop"
  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *) say "${bin_dir} is not on your PATH; add it to run t3code-desktop by name." ;;
  esac
}

case "$platform" in
  mac) install_mac ;;
  linux) install_linux ;;
esac
