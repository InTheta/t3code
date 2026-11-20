#!/usr/bin/env bash
# Build this fork's Linux x64 CLI archive and lay it out as a mirror the upstream installer can read.
#
#   scripts/omni/build-cli-mirror.sh <output dir>
#
# Produces <out>/v<version>/t3-<version>-linux-x64.tar.gz and <out>/v<version>/SHA256SUMS. Serve <out> over HTTPS, then:
#
#   curl -fsSL https://raw.githubusercontent.com/InTheta/t3code/main/scripts/install.sh \
#     | T3CODE_RELEASE_BASE_URL=https://your-mirror.example/t3 T3CODE_VERSION=<version> sh
#
# The archive version must equal the server package version (the smoke test checks `t3 --version`).
# Needs: node and the repo's dependencies (vp install), a Rust toolchain new enough for native/resource-monitor
# (optional: the archive builds without it), and patchelf (pip install patchelf in a venv; no root needed).
# Runs no GitHub Actions: this is the same build the release workflow does, on your own machine.
set -euo pipefail
out="${1:?usage: build-cli-mirror.sh <output dir>}"
cd "$(git rev-parse --show-toplevel)"
version="$(node -p "require('./apps/server/package.json').version")"
command -v patchelf >/dev/null || { echo "patchelf is required (python3 -m venv v && v/bin/pip install patchelf)" >&2; exit 2; }
export T3CODE_TELEMETRY_CHANNEL=dev

vp run --filter @t3tools/web build
vp run --filter t3 build
node apps/server/scripts/cli.ts build-exe --verbose

monitors="$(mktemp -d)"
mkdir -p "$monitors/linux-x64"
if [ -x native/resource-monitor/target/release/t3-resource-monitor ]; then
  cp native/resource-monitor/target/release/t3-resource-monitor "$monitors/linux-x64/"
fi
stage="$(mktemp -d)"
node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$version" \
  --resource-monitor-dir "$monitors" --output-dir "$stage"
node scripts/smoke-cli-archive.ts --archive "$stage"/*.tar.gz --expect-version "$version"

mkdir -p "$out/v$version"
cp "$stage"/*.tar.gz "$out/v$version/"
(cd "$out/v$version" && sha256sum ./*.tar.gz | sed 's# \./# #' > SHA256SUMS)
echo "mirror ready: $out/v$version"