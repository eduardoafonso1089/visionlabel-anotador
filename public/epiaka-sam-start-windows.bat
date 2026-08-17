@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Epiaka SAM local - iniciar servidor

set "APP_DIR=%LOCALAPPDATA%\EpiakaSAM"
set "PYTHON=%APP_DIR%\venv\Scripts\python.exe"
set "CONNECTOR=%APP_DIR%\epiaka-sam-local.py"
set "CHECKPOINT=%APP_DIR%\sam_vit_b_01ec64.pth"
set "SITE_URL=https://www.epiaka.com"

echo.
echo ==========================================
echo   Epiaka SAM - iniciar novamente
echo ==========================================
echo.

if not exist "%PYTHON%" goto :not_installed
if not exist "%CONNECTOR%" goto :not_installed
if not exist "%CHECKPOINT%" goto :not_installed

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:7860/health' -TimeoutSec 2; if($response.StatusCode -eq 200){exit 0} } catch {}; exit 1"
if not errorlevel 1 (
  echo O servidor SAM ja esta em execucao.
  start "" "%SITE_URL%"
  timeout /t 2 >nul
  exit /b 0
)

echo Carregando o modelo instalado. Mantenha esta janela aberta.
start "" "%SITE_URL%"
"%PYTHON%" "%CONNECTOR%" --checkpoint "%CHECKPOINT%" --model-type vit_b --device auto
echo.
echo O servidor foi encerrado. Execute este iniciador novamente para reabri-lo.
pause
exit /b 0

:not_installed
echo A instalacao completa do SAM nao foi encontrada neste computador.
echo Abra o Epiaka e use primeiro o botao "Instalar no Windows".
start "" "%SITE_URL%"
pause
exit /b 1
