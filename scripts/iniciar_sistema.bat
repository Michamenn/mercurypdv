@echo off
REM ============================================================
REM  Lanchonete Pro - Inicializacao do sistema (Windows 11)
REM  - Verifica Node.js
REM  - Instala dependencias se necessario
REM  - Inicia o servidor em janela minimizada
REM  - Abre o navegador em modo quiosque (tela cheia)
REM ============================================================
setlocal
cd /d "%~dp0.."

echo ============================================
echo   Lanchonete Pro - iniciando...
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale o Node.js LTS ^(v20 ou superior^) em https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo Instalando dependencias ^(apenas na primeira vez^)...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

if not exist "data" mkdir "data"
if not exist "logs" mkdir "logs"

REM Servidor em janela propria (minimizada). O PID e gravado em data\servidor.pid
start "LanchonetePro-Servidor" /min cmd /c "node server/src/index.js > logs\servidor.log 2>&1"

REM aguarda o servidor responder
set /a tentativas=0
:esperar
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $null = (New-Object Net.WebClient).DownloadString('http://127.0.0.1:3000/health'); exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  set /a tentativas+=1
  if %tentativas% lss 15 goto esperar
  echo [AVISO] Servidor nao respondeu em 15s. Veja logs\servidor.log
)

echo Servidor ativo em http://localhost:3000
echo Abrindo navegador em modo quiosque...

REM Microsoft Edge (nativo no Windows 11) em tela cheia; troque o caminho do atalho por --kiosk se preferir
start msedge --window-size=1920,1080 --start-fullscreen "http://localhost:3000"
REM Alternativa Chrome:
REM start chrome --kiosk "http://localhost:3000"

echo.
echo Para encerrar: execute scripts\parar_sistema.bat
endlocal
