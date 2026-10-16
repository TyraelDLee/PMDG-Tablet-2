. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bridge.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Show-Address $config
try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.Port)/health" -TimeoutSec 3; Write-Host "Connected simulator tablets: $($health.hosts -join ', ')" } catch { Write-Host 'Bridge is not responding. Check logs/bridge.log.' }
