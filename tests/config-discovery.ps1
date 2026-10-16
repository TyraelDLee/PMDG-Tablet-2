$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path $PSScriptRoot) 'installer\Install.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Installer parse failed' }
$assignment = $ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -match '\$candidates$'}, $true)
if (-not $assignment) { throw 'Discovery assignment not found' }
$discovery = [scriptblock]::Create($assignment.Extent.Text)
# Exercise the actual assignment with zero, one and two detected installations.
# Mock filesystem probes only; do not run installation or touch simulator files.
foreach ($expected in @(0, 1, 2)) {
    $script:probes = 0
    $script:matches = $expected
    function Test-Path { param($LiteralPath) $script:probes++; return ($script:probes -le $script:matches) }
    . $discovery
    if (@($candidates).Count -ne $expected) { throw "Wrong candidate count for $expected matches" }
    if ($expected -eq 1) {
        $wanted = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache'
        if ($candidates[0] -ne $wanted) { throw 'Single candidate was truncated' }
    }
}
Write-Host 'PASS: zero, single and multiple candidates retain complete paths'
