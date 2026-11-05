param([string]$Zip = "star-sentinel-v1.4.0-win32-x64.zip")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$z = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $Root $Zip))
Write-Host ("[zip] entries=" + $z.Entries.Count)
$exe = $z.Entries | Where-Object { $_.FullName -like '*StarSentinel.exe' } | Select-Object -First 3
foreach ($e in $exe) { Write-Host ("[zip] " + $e.FullName + "  " + [math]::Round($e.Length/1MB,1) + " MB") }
$roots = $z.Entries | ForEach-Object { ($_.FullName -split '/')[0] } | Sort-Object -Unique
Write-Host ("[zip] roots=" + ($roots -join ','))
$z.Dispose()
