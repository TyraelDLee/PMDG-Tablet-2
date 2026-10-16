param([ValidateRange(1024,65535)][int]$Port)
. (Join-Path $PSScriptRoot 'Common.ps1')
if (Get-Process FlightSimulator2024 -ErrorAction SilentlyContinue) { throw 'Close MSFS 2024 before applying port/config changes.' }
$file = Join-Path $PSScriptRoot 'bridge.json'
$config = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Port) { $config.Port = $Port }
if ($config.Port -lt 1024 -or $config.Port -gt 65535) { throw 'Port must be between 1024 and 65535.' }
Stop-Bridge $PSScriptRoot
Test-Port $config.Port
Write-HostConfig $config
Write-Utf8 $file ($config | ConvertTo-Json)
Start-Process -FilePath (Join-Path $PSScriptRoot 'EfbLanBridge.exe') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
Show-Address $config
