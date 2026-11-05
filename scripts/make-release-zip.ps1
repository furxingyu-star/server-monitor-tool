# Zip the packaged app for a GitHub Release asset.
param(
  [string]$Dist = "dist\StarSentinel-win32-x64",
  [string]$Out  = "star-sentinel-v1.4.0-win32-x64.zip"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$src = Join-Path $Root $Dist
if (-not (Test-Path $src)) { throw "missing $src" }
$dst = Join-Path $Root $Out
if (Test-Path $dst) { Remove-Item $dst -Force }
Write-Host ("[zip] " + $src + " -> " + $dst)
[System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$f = Get-Item $dst
Write-Host ("[zip] done " + [math]::Round($f.Length/1MB,1) + " MB")
