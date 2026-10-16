$ErrorActionPreference = 'Stop'
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8($Path, $Text) { [IO.File]::WriteAllText($Path, $Text, $script:Utf8) }
function Full-Path($Path) { [IO.Path]::GetFullPath($Path).TrimEnd('\') }
function Assert-Child($Path, $Root) {
    $p = Full-Path $Path; $r = Full-Path $Root
    if (-not $p.StartsWith($r + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe path: $p is not inside $r" }
    return $p
}
function Stop-Bridge($Root) {
    $exe = Join-Path (Full-Path $Root) 'EfbLanBridge.exe'
    Get-Process EfbLanBridge -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Path -eq $exe) { Stop-Process -Id $_.Id -ErrorAction Stop; $_.WaitForExit(5000) | Out-Null }
    }
}
function Update-Layout($Package) {
    $base = Full-Path $Package
    $entries = @(Get-ChildItem -LiteralPath $base -Recurse -File | Where-Object { $_.FullName -ne (Join-Path $base 'layout.json') } | Sort-Object FullName | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($base.Length + 1).Replace('\','/'); size = $_.Length; date = $_.LastWriteTimeUtc.ToFileTimeUtc() }
    })
    Write-Utf8 (Join-Path $base 'layout.json') ([ordered]@{content=$entries} | ConvertTo-Json -Depth 6)
}
function Write-HostConfig($Config) {
    $folder = Join-Path $Config.PackagePath 'html_ui\Pages\VCockpit\Instruments\PMDGTablet\lan-bridge'
    if (-not (Test-Path -LiteralPath $folder)) { throw "Bridge host files missing: $folder" }
    $js = 'window.EFB_LAN_CONFIG = ' + ([ordered]@{enabled=$true;port=$Config.Port;hostKey=$Config.HostKey} | ConvertTo-Json -Compress) + ';'
    Write-Utf8 (Join-Path $folder 'lan-bridge-config.js') $js
    Update-Layout $Config.PackagePath
}
function New-Key($Bytes) {
    $data = New-Object byte[] $Bytes; $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($data) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($data)).Replace('-','').ToLowerInvariant()
}
function Test-Port($Port) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $Port)
    try { $listener.Start() } catch { throw "Port $Port is in use. Run Install.cmd -Port 8386 (or choose another free port)." } finally { $listener.Stop() }
}
function Show-Address($Config) {
    Write-Host "`nEFB v2 LAN is installed. Pairing code: $($Config.PairingKey)" -ForegroundColor Cyan
    [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and -not [Net.IPAddress]::IsLoopback($_) } | ForEach-Object { Write-Host "  http://$($_):$($Config.Port)/" }
    Write-Host "Local test: http://127.0.0.1:$($Config.Port)/"
}
