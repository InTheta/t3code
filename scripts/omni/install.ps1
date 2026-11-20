# One-command installer for the InTheta T3 Code fork desktop app on Windows.
#
#   irm https://raw.githubusercontent.com/InTheta/t3code/main/scripts/omni/install.ps1 | iex
#
# It downloads the latest fork release, checks the SHA-256 listed in the
# release's SHA256SUMS, then runs the installer silently. The installer puts the
# app in your own profile (no administrator rights) and adds a Start menu entry.
#
# The upstream CLI installer (scripts/install.ps1) is separate and still installs
# upstream's `t3` command. This script installs the desktop app of the fork.
#
# Environment:
#   OMNI_T3_VERSION        exact version to install, for example 0.1.9-omni.1
#   OMNI_T3_REPO           GitHub repository to read releases from (default: InTheta/t3code)
#   OMNI_T3_BASE_URL       release mirror, as an https URL or a local folder laid out
#                          like releases/download (default: GitHub)
#   OMNI_T3_DRY_RUN=1      resolve and print what would be installed, then stop
#   OMNI_T3_INTERACTIVE=1  show the installer window instead of installing silently
#
# Errors are thrown rather than calling `exit`, so a window running `irm | iex`
# stays open long enough to read them.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = if ($env:OMNI_T3_REPO) { $env:OMNI_T3_REPO } else { "InTheta/t3code" }
$baseUrl = if ($env:OMNI_T3_BASE_URL) { $env:OMNI_T3_BASE_URL.TrimEnd("/", "\") } else { "https://github.com/$repo/releases/download" }

function Say([string] $message) { [Console]::Error.WriteLine("  $message") }
function Fail([string] $message) { throw "Omni T3 install: $message" }

$rawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($rawArch) {
  "AMD64" { }
  "ARM64" { Say "Windows on ARM detected; the x64 installer runs under emulation." }
  default { Fail "unsupported architecture $rawArch" }
}

$version = $env:OMNI_T3_VERSION
if (-not $version) {
  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "omni-t3-install" }
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($status -eq 404) { Fail "$repo has no published release yet" }
    Fail "could not read the latest release of ${repo}: $($_.Exception.Message)"
  }
  $tag = $release.tag_name
  if ($tag -notmatch '^v(\d+\.\d+\.\d+-omni\.\d+)$') {
    Fail "the latest release of $repo is '$tag', which is not a fork release (expected v<x.y.z>-omni.<n>)"
  }
  $version = $Matches[1]
}
if ($version -notmatch '^\d+\.\d+\.\d+-omni\.\d+$') { Fail "version '$version' must look like 0.1.9-omni.1" }

$asset = "T3-Code-$version-win-x64.exe"
$releaseDir = "$baseUrl/v$version"
Say "T3 Code (InTheta fork) $version for windows-x64"
if ($env:OMNI_T3_DRY_RUN -eq "1") {
  Say "dry run: would download $releaseDir/$asset"
  Say "dry run: would verify it against $releaseDir/SHA256SUMS"
  return
}

# $source is an https URL or a path; $destination is where to put it.
function Fetch([string] $source, [string] $destination) {
  if ($source -match '^https?://') {
    $ProgressPreference = "SilentlyContinue"
    for ($attempt = 1; ; $attempt++) {
      try { Invoke-WebRequest -Uri $source -OutFile $destination -UseBasicParsing; return }
      catch {
        if ($attempt -ge 3) { Fail "could not download ${source}: $($_.Exception.Message)" }
        Start-Sleep -Seconds (2 * $attempt)
      }
    }
  } else {
    if (-not (Test-Path -LiteralPath $source)) { Fail "could not read $source" }
    Copy-Item -LiteralPath $source -Destination $destination
  }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("omni-t3-" + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Say "Downloading..."
  Fetch "$releaseDir/SHA256SUMS" (Join-Path $tmp "SHA256SUMS")
  $line = Get-Content (Join-Path $tmp "SHA256SUMS") | Where-Object { $_ -match "\s\*?$([regex]::Escape($asset))$" } | Select-Object -First 1
  if (-not $line) { Fail "$asset is not listed in SHA256SUMS for v$version" }
  $expected = ($line -split "\s+")[0].ToLowerInvariant()
  $installer = Join-Path $tmp $asset
  Fetch "$releaseDir/$asset" $installer

  Say "Verifying the download..."
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { Fail "checksum mismatch for $asset (expected $expected, got $actual)" }

  # A file written by Invoke-WebRequest carries no web-origin mark, so SmartScreen does not
  # prompt for it. Clear the mark anyway in case a mirror supplied one.
  Unblock-File -LiteralPath $installer -ErrorAction SilentlyContinue

  Say "Installing..."
  if ($env:OMNI_T3_INTERACTIVE -eq "1") {
    $process = Start-Process -FilePath $installer -Wait -PassThru
  } else {
    $process = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
  }
  if ($process.ExitCode -ne 0) {
    Fail "the installer exited with code $($process.ExitCode). If T3 Code is running, quit it and run this again."
  }
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Say "Installed T3 Code (InTheta fork) $version. Open it from the Start menu."
Say "This build is not signed, so Windows may show a SmartScreen notice the first time you run it: choose More info, then Run anyway."
