<#
  StarWhisper Sentinel - one-command push to GitHub
  ---------------------------------------------------------------
  Use this once this machine can reach github.com.

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\push-to-github.ps1

  Default remote is git@github.com:furxingyu-star/star-sentinel.git and the
  default key is %USERPROFILE%\.ssh\star_sentinel2 (already registered on the
  GitHub account). Generate your own with:

    ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\star_sentinel2 -N ""

  then paste the .pub content at https://github.com/settings/ssh/new

  HTTPS alternative: pass -RepoUrl https://github.com/OWNER/repo.git and log
  in once through the browser (Git Credential Manager):

    "C:\Users\Administrator\tools\git\cmd\git.exe" credential-manager github login

  The repository has to exist first: create it by hand at
  https://github.com/new and do NOT tick "Add a README file",
  this repository already has one.
#>
[CmdletBinding()]
param(
  [string]$RepoUrl = "git@github.com:furxingyu-star/star-sentinel.git",
  [string]$Branch = "main",
  [string]$SshKey = "$env:USERPROFILE\.ssh\star_sentinel2"
)

$ErrorActionPreference = "Stop"
if (-not $env:PATHEXT -or $env:PATHEXT -notmatch "\.EXE") {
  $env:PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.PS1"
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$candidates = @()
if ($env:SENTINEL_GIT) { $candidates += $env:SENTINEL_GIT }
$onPath = Get-Command git.exe -ErrorAction SilentlyContinue
if ($onPath) { $candidates += $onPath.Source }
if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE "tools\git\cmd\git.exe") }
$candidates += "C:\Users\Administrator\tools\git\cmd\git.exe"
$Git = $null
foreach ($p in $candidates) { if ($p -and (Test-Path $p)) { $Git = $p; break } }
if (-not $Git) { throw "git.exe not found. Set $env:SENTINEL_GIT to a git.exe path." }

if (-not (Test-Path (Join-Path $Root ".git"))) {
  throw "No local repository yet. Run scripts\make-bundle.ps1 first."
}

if ($RepoUrl -like "git@*" -or $RepoUrl -like "ssh://*") {
  if ($SshKey -and (Test-Path $SshKey)) {
    $keyPosix = $SshKey -replace "\\", "/"
    $env:GIT_SSH_COMMAND = (('ssh -i "{0}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new') -f $keyPosix)
    Write-Host ("[push] ssh key " + $SshKey)
  } else {
    Write-Host ("[push] WARNING: ssh key not found at " + $SshKey + "; relying on ssh agent / default keys") -ForegroundColor Yellow
  }
}

$existing = & $Git remote 2>$null
if ($existing -contains "origin") {
  & $Git remote set-url origin $RepoUrl
} else {
  & $Git remote add origin $RepoUrl
}
& $Git branch -M $Branch
Write-Host ("[push] " + $RepoUrl + "  branch " + $Branch)
& $Git push -u origin $Branch
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Push failed. If this is an authentication problem, run the browser login once:" -ForegroundColor Yellow
  Write-Host ("  " + $Git + " credential-manager github login")
  throw "git push failed"
}
Write-Host "[push] done"
