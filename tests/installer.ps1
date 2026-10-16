$ErrorActionPreference='Stop'
$root=Join-Path $PSScriptRoot ('results\install-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$bundle=Join-Path (Split-Path $PSScriptRoot) 'dist\EfbV2-LAN'
$community=Join-Path $root 'Community'; $sim=Join-Path $root 'SimConfig'; $app=Join-Path $root 'Application'
New-Item -ItemType Directory -Path $community,$sim,(Join-Path $community 'pmdg-tablet-v2') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $sim 'UserCfg.opt') -Value ('InstalledPackagesPath "'+$root+'"')
Set-Content -LiteralPath (Join-Path $sim 'exe.xml') -Value '<SimBase.Document Type="Launch" version="1,0"><Launch.Addon><Name>Other Addon</Name><Path>C:\Other.exe</Path></Launch.Addon></SimBase.Document>'
Set-Content -LiteralPath (Join-Path $community 'pmdg-tablet-v2\original.txt') -Value 'Original EFB must survive uninstall'
function Assert($ok,$message) { if(-not $ok){throw $message} }
& (Join-Path $bundle 'Install.ps1') -CommunityPath $community -SimConfigPath $sim -InstallPath $app -Port 19385 -NoStart -NoShortcuts
$config=Get-Content (Join-Path $app 'bridge.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$key=$config.PairingKey
Assert ($config.Port -eq 19385) 'Configured port mismatch'
[xml]$xml=Get-Content (Join-Path $sim 'exe.xml') -Raw
Assert ($xml.SelectNodes('//Launch.Addon').Count -eq 2) 'Other addon lost'
$hostFile=Join-Path $community 'pmdg-tablet-v2\html_ui\Pages\VCockpit\Instruments\PMDGTablet\lan-bridge\lan-bridge-config.js'
Assert ((Get-Content $hostFile -Raw) -match '19385') 'Native configuration mismatch'
& (Join-Path $bundle 'Install.ps1') -CommunityPath $community -SimConfigPath $sim -InstallPath $app -NoStart -NoShortcuts
$config=Get-Content (Join-Path $app 'bridge.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Assert ($config.Port -eq 19385 -and $config.PairingKey -eq $key) 'Update did not preserve config'
[xml]$xml=Get-Content (Join-Path $sim 'exe.xml') -Raw
Assert ($xml.SelectNodes('//Launch.Addon').Count -eq 2) 'Duplicate launch entries on update'
$layout=Get-Content (Join-Path $community 'pmdg-tablet-v2\layout.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($item in $layout.content){Assert ((Get-Item -LiteralPath (Join-Path (Join-Path $community 'pmdg-tablet-v2') $item.path)).Length -eq $item.size) ('Layout size mismatch: '+$item.path)}
& (Join-Path $app 'Uninstall.ps1')
Assert (Test-Path (Join-Path $community 'pmdg-tablet-v2\original.txt')) 'Original EFB not restored'
[xml]$xml=Get-Content (Join-Path $sim 'exe.xml') -Raw
Assert ($xml.SelectNodes('//Launch.Addon').Count -eq 1) 'Other addon not preserved during uninstall'
Write-Host 'PASS: install, update, configuration preservation, layout, autostart merge, uninstall restore'
