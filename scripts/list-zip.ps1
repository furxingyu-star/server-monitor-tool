param([string]$Zip = "star-sentinel-v1.4.0-win32-x64.zip")
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Root = Split-Path -Parent $PSScriptRoot
$z = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $Root $Zip))
$z.Entries | Where-Object { $_.FullName -notlike "*locales*" } | ForEach-Object { "" + [math]::Round($_.Length/1MB,2) + " MB  " + $_.FullName }
$z.Dispose()
