# Zip the packaged app for a GitHub Release asset.
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less files as
# ANSI; a non-ASCII character with odd byte length can swallow the next line break.
param(
  [string]$Dist = "dist\StarSentinel-win32-x64",
  [string]$Out  = ""
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
if (-not $Out) {
  # Default file name follows the version in package.json, so releases need no edit here.
  $pkgText = Get-Content (Join-Path $Root "package.json") -Raw
  if ($pkgText -match '"version"\s*:\s*"([^"]+)"') { $version = $Matches[1] }
  if (-not $version) { throw "cannot read version from package.json" }
  $Out = "star-sentinel-v{0}-win32-x64.zip" -f $version
}
$src = Join-Path $Root $Dist
if (-not (Test-Path $src)) { throw "missing $src" }
$dst = Join-Path $Root $Out
if (Test-Path $dst) { Remove-Item $dst -Force }
Write-Host ("[zip] " + $src + " -> " + $dst)
[System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$f = Get-Item $dst
Write-Host ("[zip] done " + [math]::Round($f.Length/1MB,1) + " MB")
