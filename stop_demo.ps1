# Stops the ML Nowcast demo: only the processes LISTENING on ports 8001 (ML serve API),
# 8000 (team backend) and 5173 (frontend dev server). Nothing else is touched; the three
# windows opened by start_demo.ps1 stay open (showing the exit) and can be closed by hand.
$names = @{ 8001 = 'ML serve API'; 8000 = 'team backend'; 5173 = 'frontend (Vite)' }
foreach ($port in 8001, 8000, 5173) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { Write-Host ("Port {0} ({1}): nothing listening" -f $port, $names[$port]); continue }
    foreach ($procId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host ("Port {0} ({1}): stopped PID {2} {3}" -f $port, $names[$port], $procId, $p.ProcessName) -ForegroundColor Green
        } catch {
            Write-Host ("Port {0} ({1}): could not stop PID {2}: {3}" -f $port, $names[$port], $procId, $_.Exception.Message) -ForegroundColor Red
        }
    }
}
Start-Sleep -Seconds 1
foreach ($port in 8001, 8000, 5173) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host ("Port {0} is still in use." -f $port) -ForegroundColor Red
    }
}
