@echo off
REM ============================================================
REM  Lanchonete Pro - Encerramento controlado
REM  Preferencia: fechar a janela do servidor com Ctrl+C
REM  (encerramento gracioso com checkpoint do WAL).
REM  Este script e o plano B: encerra o processo pelo PID.
REM ============================================================
setlocal
cd /d "%~dp0.."

powershell -NoProfile -Command ^
  "$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($conns) { $conns | ForEach-Object { Write-Host ('Encerrando PID ' + $_.OwningProcess); Stop-Process -Id $_.OwningProcess -Force }; 'Servidor encerrado.' }" ^
  "else { 'Nenhum servidor ativo na porta 3000.' }"

REM remove PID file se existir
if exist "data\servidor.pid" del "data\servidor.pid"
endlocal
