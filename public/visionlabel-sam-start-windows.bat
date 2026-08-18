@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title VisionLabel SAM local - iniciar modelo selecionado

set "DEFAULT_SITE_URL=https://visionlabel-anotador.eduardo1089.chatgpt.site"
set "SITE_URL=%VISIONLABEL_SITE_URL%"
if not defined SITE_URL set "SITE_URL=%DEFAULT_SITE_URL%"
if "!SITE_URL:~-1!"=="/" set "SITE_URL=!SITE_URL:~0,-1!"
set "APP_DIR=%LOCALAPPDATA%\VisionLabelSAM"
set "SELECTED_MODEL_FILE=%APP_DIR%\selected-model.txt"
set "CONNECTOR=%APP_DIR%\visionlabel-sam-local.py"
set "PORT=7860"

if /I "%~1"=="--help" goto :help
if /I "%~1"=="-h" goto :help
if /I "%~1"=="/?" goto :help
if not "%~1"=="" goto :unexpected_argument
call :validate_site_url
if errorlevel 1 goto :site_error

if not exist "%SELECTED_MODEL_FILE%" (
  call :recognize_legacy_installation
  if errorlevel 1 goto :not_installed
)

set "MODEL_ID="
set /p "MODEL_ID="<"%SELECTED_MODEL_FILE%"
if /I "!MODEL_ID!"=="sam3" set "MODEL_ID=sam3-concepts"
call :set_model_metadata
if errorlevel 1 goto :invalid_state
if /I "!FAMILY!"=="wsl" goto :start_wsl_model

set "VENV_DIR=%APP_DIR%\venvs\sam1"
set "PYTHON=!VENV_DIR!\Scripts\python.exe"
set "CHECKPOINT=%APP_DIR%\models\!MODEL_ID!\!CHECKPOINT_NAME!"

if not exist "!PYTHON!" if /I "!MODEL_ID!"=="sam1-vit-b" if exist "%APP_DIR%\venv\Scripts\python.exe" (
  echo Reutilizando o ambiente antigo do SAM 1 sem movê-lo.
  set "VENV_DIR=%APP_DIR%\venv"
  set "PYTHON=!VENV_DIR!\Scripts\python.exe"
)
if not exist "!CHECKPOINT!" if /I "!MODEL_ID!"=="sam1-vit-b" if exist "%APP_DIR%\sam_vit_b_01ec64.pth" (
  echo Reutilizando o checkpoint antigo do SAM 1 ViT-B sem movê-lo.
  set "CHECKPOINT=%APP_DIR%\sam_vit_b_01ec64.pth"
)

if not exist "!PYTHON!" goto :not_installed
if not exist "!CONNECTOR!" goto :not_installed
if not exist "!CHECKPOINT!" goto :not_installed

"!PYTHON!" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if errorlevel 1 goto :old_python

"!PYTHON!" "!CONNECTOR!" --help 2>&1 | findstr /C:"--model" >nul
if errorlevel 1 goto :old_connector

echo.
echo ==========================================
echo  VisionLabel SAM - !MODEL_ID!
echo ==========================================
echo.

call :server_is_running
if not errorlevel 1 (
  echo Já existe um conector em execução na porta !PORT!.
  echo Para trocar de modelo, encerre a janela antiga antes de iniciar novamente.
  start "" "!SITE_URL!"
  timeout /t 2 >nul
  exit /b 0
)

echo Carregando o modelo selecionado. Mantenha esta janela aberta.
start "" "!SITE_URL!"
set "VISIONLABEL_ALLOWED_ORIGINS=!SITE_URL!,http://localhost:5173,http://127.0.0.1:5173"
"!PYTHON!" "!CONNECTOR!" --model "!MODEL_ID!" --checkpoint "!CHECKPOINT!" --device auto --port !PORT!
echo.
echo O conector foi encerrado. Execute este iniciador para reabri-lo.
pause
exit /b 0

:recognize_legacy_installation
if not exist "%APP_DIR%\sam_vit_b_01ec64.pth" exit /b 1
echo Instalação antiga do SAM 1 ViT-B reconhecida; nenhum arquivo será removido.
if not exist "%APP_DIR%" mkdir "%APP_DIR%"
>"%SELECTED_MODEL_FILE%.part" echo sam1-vit-b
move /Y "%SELECTED_MODEL_FILE%.part" "%SELECTED_MODEL_FILE%" >nul
if errorlevel 1 exit /b 1
exit /b 0

:set_model_metadata
set "FAMILY=sam1"
if /I "!MODEL_ID!"=="sam1-vit-b" (
  set "CHECKPOINT_NAME=sam_vit_b_01ec64.pth"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam1-vit-l" (
  set "CHECKPOINT_NAME=sam_vit_l_0b3195.pth"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam1-vit-h" (
  set "CHECKPOINT_NAME=sam_vit_h_4b8939.pth"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam2.1-hiera-tiny" (
  set "FAMILY=wsl"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam2.1-hiera-small" (
  set "FAMILY=wsl"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam2.1-hiera-base-plus" (
  set "FAMILY=wsl"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam2.1-hiera-large" (
  set "FAMILY=wsl"
  exit /b 0
)
if /I "!MODEL_ID!"=="sam3-concepts" (
  set "FAMILY=wsl"
  exit /b 0
)
exit /b 1

:server_is_running
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response=Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $env:PORT + '/health') -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
exit /b %ERRORLEVEL%

:validate_site_url
powershell -NoProfile -ExecutionPolicy Bypass -Command "$uri=$null; if (-not [Uri]::TryCreate($env:SITE_URL,[UriKind]::Absolute,[ref]$uri)) { exit 1 }; if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $env:SITE_URL -match '\s') { exit 1 }; exit 0" >nul 2>nul
exit /b %ERRORLEVEL%

:validate_wsl
where wsl.exe >nul 2>nul
if errorlevel 1 exit /b 1
wsl.exe -- bash -lc "command -v bash >/dev/null 2>&1" >nul 2>nul
if errorlevel 1 exit /b 2
wsl.exe -- bash -lc "grep -Eqi '(wsl2|microsoft-standard)' /proc/sys/kernel/osrelease" >nul 2>nul
if errorlevel 1 exit /b 3
wsl.exe -- bash -lc "command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1" >nul 2>nul
if errorlevel 1 exit /b 4
exit /b 0

:enable_wsl_site_url
set "VISIONLABEL_SITE_URL=!SITE_URL!"
if defined WSLENV (
  set "WSLENV=VISIONLABEL_SITE_URL:!WSLENV!"
) else (
  set "WSLENV=VISIONLABEL_SITE_URL"
)
exit /b 0

:start_wsl_model
echo.
echo ==========================================
echo  VisionLabel SAM via WSL2 - !MODEL_ID!
echo ==========================================
echo.

call :validate_wsl
if errorlevel 4 goto :wsl_downloader_missing
if errorlevel 3 goto :wsl2_required
if errorlevel 2 goto :wsl_distro_error
if errorlevel 1 goto :wsl_missing

call :server_is_running
if not errorlevel 1 (
  echo Já existe um conector em execução na porta !PORT!.
  echo Para trocar de modelo, encerre a janela antiga antes de iniciar novamente.
  start "" "!SITE_URL!"
  timeout /t 2 >nul
  exit /b 0
)

call :enable_wsl_site_url
echo Atualizando por HTTPS o iniciador canônico dentro do WSL2...
echo O modelo selecionado será sincronizado com ~/.visionlabel-sam/selected-model.txt.
echo.
start "" "!SITE_URL!"
wsl.exe -- bash -lc "set -euo pipefail; app_dir=$HOME/.visionlabel-sam; install_dir=$app_dir/bin; mkdir -p $install_dir; final=$install_dir/visionlabel-sam-start-macos-linux.sh; partial=$final.part.$$; selection_tmp=$app_dir/selected-model.txt.part.$$; trap 'rm -f $partial $selection_tmp' EXIT HUP INT TERM; if command -v curl >/dev/null 2>&1; then curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 --retry-delay 2 --output $partial $VISIONLABEL_SITE_URL/visionlabel-sam-start-macos-linux.sh; else wget --https-only --tries=3 --output-document=$partial $VISIONLABEL_SITE_URL/visionlabel-sam-start-macos-linux.sh; fi; test -s $partial; grep -q 'selected-model.txt' $partial; chmod 700 $partial; mv -f $partial $final; echo !MODEL_ID! >$selection_tmp; mv -f $selection_tmp $app_dir/selected-model.txt; trap - EXIT HUP INT TERM; VISIONLABEL_SITE_URL=$VISIONLABEL_SITE_URL bash $final"
if errorlevel 1 goto :wsl_start_error

echo.
echo O conector WSL2 foi encerrado normalmente.
pause
exit /b 0

:help
echo VisionLabel SAM local - iniciar modelo selecionado no Windows ou WSL2
echo.
echo Uso:
echo   visionlabel-sam-start-windows.bat
echo   visionlabel-sam-start-windows.bat --help
echo.
echo O modelo é lido de %%LOCALAPPDATA%%\VisionLabelSAM\selected-model.txt.
echo Para trocar de modelo, execute novamente o instalador.
echo SAM 1 usa o runtime nativo; SAM 2.1 e SAM 3 são delegados ao WSL2.
exit /b 0

:wsl_missing
echo.
echo O comando wsl.exe não foi encontrado.
echo Instale o WSL2 com uma distribuição Linux e tente novamente.
echo Em um PowerShell como administrador, normalmente: wsl --install
pause
exit /b 1

:wsl_distro_error
echo.
echo O WSL está instalado, mas a distribuição Linux padrão não iniciou com bash.
echo Abra a distribuição uma vez para concluir a configuração e tente novamente.
pause
exit /b 1

:wsl2_required
echo.
echo A distribuição Linux padrão não parece estar usando WSL2.
echo Converta-a com: wsl --set-version NOME_DA_DISTRIBUICAO 2
echo Consulte os nomes disponíveis com: wsl --list --verbose
pause
exit /b 1

:wsl_downloader_missing
echo.
echo O WSL2 precisa de curl ou wget para baixar o iniciador canônico por HTTPS.
echo No Ubuntu, execute: sudo apt update ^&^& sudo apt install -y curl
pause
exit /b 1

:wsl_start_error
echo.
echo Não foi possível iniciar !MODEL_ID! pelo WSL2.
echo Downloads incompletos do iniciador foram removidos; nenhum checkpoint fica no projeto.
echo Se o runtime ou checkpoint ainda não existir, execute visionlabel-sam-windows.bat !MODEL_ID!.
pause
exit /b 1

:old_connector
echo.
echo O conector instalado é antigo e não aceita --model.
echo Execute novamente visionlabel-sam-windows.bat para baixar o conector canônico.
pause
exit /b 1

:old_python
echo.
echo O ambiente instalado usa um Python antigo; o conector atual exige Python 3.10+.
echo Execute novamente visionlabel-sam-windows.bat para criar o runtime SAM 1 atualizado.
pause
exit /b 1

:not_installed
echo.
echo A instalação completa do modelo selecionado não foi encontrada.
echo Execute primeiro visionlabel-sam-windows.bat e escolha o modelo desejado.
start "" "!SITE_URL!"
pause
exit /b 1

:invalid_state
echo.
echo O arquivo selected-model.txt contém um ID inválido: !MODEL_ID!
echo Execute novamente o instalador para selecionar um modelo válido.
pause
exit /b 1

:unexpected_argument
echo Erro: este iniciador não recebe modelo. Use o instalador para trocar a seleção.
echo Execute com --help para mais detalhes.
exit /b 1

:site_error
echo Erro: VISIONLABEL_SITE_URL deve usar HTTPS.
exit /b 1
