param([string]$PackagePath=(Join-Path $PSScriptRoot 'dist/EfbV2-LAN-0.2.11/package/pmdg-tablet-v2'), [switch]$SkipPublish, [switch]$ReusePackage, [string]$BundleName='EfbV2-LAN', [switch]$AuthProbe)
$ErrorActionPreference='Stop'
$base=$PSScriptRoot
if ($BundleName -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$' -or $BundleName.EndsWith('.')) { throw 'BundleName must be a simple directory name' }
$out=Join-Path (Join-Path $base 'dist') $BundleName
New-Item -ItemType Directory -Path $out -Force | Out-Null
if (-not $SkipPublish) {
    $env:APPDATA=Join-Path $base '.build-profile'; $env:DOTNET_CLI_HOME=$env:APPDATA
    $env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
    dotnet publish (Join-Path $base 'Bridge') -c Release -r win-x64 --self-contained true --configfile (Join-Path $base 'NuGet.Config') -o (Join-Path $out 'service')
    if ($LASTEXITCODE) { throw 'Publish failed' }
    dotnet publish (Join-Path $base 'Setup') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:TargetPlatformDisplayName=Windows --configfile (Join-Path $base 'NuGet.Config') -o (Join-Path $base 'dist\setup-build')
    if ($LASTEXITCODE) { throw 'GUI publish failed' }
}
Copy-Item -LiteralPath (Join-Path $base 'web') -Destination (Join-Path $out 'service') -Recurse -Force
foreach($old in @('navigraph-app.js','navigraph-app.css')) {
    $file=Join-Path $out ('service\web\'+$old)
    if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file}
}
Copy-Item -LiteralPath (Join-Path $base 'dist\setup-build\EfbV2Setup.exe') -Destination $out -Force
foreach($old in @('Common.ps1','Configure.ps1','Stop.ps1','Status.ps1','Uninstall.ps1')) { $file=Join-Path $out $old; if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file} }
[IO.File]::WriteAllText((Join-Path $out 'Install.cmd'), "@echo off`r`nstart `"`" `"%~dp0EfbV2Setup.exe`"`r`n")
[IO.File]::WriteAllText((Join-Path $out 'Install.ps1'), 'Start-Process -FilePath (Join-Path $PSScriptRoot ''EfbV2Setup.exe'')' + "`r`n")
$packageOut=Join-Path $out 'package\pmdg-tablet-v2'
if (-not $ReusePackage) {
New-Item -ItemType Directory -Path (Split-Path $packageOut) -Force | Out-Null
if (Test-Path -LiteralPath $packageOut) {
    . (Join-Path $base 'installer\Common.ps1')
    $safe=Assert-Child $packageOut $out
    Remove-Item -LiteralPath $safe -Recurse -Force
}
Copy-Item -LiteralPath $PackagePath -Destination $packageOut -Recurse
} elseif (-not (Test-Path -LiteralPath (Join-Path $packageOut 'manifest.json'))) { throw 'No existing package to reuse' }
# Reusing a payload must still refresh and validate the bridge entry points.
$tablet=Join-Path $packageOut 'html_ui\Pages\VCockpit\Instruments\PMDGTablet'
. (Join-Path $base 'installer\Common.ps1')
$bridgeFolder=Join-Path $tablet 'lan-bridge'
if(Test-Path -LiteralPath $bridgeFolder){$safe=Assert-Child $bridgeFolder $packageOut;Remove-Item -LiteralPath $safe -Recurse -Force}
Copy-Item -LiteralPath (Join-Path $base 'host') -Destination $bridgeFolder -Recurse
$prefix='/Pages/VCockpit/Instruments/PMDGTablet/lan-bridge/'
$tag='<script type="text/html" import-script="'+$prefix+'lan-bridge-config.js"></script>'+"`r`n"+'<script type="text/html" import-script="'+$prefix+'lan-bridge-host.js"></script>'+"`r`n"
. (Join-Path $base 'installer\Common.ps1')
Write-Utf8 (Join-Path $tablet 'lan-bridge\lan-bridge-config.js') 'window.EFB_LAN_CONFIG = { enabled: false };'
$entries=@(Get-ChildItem -LiteralPath $tablet -Recurse -File | Where-Object Name -Match '^PMDGTablet(CA|FO)\.html$')
if($entries.Count -eq 0){throw 'No PMDG tablet entry pages in payload'}
$entries | ForEach-Object {
    $text=Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
    $text=[regex]::Replace($text,'<script\b[^>]*import-script\s*=\s*["''][^"'']*/lan-bridge/lan-bridge-(?:config|host)\.js["''][^>]*>\s*</script>\r?\n?','',[Text.RegularExpressions.RegexOptions]::IgnoreCase)
    Write-Utf8 $_.FullName ($tag+$text)
}
. (Join-Path $base 'Prepare-Shared.ps1') -TabletPath $tablet -AuthProbe:$AuthProbe
Update-Layout $packageOut
Copy-Item -LiteralPath (Join-Path $base 'README.md') -Destination $out -Force
$updatedReadme=Join-Path $base 'README.updated.md'
if(Test-Path -LiteralPath $updatedReadme){Copy-Item -LiteralPath $updatedReadme -Destination $out -Force}
$report=Join-Path $base 'TEST-REPORT_local.md'
if (-not (Test-Path -LiteralPath $report)) { $report=Join-Path $base 'TEST-REPORT.md' }
Copy-Item -LiteralPath $report -Destination (Join-Path $out 'TEST-REPORT.md') -Force
foreach($log in @((Join-Path $out 'service\bridge.log'),(Join-Path $out 'service\logs\bridge.log'))){if(Test-Path -LiteralPath $log){Remove-Item -LiteralPath $log}}
Compress-Archive -Path (Join-Path $out '*') -DestinationPath (Join-Path (Join-Path $base 'dist') ($BundleName+'-win-x64.zip')) -Force
Write-Host "Built: $out"
