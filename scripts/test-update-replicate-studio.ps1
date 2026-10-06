# Isolated Windows fixtures: no network, packages, credentials, or real installation.
$ErrorActionPreference = 'Stop'
$updateScript = Join-Path $PSScriptRoot 'update-replicate-studio.ps1'
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($updateScript, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('ytb-update-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$global:YtbUpdateTestMode = 'normal'

function Assert-Equal($actual, $expected, $message) {
    if ($actual -ne $expected) { throw "Assertion failed: $message" }
}
function New-Fixture($name) {
    $fixture = Join-Path $testRoot $name
    foreach ($file in @('index.html', 'backend\__main__.py', '.venv\Scripts\python.exe', '.env', 'render-data\keep.txt')) {
        $target = Join-Path $fixture $file
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Set-Content -LiteralPath $target -Value "previous:$file" -Encoding UTF8
    }
    return $fixture
}
function Assert-Preserved($fixture) {
    foreach ($file in @('.venv\Scripts\python.exe', '.env', 'render-data\keep.txt')) {
        Assert-Equal (Get-Content -LiteralPath (Join-Path $fixture $file) -Raw).Trim() "previous:$file" "Private file changed: $file"
    }
}
function Invoke-FailingUpdate($fixture) {
    $failed = $false
    try { & $updateScript -Revision ('a' * 40) -ProjectPath $fixture }
    catch { $failed = $true }
    Assert-Equal $failed $true 'Fixture should fail'
    Assert-Equal (Get-Content -LiteralPath (Join-Path $fixture 'index.html') -Raw).Trim() 'previous:index.html' 'Original index should remain'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $fixture 'replicate-studio.js')) $false 'New files should not remain after failure'
    Assert-Preserved $fixture
}

function global:Get-NetTCPConnection {
    [CmdletBinding()] param([int]$LocalPort, [string]$State)
    return @()
}
function global:Invoke-WebRequest {
    [CmdletBinding()] param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing, [int]$TimeoutSec)
    if ($global:YtbUpdateTestMode -eq 'download-error' -and $Uri.EndsWith('/backend/models.py')) {
        throw 'Simulated download failure'
    }
    Set-Content -LiteralPath $OutFile -Value "downloaded:$Uri" -Encoding UTF8
}
function global:Copy-Item {
    [CmdletBinding()] param([string]$LiteralPath, [string]$Destination, [switch]$Force)
    if ($global:YtbUpdateTestMode -eq 'copy-error' -and $LiteralPath -match '[\\/]download[\\/]' -and $LiteralPath.EndsWith('creator-core.js')) {
        $global:YtbUpdateTestMode = 'normal'
        throw 'Simulated replacement failure after partial copy'
    }
    Microsoft.PowerShell.Management\Copy-Item @PSBoundParameters
}

try {
    $success = New-Fixture 'success'
    & $updateScript -Revision ('a' * 40) -ProjectPath $success
    Assert-Equal ((Get-Content -LiteralPath (Join-Path $success 'index.html') -Raw).StartsWith('downloaded:')) $true 'Index should be updated'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $success 'backend\replicate_studio.py')) $true 'New module should be installed'
    $previous = Get-ChildItem -LiteralPath (Join-Path $success 'update-backups') -Recurse -Filter 'index.html' |
        Where-Object { $_.FullName -match '[\\/]previous[\\/]' } | Select-Object -First 1
    Assert-Equal (Get-Content -LiteralPath $previous.FullName -Raw).Trim() 'previous:index.html' 'Backup should contain the original bytes'
    Assert-Preserved $success
    $global:YtbUpdateTestMode = 'download-error'
    Invoke-FailingUpdate (New-Fixture 'download-failure')
    $global:YtbUpdateTestMode = 'copy-error'
    Invoke-FailingUpdate (New-Fixture 'copy-failure')
    Write-Host 'Windows updater checks passed: syntax, complete download, backup, data preservation and rollback.'
} finally {
    Remove-Item -LiteralPath 'Function:\Invoke-WebRequest', 'Function:\Copy-Item', 'Function:\Get-NetTCPConnection'
    Remove-Variable -Name YtbUpdateTestMode -Scope Global
}
