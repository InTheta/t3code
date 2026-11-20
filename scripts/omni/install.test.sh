#!/bin/sh
# Tests scripts/omni/install.sh without network access or a real release.
# Run: sh scripts/omni/install.test.sh
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
script="${here}/install.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }

if command -v sha256sum >/dev/null 2>&1; then
  hash_of() { sha256sum "$1" | cut -d' ' -f1; }
else
  hash_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
fi

version=9.9.9-omni.1
mirror="${work}/mirror"
mkdir -p "${mirror}/v${version}"
printf 'fake appimage bytes\n' >"${mirror}/v${version}/T3-Code-${version}-linux-x64.AppImage"
printf 'fake dmg bytes\n' >"${mirror}/v${version}/T3-Code-${version}-mac-arm64.dmg"
(
  cd "${mirror}/v${version}"
  for f in T3-Code-*; do printf '%s  %s\n' "$(hash_of "$f")" "$f"; done >SHA256SUMS
)

run() { # env assignments are passed as arguments: run NAME=value ...
  env -i PATH="$PATH" HOME="${work}/home" TMPDIR="$work" "$@" sh "$script"
}
mkdir -p "${work}/home"

# 1. Dry run names the exact asset for each platform.
out="$(run OMNI_T3_OS=Linux OMNI_T3_ARCH=x86_64 OMNI_T3_VERSION=$version OMNI_T3_DRY_RUN=1 OMNI_T3_BASE_URL="$mirror" 2>&1)"
case "$out" in *"T3-Code-${version}-linux-x64.AppImage"*) pass "linux x64 asset name" ;; *) fail "linux x64 asset name: $out" ;; esac

out="$(run OMNI_T3_OS=Darwin OMNI_T3_ARCH=arm64 OMNI_T3_VERSION=$version OMNI_T3_DRY_RUN=1 OMNI_T3_BASE_URL="$mirror" 2>&1)"
case "$out" in *"T3-Code-${version}-mac-arm64.dmg"*) pass "mac arm64 asset name" ;; *) fail "mac arm64 asset name: $out" ;; esac

out="$(run OMNI_T3_OS=Darwin OMNI_T3_ARCH=x86_64 OMNI_T3_VERSION=$version OMNI_T3_DRY_RUN=1 OMNI_T3_BASE_URL="$mirror" 2>&1)"
case "$out" in *"T3-Code-${version}-mac-x64.dmg"*) pass "mac x64 asset name" ;; *) fail "mac x64 asset name: $out" ;; esac

# 2. Unsupported platforms and bad versions fail with a clear message.
if out="$(run OMNI_T3_OS=Linux OMNI_T3_ARCH=aarch64 OMNI_T3_VERSION=$version OMNI_T3_DRY_RUN=1 2>&1)"; then
  fail "linux arm64 should be refused"
else
  case "$out" in *"no Linux arm64 build"*) pass "linux arm64 refused" ;; *) fail "linux arm64 message: $out" ;; esac
fi
if out="$(run OMNI_T3_OS=Windows_NT OMNI_T3_ARCH=x86_64 OMNI_T3_VERSION=$version OMNI_T3_DRY_RUN=1 2>&1)"; then
  fail "windows should be sent to install.ps1"
else
  case "$out" in *"install.ps1"*) pass "windows pointed at install.ps1" ;; *) fail "windows message: $out" ;; esac
fi
if out="$(run OMNI_T3_OS=Linux OMNI_T3_ARCH=x86_64 OMNI_T3_VERSION=1.2.3 OMNI_T3_DRY_RUN=1 2>&1)"; then
  fail "an upstream-style version should be refused"
else
  case "$out" in *"must look like"*) pass "non-fork version refused" ;; *) fail "version message: $out" ;; esac
fi

# 3. A real Linux install from the mirror verifies the checksum and lays out the files.
prefix="${work}/prefix"
bin="${work}/bin"
if out="$(run OMNI_T3_OS=Linux OMNI_T3_ARCH=x86_64 OMNI_T3_VERSION=$version OMNI_T3_BASE_URL="$mirror" OMNI_T3_PREFIX="$prefix" OMNI_T3_BIN_DIR="$bin" XDG_DATA_HOME="${work}/data" 2>&1)"; then
  [ -x "${prefix}/T3-Code.AppImage" ] && pass "appimage installed and executable" || fail "appimage missing or not executable"
  [ -L "${bin}/t3code-desktop" ] && pass "launcher link created" || fail "launcher link missing"
  grep -q "^Exec=\"${prefix}/T3-Code.AppImage\" %U$" "${work}/data/applications/t3code-omni.desktop" &&
    pass "desktop entry points at the appimage" || fail "desktop entry wrong"
else
  fail "linux install failed: $out"
fi

# 4. A tampered download is rejected and nothing is installed.
printf 'tampered\n' >"${mirror}/v${version}/T3-Code-${version}-linux-x64.AppImage"
rm -rf "$prefix"
if out="$(run OMNI_T3_OS=Linux OMNI_T3_ARCH=x86_64 OMNI_T3_VERSION=$version OMNI_T3_BASE_URL="$mirror" OMNI_T3_PREFIX="$prefix" OMNI_T3_BIN_DIR="$bin" XDG_DATA_HOME="${work}/data" 2>&1)"; then
  fail "tampered download was accepted"
else
  case "$out" in *"checksum mismatch"*) pass "tampered download rejected" ;; *) fail "mismatch message: $out" ;; esac
  [ ! -e "${prefix}/T3-Code.AppImage" ] && pass "nothing installed after mismatch" || fail "file installed despite mismatch"
fi

# 5. An asset missing from SHA256SUMS is refused.
sed '/linux-x64/d' "${mirror}/v${version}/SHA256SUMS" >"${work}/sums" && cp "${work}/sums" "${mirror}/v${version}/SHA256SUMS"
if out="$(run OMNI_T3_OS=Linux OMNI_T3_ARCH=x86_64 OMNI_T3_VERSION=$version OMNI_T3_BASE_URL="$mirror" OMNI_T3_PREFIX="$prefix" OMNI_T3_BIN_DIR="$bin" XDG_DATA_HOME="${work}/data" 2>&1)"; then
  fail "unlisted asset was accepted"
else
  case "$out" in *"not listed in SHA256SUMS"*) pass "unlisted asset refused" ;; *) fail "unlisted message: $out" ;; esac
fi

if [ "$failures" -gt 0 ]; then
  printf '\n%s check(s) failed\n' "$failures" >&2
  exit 1
fi
printf '\nall checks passed\n'
