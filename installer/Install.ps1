[CmdletBinding()]
param(
    [string]$CommunityPath,
    [string]$SimConfigPath,
    [ValidateRange(1024,65535)][int]$Port = 8385,
    [string]$InstallPath = (Join-Path $env:LOCALAPPDATA 'EfbV2Bridge'),
    [switch]$NoStart,
    [switch]$NoShortcuts
)
. (Join-Path $PSScriptRoot 'Common.ps1')
try {
    if (Get-Process FlightSimulator2024 -ErrorAction SilentlyContinue) { throw 'Close MSFS 2024 before installing or updating the package.' }
    $bundle = Full-Path $PSScriptRoot
    if (-not (Test-Path (Join-Path $bundle 'service\EfbLanBridge.exe'))) { throw 'Extract the complete ZIP before running Install.cmd.' }
    if (-not $SimConfigPath) {
        [string[]]$candidates = @(
            (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache'),
            (Join-Path $env:APPDATA 'Microsoft Flight Simulator 2024')
        ) | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'UserCfg.opt') }
        if ($candidates.Count -eq 1) { $SimConfigPath = $candidates[0] }
        else { $SimConfigPath = Read-Host 'MSFS 2024 configuration folder (contains UserCfg.opt / exe.xml)' }
    }
    $SimConfigPath = Full-Path $SimConfigPath
    if (-not (Test-Path -LiteralPath (Join-Path $SimConfigPath 'UserCfg.opt'))) { throw "UserCfg.opt not found in $SimConfigPath. Start MSFS 2024 once, or pass -SimConfigPath." }
    if (-not $CommunityPath) {
        $userCfg = Get-Content -LiteralPath (Join-Path $SimConfigPath 'UserCfg.opt') -Raw -Encoding UTF8
        $match = [regex]::Match($userCfg, '(?m)^\s*InstalledPackagesPath\s+"([^"]+)"')
        if ($match.Success) {
            $packages = $match.Groups[1].Value
            # Prefer the 2024-only folder when the installation actually has one.
            $CommunityPath = Join-Path $packages 'Community2024'
            if (-not (Test-Path -LiteralPath $CommunityPath)) { $CommunityPath = Join-Path $packages 'Community' }
        }
        if (-not $CommunityPath -or -not (Test-Path -LiteralPath $CommunityPath)) { $CommunityPath = Read-Host 'MSFS 2024 Community folder' }
    }
    $CommunityPath = Full-Path $CommunityPath
    if (-not (Test-Path -LiteralPath $CommunityPath -PathType Container)) { throw "Community folder does not exist: $CommunityPath" }
    $InstallPath = Full-Path $InstallPath
    if ($InstallPath -eq $bundle -or $InstallPath.StartsWith($bundle + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'InstallPath must be outside the extracted installation bundle.' }
    $target = Assert-Child (Join-Path $CommunityPath 'pmdg-tablet-v2') $CommunityPath
    if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'pmdg-tablet-v2 is a junction/symlink. Choose its real Community folder or manage that link manually.' }
    $configFile = Join-Path $InstallPath 'bridge.json'
    $oldConfig = $null
    if (Test-Path -LiteralPath $configFile) { $oldConfig = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    if ($oldConfig -and $oldConfig.PackagePath -ne $target) { throw 'An existing bridge targets another Community folder. Uninstall it first, or use the same folder.' }
    Stop-Bridge $InstallPath
    if ($oldConfig -and -not $PSBoundParameters.ContainsKey('Port')) { $Port = $oldConfig.Port }
    Test-Port $Port
    $xmlPath = Join-Path $SimConfigPath 'exe.xml'
    $xmlExisted = Test-Path -LiteralPath $xmlPath
    $xml = New-Object Xml.XmlDocument
    $xml.PreserveWhitespace = $true
    if ($xmlExisted) { $xml.Load($xmlPath) }
    else { $xml.LoadXml('<?xml version="1.0" encoding="utf-8"?><SimBase.Document Type="Launch" version="1,0"><Descr>Launch</Descr><Filename>exe.xml</Filename><Disabled>False</Disabled><Launch.ManualLoad>False</Launch.ManualLoad></SimBase.Document>') }
    if ($xml.DocumentElement.Name -ne 'SimBase.Document') { throw 'Unexpected exe.xml format; installation stopped without changing it.' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backup = Join-Path $InstallPath "backups\$stamp"
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    if ($xmlExisted) { Copy-Item -LiteralPath $xmlPath -Destination (Join-Path $backup 'exe.xml') }
    if (Test-Path -LiteralPath $configFile) { Copy-Item -LiteralPath $configFile -Destination (Join-Path $backup 'bridge.json') }
    $hadPackage = Test-Path -LiteralPath $target
    if ($hadPackage) { Copy-Item -LiteralPath $target -Destination (Join-Path $backup 'pmdg-tablet-v2') -Recurse }
    $hadService = Test-Path -LiteralPath (Join-Path $InstallPath 'EfbLanBridge.exe')
    if ($hadService) {
        New-Item -ItemType Directory -Path (Join-Path $backup 'service') -Force | Out-Null
        Get-ChildItem -LiteralPath $InstallPath -File | Copy-Item -Destination (Join-Path $backup 'service')
        if (Test-Path (Join-Path $InstallPath 'web')) { Copy-Item -LiteralPath (Join-Path $InstallPath 'web') -Destination (Join-Path $backup 'service\web') -Recurse }
    }
    # The backup is outside Community, so the simulator cannot mount a duplicate package.
    $stage = Join-Path $InstallPath "stage-$stamp"
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $bundle 'package\pmdg-tablet-v2') -Destination (Join-Path $stage 'pmdg-tablet-v2') -Recurse
    $mutated = $false
    try {
        $mutated = $true
        if ($hadPackage) { $safe = Assert-Child $target $CommunityPath; Remove-Item -LiteralPath $safe -Recurse -Force }
        Copy-Item -LiteralPath (Join-Path $stage 'pmdg-tablet-v2') -Destination $target -Recurse
        Get-ChildItem -LiteralPath (Join-Path $bundle 'service') | Copy-Item -Destination $InstallPath -Recurse -Force
        foreach ($script in @('Common.ps1','Configure.ps1','Uninstall.ps1','Stop.ps1','Status.ps1')) { Copy-Item -LiteralPath (Join-Path $bundle $script) -Destination $InstallPath -Force }
        $config = [ordered]@{Port=$Port;BindAddress='0.0.0.0';PackagePath=$target;PairingKey=(New-Key 8);HostKey=(New-Key 24);GsxPort=8744;BatcPort=41716}
        if ($oldConfig) { foreach ($key in @('PairingKey','HostKey','GsxPort','BatcPort','BindAddress')) { $config[$key] = $oldConfig.$key } }
        Write-Utf8 $configFile ($config | ConvertTo-Json)
        Write-HostConfig ([pscustomobject]$config)
        $entry = $xml.SelectSingleNode('/SimBase.Document/Launch.Addon[Name="EFB v2 LAN Bridge"]')
        if (-not $entry) { $entry = $xml.CreateElement('Launch.Addon'); $xml.DocumentElement.AppendChild($entry) | Out-Null }
        $values = [ordered]@{Name='EFB v2 LAN Bridge';Disabled='False';ManualLoad='False';Path=(Join-Path $InstallPath 'EfbLanBridge.exe');CommandLine='--sim-start';NewConsole='False'}
        foreach ($key in $values.Keys) { $child = $entry.SelectSingleNode($key); if (-not $child) { $child = $xml.CreateElement($key); $entry.AppendChild($child) | Out-Null }; $child.InnerText = $values[$key] }
        $xml.Save($xmlPath)
        $stateFile = Join-Path $InstallPath 'install-state.json'
        $originalBackup = $backup
        if (Test-Path -LiteralPath $stateFile) { $prior = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json; $originalBackup = $prior.OriginalBackup; $hadPackage = $prior.HadPackage }
        $shortcutPath = $null
        if (-not $NoShortcuts) {
            $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'EFB v2 LAN'
            $shortcutPath = $menu
            New-Item -ItemType Directory -Path $menu -Force | Out-Null
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut((Join-Path $menu 'Start bridge.lnk')); $shortcut.TargetPath = Join-Path $InstallPath 'EfbLanBridge.exe'; $shortcut.WorkingDirectory = $InstallPath; $shortcut.Save()
            foreach ($tool in @('Status','Stop','Configure','Uninstall')) {
                $shortcut = $shell.CreateShortcut((Join-Path $menu "$tool.lnk")); $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"; $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$(Join-Path $InstallPath "$tool.ps1")`""; $shortcut.WorkingDirectory = $InstallPath; $shortcut.Save()
            }
        }
        Write-Utf8 $stateFile ([ordered]@{CommunityPath=$CommunityPath;SimConfigPath=$SimConfigPath;OriginalBackup=$originalBackup;HadPackage=$hadPackage;ShortcutPath=$shortcutPath} | ConvertTo-Json)
        if (-not $NoStart) { Start-Process -FilePath (Join-Path $InstallPath 'EfbLanBridge.exe') -WorkingDirectory $InstallPath -WindowStyle Hidden }
        Show-Address ([pscustomobject]$config)
        Write-Host "Config: $configFile`nBackup: $backup"
    } catch {
        if ($mutated) {
            Stop-Bridge $InstallPath
            if (Test-Path -LiteralPath $target) { $safe = Assert-Child $target $CommunityPath; Remove-Item -LiteralPath $safe -Recurse -Force }
            if (Test-Path -LiteralPath (Join-Path $backup 'pmdg-tablet-v2')) { Copy-Item -LiteralPath (Join-Path $backup 'pmdg-tablet-v2') -Destination $target -Recurse }
            if ($xmlExisted) { Copy-Item -LiteralPath (Join-Path $backup 'exe.xml') -Destination $xmlPath -Force }
            elseif (Test-Path -LiteralPath $xmlPath) { Remove-Item -LiteralPath $xmlPath }
            if (Test-Path -LiteralPath (Join-Path $backup 'service')) { Get-ChildItem -LiteralPath (Join-Path $backup 'service') | Copy-Item -Destination $InstallPath -Recurse -Force }
            elseif (Test-Path -LiteralPath $configFile) { Remove-Item -LiteralPath $configFile }
        }
        throw
    } finally { if (Test-Path -LiteralPath $stage) { $safe = Assert-Child $stage $InstallPath; Remove-Item -LiteralPath $safe -Recurse -Force } }
} catch { Write-Error $_; exit 1 }
