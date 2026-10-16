$ErrorActionPreference='Stop'
$base=Split-Path $PSScriptRoot
$root=Join-Path $PSScriptRoot ('results\failure-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$bundle=Join-Path $root 'BrokenBundle';$community=Join-Path $root 'Community';$sim=Join-Path $root 'SimConfig';$app=Join-Path $root 'App'
New-Item -ItemType Directory -Path $bundle,$community,$sim,(Join-Path $bundle 'service'),(Join-Path $bundle 'package\pmdg-tablet-v2'),(Join-Path $community 'pmdg-tablet-v2') -Force | Out-Null
Get-ChildItem (Join-Path $base 'installer') -File | Copy-Item -Destination $bundle
Set-Content -LiteralPath (Join-Path $bundle 'service\EfbLanBridge.exe') -Value 'Test stub - never executed'
Set-Content -LiteralPath (Join-Path $bundle 'package\pmdg-tablet-v2\layout.json') -Value '{"content":[]}'
Set-Content -LiteralPath (Join-Path $community 'pmdg-tablet-v2\keep.txt') -Value 'original'
Set-Content -LiteralPath (Join-Path $sim 'UserCfg.opt') -Value 'InstalledPackagesPath "Unused"'
Set-Content -LiteralPath (Join-Path $sim 'exe.xml') -Value '<SimBase.Document Type="Launch" version="1,0"><Launch.Addon><Name>Keep me</Name></Launch.Addon></SimBase.Document>'
$before=(Get-FileHash -LiteralPath (Join-Path $sim 'exe.xml')).Hash
$failed=$false
try { & (Join-Path $bundle 'Install.ps1') -CommunityPath $community -SimConfigPath $sim -InstallPath $app -Port 19386 -NoStart -NoShortcuts } catch { $failed=$true }
if(-not $failed){throw 'Broken package was accepted'}
if(-not (Test-Path -LiteralPath (Join-Path $community 'pmdg-tablet-v2\keep.txt'))){throw 'Package was not restored after failed install'}
if((Get-FileHash -LiteralPath (Join-Path $sim 'exe.xml')).Hash -ne $before){throw 'exe.xml changed after failed install'}
Write-Host 'PASS: failure after package replacement restores original package and exe.xml'
