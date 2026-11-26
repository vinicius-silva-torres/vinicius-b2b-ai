@echo off
setlocal
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Instale o Node.js 22 ou mais recente em https://nodejs.org/ e execute novamente.
  pause
  exit /b 1
)
set "LIGACOES_PASTA=%LOCALAPPDATA%\VWS-Ligacoes"
if defined B2B_LIGACOES_DIR set "LIGACOES_PASTA=%B2B_LIGACOES_DIR%"
if "%~1"=="" if not exist "%LIGACOES_PASTA%\config.json" (
  node "%~dp0server.mjs" --demo
  goto :finish
)
node "%~dp0server.mjs" %*
:finish
if errorlevel 1 pause
