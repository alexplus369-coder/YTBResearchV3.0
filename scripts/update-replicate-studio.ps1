param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{40}$')]
    [string]$Revision,
    [string]$ProjectPath = (Get-Location).Path
)

# Updates an existing ZIP installation from one immutable GitHub commit.
# Does not read keys, stop processes, install packages, or touch render-data/.venv/.env.
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath $ProjectPath).Path
foreach ($required in @('index.html', 'backend\__main__.py', '.venv\Scripts\python.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $required))) {
        throw "No es una instalacion existente de YTBResearch: falta $required. Ejecuta desde la carpeta del proyecto."
    }
}
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Deten primero el backend con Ctrl+C. No se actualizan archivos mientras el puerto 8787 esta en uso.'
    }
}

$files = @(
    'index.html', 'research-core.js', 'research-workspace.js', 'creator-core.js',
    'creator-studio.js', 'replicate-catalog.js', 'replicate-value.js', 'replicate-studio.js', 'video-production.js',
    'backend/__init__.py', 'backend/__main__.py', 'backend/api.py', 'backend/captions.py',
    'backend/config.py', 'backend/models.py', 'backend/pipeline.py', 'backend/process.py',
    'backend/providers.py', 'backend/replicate_catalog.json', 'backend/replicate_studio.py', 'backend/svg_media.py',
    'backend/store.py', 'backend/uploader.py', 'backend/worker.py', 'backend/requirements.txt',
    'docs/video-production.md', 'docs/third-party-notices.md'
)
$runName = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N')
$runRoot = Join-Path (Join-Path $projectRoot 'update-backups') $runName
$stage = Join-Path $runRoot 'download'
$backup = Join-Path $runRoot 'previous'
$existing = @{}
New-Item -ItemType Directory -Path $stage, $backup -Force | Out-Null

# Download everything before replacing anything. A network failure leaves the app unchanged.
foreach ($file in $files) {
    $target = Join-Path $stage $file
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    $uri = "https://raw.githubusercontent.com/alexplus369-coder/YTBResearchV3.0/$Revision/$file"
    Write-Host "Descargando $file"
    Invoke-WebRequest -Uri $uri -OutFile $target -UseBasicParsing -TimeoutSec 90
    if ((Get-Item -LiteralPath $target).Length -eq 0) { throw "Descarga vacia: $file" }
}

# Back up source files only, preserving their bytes. Private data and environment files are excluded.
foreach ($file in $files) {
    $current = Join-Path $projectRoot $file
    $existing[$file] = Test-Path -LiteralPath $current
    if ($existing[$file]) {
        $saved = Join-Path $backup $file
        New-Item -ItemType Directory -Path (Split-Path -Parent $saved) -Force | Out-Null
        Copy-Item -LiteralPath $current -Destination $saved
    }
}
@{ revision = $Revision; existing = $existing } | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $runRoot 'manifest.json') -Encoding UTF8

try {
    foreach ($file in $files) {
        $target = Join-Path $projectRoot $file
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $stage $file) -Destination $target -Force
    }
} catch {
    $copyError = $_
    $restorationErrors = @()
    foreach ($file in $files) {
        $target = Join-Path $projectRoot $file
        try {
            if ($existing[$file]) {
                Copy-Item -LiteralPath (Join-Path $backup $file) -Destination $target -Force
            } elseif (Test-Path -LiteralPath $target) {
                Remove-Item -LiteralPath $target -Force
            }
        } catch {
            $restorationErrors += $file
        }
    }
    if ($restorationErrors.Count -gt 0) {
        throw "Actualizacion y restauracion incompletas. Recupera desde $backup los archivos: $($restorationErrors -join ', '). Error original: $copyError"
    }
    throw "Actualizacion no completada; se restauraron los archivos anteriores. $copyError"
}

Write-Host "Actualizacion lista. Copia anterior: $backup"
Write-Host 'Tus datos, entorno Python y claves no se han modificado.'
Write-Host 'Ahora ejecuta:'
Write-Host '  .\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt'
Write-Host '  .\.venv\Scripts\python.exe -m backend'
Write-Host 'Despues: Ctrl+F5 en el navegador y Conectar motor con el nuevo codigo.'
