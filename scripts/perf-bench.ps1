
$ErrorActionPreference = 'Stop'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$proj = 'C:\\Users\\Administrator\\Documents\\deepseek-harness\\default-workspace\\star-sentinel\\'
$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$exe  = Join-Path $proj 'node_modules\electron\dist\electron.exe'
$src  = Join-Path $env:APPDATA 'star-sentinel\settings.json'
$port = 9333

function Make-UserData([string]$dir, [string]$glass, [int]$liquid, [int]$lowfx) {
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  Copy-Item $src (Join-Path $dir 'settings.json')
  $patch = Join-Path $proj 'scripts\_perfpatch.js'
  @'
const fs = require('fs');
const f = process.argv[2];
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
d.mode = 'bt';
d.ui = d.ui || {};
d.ui.theme = 'deep';
d.ui.glass = process.argv[3];
d.ui.liquid = process.argv[4] === '1';
d.ui.lowFx = process.argv[5] === '1';
fs.writeFileSync(f, JSON.stringify(d, null, 2));
console.log('ui=' + JSON.stringify({theme:d.ui.theme, glass:d.ui.glass, liquid:d.ui.liquid, lowFx:d.ui.lowFx}));
'@ | Set-Content -Encoding utf8 $patch
  & $node $patch (Join-Path $dir 'settings.json') $glass $liquid $lowfx
}

function Stop-Tree([int]$root) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $set = New-Object System.Collections.HashSet[int]
  [void]$set.Add($root)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $all) {
      if ($set.Contains([int]$p.ParentProcessId) -and -not $set.Contains([int]$p.ProcessId)) {
        [void]$set.Add([int]$p.ProcessId); $changed = $true
      }
    }
  }
  foreach ($id in ($set | Sort-Object -Descending)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}

function Wait-Cdp([int]$timeoutMs) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 350
  }
  return $false
}

$cases = @(
  @{ name = 'A-liquid-std'; glass = 'std'; liquid = 1; lowfx = 0 },
  @{ name = 'B-liquid-off'; glass = 'std'; liquid = 0; lowfx = 0 },
  @{ name = 'C-fx-low';     glass = 'std'; liquid = 1; lowfx = 1 }
)

$out = @()
foreach ($c in $cases) {
  $ud = Join-Path $proj ('.perfud-' + $c.name)
  Make-UserData $ud $c.glass $c.liquid $c.lowfx
  $proc = Start-Process -FilePath $exe -ArgumentList '.', "--remote-debugging-port=$port", "--user-data-dir=$ud" -WorkingDirectory $proj -PassThru -WindowStyle Minimized
  $ok = Wait-Cdp 25000
  Start-Sleep -Milliseconds 1500
  $res = & $node (Join-Path $proj 'scripts\perfprobe.js') $port $c.name 2>&1
  $res | Out-String | Write-Output
  Stop-Tree $proc.Id
  Start-Sleep -Milliseconds 900
  $out += ($res | Out-String)
}
Write-Output '=== DONE ==='
