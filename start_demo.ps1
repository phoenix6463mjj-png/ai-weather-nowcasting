# Starts the ML Nowcast demo: three PowerShell windows (commands as in INTEGRATION.md, section 1),
#   1) ML serving API          nowcast_data  -> http://127.0.0.1:8001
#   2) team backend (/ml proxy) team_app/backend -> http://127.0.0.1:8000
#   3) frontend dev server      team_app/frontend/frontend-react -> http://localhost:5173
# waits until each one answers (60 s each), then opens http://localhost:5173/nowcast.
# Stop everything with stop_demo.ps1.
#
# Locations (override with env vars if your layout differs):
#   NOWCAST_DATA_ROOT  default: the nowcast_data folder next to this repo
#   NOWCAST_PYTHON     default: .venv\Scripts\python.exe next to this repo
#   NODE_DIR           default: <Program Files>\nodejs   (must provide Node v24.19.0)
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$teamApp = $PSScriptRoot
$parent = Split-Path $teamApp -Parent
$dataRoot = if ($env:NOWCAST_DATA_ROOT) { $env:NOWCAST_DATA_ROOT } else { Join-Path $parent 'nowcast_data' }
$python = if ($env:NOWCAST_PYTHON) { $env:NOWCAST_PYTHON } else { Join-Path $parent '.venv\Scripts\python.exe' }
$nodeDir = if ($env:NODE_DIR) { $env:NODE_DIR } else { Join-Path $env:ProgramFiles 'nodejs' }
$frontend = Join-Path $teamApp 'frontend\frontend-react'
$backend = Join-Path $teamApp 'backend'

$services = @(
    @{ Name = 'ML serve API'; Port = 8001; Url = 'http://127.0.0.1:8001/api/health' },
    @{ Name = 'team backend (/ml proxy)'; Port = 8000; Url = 'http://127.0.0.1:8000/ml/health' },
    @{ Name = 'frontend (Vite)'; Port = 5173; Url = 'http://localhost:5173/nowcast' }
)

# ---- preflight: paths exist, no port already taken
foreach ($p in @($dataRoot, $python, $backend, $frontend, (Join-Path $nodeDir 'node.exe'))) {
    if (-not (Test-Path $p)) { Write-Host "Not found: $p  (see the header of this script for overrides)" -ForegroundColor Red; exit 1 }
}
$busy = $false
foreach ($s in $services) {
    $conns = Get-NetTCPConnection -LocalPort $s.Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
        $cmd = if ($proc) { $proc.CommandLine } else { '' }
        Write-Host ("Port {0} ({1}) is already in use by PID {2} {3}: {4}" -f $s.Port, $s.Name, $c.OwningProcess, $proc.Name, $cmd) -ForegroundColor Red
        $busy = $true
    }
}
if ($busy) { Write-Host 'Nothing started. Run stop_demo.ps1 (or close that program) and try again.' -ForegroundColor Red; exit 1 }

# ---- launch the three windows (each sets its own environment, as in INTEGRATION.md)
function Start-Window($title, $workDir, $commands) {
    $script = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location -LiteralPath '$workDir'; $commands"
    Start-Process powershell.exe -WorkingDirectory $workDir -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $script) | Out-Null
}

Start-Window 'Nowcast 1/3: ML serve :8001' $dataRoot (
    "`$env:NOWCAST_DATA_ROOT = '$dataRoot'; " +
    "`$env:ML_CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'; " +
    "& '$python' -m uvicorn serve.app:app --port 8001")

Start-Window 'Nowcast 2/3: team backend :8000' $backend (
    "`$env:ML_API_URL = 'http://127.0.0.1:8001/api'; " +
    "& '$python' -m uvicorn main:app --port 8000")

Start-Window 'Nowcast 3/3: frontend :5173' $frontend (
    "`$env:Path = '$nodeDir;' + `$env:Path; " +
    "`$v = node -v; Write-Host ('node ' + `$v); " +
    "if (`$v -ne 'v24.19.0') { Write-Host 'Node must be v24.19.0: not starting the dev server.' -ForegroundColor Red } " +
    "else { `$env:VITE_ML_API_BASE = 'http://127.0.0.1:8000/ml'; npm run dev }")

# ---- wait until each service answers (60 s each)
$failed = @()
foreach ($s in $services) {
    Write-Host ("Waiting for {0} on :{1} ..." -f $s.Name, $s.Port) -NoNewline
    $deadline = (Get-Date).AddSeconds(60)
    $ok = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $s.Url -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -eq 200) { $ok = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if ($ok) { Write-Host ' ok' -ForegroundColor Green }
    else { Write-Host (' FAILED: no answer from {0} within 60 s (see its window)' -f $s.Url) -ForegroundColor Red; $failed += $s.Name }
}
if ($failed.Count) {
    Write-Host ("Not ready: {0}. Check those windows; stop everything with stop_demo.ps1." -f ($failed -join ', ')) -ForegroundColor Red
    exit 1
}

Write-Host 'All three are up: http://localhost:5173/nowcast' -ForegroundColor Green
if (-not $NoBrowser) { Start-Process 'http://localhost:5173/nowcast' }
