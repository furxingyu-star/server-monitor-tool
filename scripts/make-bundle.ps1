<#
  StarWhisper Sentinel - offline release packager
  ---------------------------------------------------------------
  Builds a publishable snapshot without any network access:

    _publish\star-sentinel.bundle    git bundle (all branches, full history)
    _publish\star-sentinel-src.zip   source tree of HEAD (git archive)

  Everything excluded by .gitignore (node_modules, build, dist, release,
  shots*, logs, *_publish, ...) is automatically left out, because the
  zip is produced by "git archive" from the committed tree.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-bundle.ps1
    ... -SkipSecretScan          (only if you know what you are doing)
    ... -CommitMessage "feat: ..." -OutDir "_publish"

  Author identity is intentionally the AI agent (see LICENSE):
    DeepSeek Harness Agent (AI)
#>
[CmdletBinding()]
param(
  [string]$OutDir = '_publish',
  [string]$CommitMessage = 'chore: initial public release',
  [switch]$SkipSecretScan
)

$ErrorActionPreference = 'Stop'

# PowerShell cannot start .exe files when PATHEXT is missing (some agent shells
# spawn us with a stripped environment) - restore it before calling git.
if (-not $env:PATHEXT -or $env:PATHEXT -notmatch '\.EXE') {
  $env:PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.PS1'
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$AiName  = 'DeepSeek Harness Agent'
$AiMail  = 'agent@deepseek-harness.invalid'

function Resolve-Git {
  $candidates = @()
  if ($env:SENTINEL_GIT) { $candidates += $env:SENTINEL_GIT }
  if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE 'tools\git\cmd\git.exe') }
  $candidates += 'C:\Users\Administrator\tools\git\cmd\git.exe'
  $onPath = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  throw 'git.exe not found. Set $env:SENTINEL_GIT to a git.exe path.'
}

$Git = Resolve-Git
Write-Host ('[1/7] git: ' + $Git)
& $Git --version

# ---- repository -------------------------------------------------------------
$gitDir = Join-Path $Root '.git'
if (-not (Test-Path $gitDir)) {
  Write-Host '[2/7] git init -b main'
  & $Git init -b main | Out-Null
} else {
  Write-Host '[2/7] existing repository reused'
}
& $Git config user.name  $AiName
& $Git config user.email $AiMail
Write-Host ('      identity: ' + $AiName + ' <' + $AiMail + '>')

# ---- stage ------------------------------------------------------------------
Write-Host '[3/7] staging files (honours .gitignore)'
& $Git add -A
$staged = @(& $Git diff --cached --name-only)
Write-Host ('      staged files: ' + $staged.Count)

# ---- secret gate ------------------------------------------------------------
$soft = @()
if (-not $SkipSecretScan) {
  Write-Host '[4/7] secret scan of staged files'
  $hard = @(
    @{ n = 'api key literal';    r = '(?i)(api[_-]?key|apikey|appkey)\s*[:=]\s*[\x22\x27][A-Za-z0-9_\-\.]{8,}[\x22\x27]' },
    @{ n = 'password literal';   r = '(?i)(password|passwd|pwd)\s*[:=]\s*[\x22\x27][^\x22\x27]{3,}[\x22\x27]' },
    @{ n = 'secret/token literal'; r = '(?i)(secret|token|bearer)\s*[:=]\s*[\x22\x27][A-Za-z0-9_\-\.]{10,}[\x22\x27]' },
    @{ n = 'sk- style key';      r = '(?i)\bsk-[A-Za-z0-9_\-]{10,}' },
    @{ n = 'private key block';  r = '-----BEGIN [A-Z ]*PRIVATE KEY-----' }
  )
  $ipv4 = '\b(?:\d{1,3}\.){3}\d{1,3}\b'
  $hits = @()
  foreach ($f in $staged) {
    $full = Join-Path $Root $f
    if (-not (Test-Path $full)) { continue }
    $item = Get-Item $full -ErrorAction SilentlyContinue
    if (-not $item -or $item.Length -gt 4MB) { continue }
    $text = Get-Content -LiteralPath $full -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    if ($text.IndexOf([char]0) -ge 0) { continue }
    $lineNo = 0
    foreach ($line in ($text -split "\r?\n")) {
      $lineNo++
      foreach ($p in $hard) {
        if ([regex]::IsMatch($line, $p.r)) {
          $hits += ('{0}:{1}  [{2}]  {3}' -f $f, $lineNo, $p.n, $line.Trim())
        }
      }
      if ([regex]::IsMatch($line, $ipv4) -and $line -notmatch '127\.0\.0\.1|0\.0\.0\.0|localhost') {
        $soft += ('{0}:{1}  [ip address]  {2}' -f $f, $lineNo, $line.Trim())
      }
    }
  }
  if ($hits.Count -gt 0) {
    Write-Host ''
    Write-Host '  !! SECRET SCAN FAILED - refusing to build a publishable snapshot.' -ForegroundColor Red
    foreach ($h in $hits) { Write-Host ('     ' + $h) -ForegroundColor Red }
    Write-Host ''
    Write-Host '  Move these values into a local settings file / env var, then re-run.'
    Write-Host '  Override only for a private snapshot:  -SkipSecretScan'
    throw ('secret scan flagged ' + $hits.Count + ' line(s)')
  }
  Write-Host '      no hard-coded secrets found'
} else {
  Write-Host '[4/7] secret scan skipped (-SkipSecretScan)'
}
if ($soft.Count -gt 0) {
  Write-Host ('      note: ' + $soft.Count + ' staged line(s) mention an IPv4 address (review manually):')
  foreach ($s in ($soft | Select-Object -First 15)) { Write-Host ('        ' + $s) }
}

# ---- commit -----------------------------------------------------------------
Write-Host '[5/7] commit'
& $Git diff --cached --quiet
$dirty = ($LASTEXITCODE -ne 0)
if ($dirty) {
  & $Git commit -m $CommitMessage | Out-Null
  Write-Host ('      committed: ' + (& $Git log --oneline -1))
} else {
  Write-Host '      nothing to commit, tree already clean'
}
& $Git branch -M main | Out-Null

# ---- bundle + archive -------------------------------------------------------
Write-Host '[6/7] building bundle and source zip'
$Out = Join-Path $Root $OutDir
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$Bundle = Join-Path $Out 'star-sentinel.bundle'
if (Test-Path $Bundle) { Remove-Item $Bundle -Force }
& $Git bundle create $Bundle --all
if ($LASTEXITCODE -ne 0) { throw 'git bundle create failed' }
& $Git bundle verify $Bundle

$Zip = Join-Path $Out 'star-sentinel-src.zip'
if (Test-Path $Zip) { Remove-Item $Zip -Force }
& $Git archive --format=zip --prefix=star-sentinel/ -o $Zip HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }

# ---- report -----------------------------------------------------------------
Write-Host '[7/7] done'
foreach ($p in @($Bundle, $Zip)) {
  $i = Get-Item $p
  if ($i.Length -ge 1MB) { $size = [string][math]::Round($i.Length / 1MB, 2) + ' MB' }
  else { $size = [string][math]::Round($i.Length / 1KB, 1) + ' KB' }
  Write-Host ('      ' + $i.FullName + '   ' + $size)
}
$head = & $Git log --oneline -1
Write-Host ('      HEAD: ' + $head)
Write-Host ('      files in snapshot: ' + @(& $Git ls-tree -r --name-only HEAD).Count)

$gitBin = Split-Path -Parent $Git
Write-Host ''
Write-Host 'Add git to the PATH of this shell to type plain "git":'
Write-Host ('  $env:PATH = "' + $gitBin + ';" + $env:PATH')
Write-Host ''
Write-Host 'Next steps once the machine can reach GitHub:'
Write-Host '  1) log in once (browser OAuth, stores a token in Windows Credential Manager):'
Write-Host ('       "' + $Git + '" credential-manager github login')
Write-Host '  2) attach the remote and push:'
Write-Host '       git remote add origin https://github.com/<you>/star-sentinel.git'
Write-Host '       git push -u origin main'
Write-Host ''
Write-Host 'Restore this snapshot on another machine without GitHub:'
Write-Host ('       git clone "' + $Bundle + '" star-sentinel')
