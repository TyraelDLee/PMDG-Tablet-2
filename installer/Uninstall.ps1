. (Join-Path $PSScriptRoot 'Common.ps1')
if (Get-Process FlightSimulator2024 -ErrorAction SilentlyContinue) { throw 'Close MSFS 2024 before uninstalling.' }
$state = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($state.HadPackage -and -not (Test-Path -LiteralPath (Join-Path $state.OriginalBackup 'pmdg-tablet-v2'))) { throw 'Original backup is missing. Uninstall stopped to preserve the current EFB.' }
Stop-Bridge $PSScriptRoot
$xmlPath = Join-Path $state.SimConfigPath 'exe.xml'
if (Test-Path -LiteralPath $xmlPath) {
    $xml = New-Object Xml.XmlDocument; $xml.PreserveWhitespace = $true; $xml.Load($xmlPath)
    $entry = $xml.SelectSingleNode('/SimBase.Document/Launch.Addon[Name="EFB v2 LAN Bridge"]')
    if ($entry -and $entry.Path -eq (Join-Path $PSScriptRoot 'EfbLanBridge.exe')) { $entry.ParentNode.RemoveChild($entry) | Out-Null; $xml.Save($xmlPath) }
}
$target = Assert-Child (Join-Path $state.CommunityPath 'pmdg-tablet-v2') $state.CommunityPath
if (Test-Path -LiteralPath $target) {
    if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package is now a link; remove the bridge manually to preserve its target.' }
    $backup = Join-Path $PSScriptRoot ('backups\uninstall-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $target -Destination (Join-Path $backup 'pmdg-tablet-v2') -Recurse
    Remove-Item -LiteralPath $target -Recurse -Force
}
if ($state.HadPackage) { Copy-Item -LiteralPath (Join-Path $state.OriginalBackup 'pmdg-tablet-v2') -Destination $target -Recurse }
$menu = $state.ShortcutPath
if ($menu -and (Test-Path -LiteralPath $menu)) { $safe = Assert-Child $menu ([Environment]::GetFolderPath('Programs')); Remove-Item -LiteralPath $safe -Recurse -Force }
Remove-Item -LiteralPath (Join-Path $PSScriptRoot 'install-state.json')
Write-Host 'Autostart removed; previous EFB package restored. Bridge files and backups remain here and can be deleted after inspection.'
