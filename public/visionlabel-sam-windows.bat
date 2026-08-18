@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title VisionLabel SAM local - instalar modelo

set "DEFAULT_SITE_URL=https://visionlabel-anotador.eduardo1089.chatgpt.site"
set "SITE_URL=%VISIONLABEL_SITE_URL%"
if not defined SITE_URL set "SITE_URL=%DEFAULT_SITE_URL%"
if "!SITE_URL:~-1!"=="/" set "SITE_URL=!SITE_URL:~0,-1!"
set "APP_DIR=%LOCALAPPDATA%\VisionLabelSAM"
set "VENVS_DIR=%APP_DIR%\venvs"
set "MODELS_DIR=%APP_DIR%\models"
set "CONNECTOR=%APP_DIR%\visionlabel-sam-local.py"
set "SELECTED_MODEL_FILE=%APP_DIR%\selected-model.txt"
set "PORT=7860"
set "SAM1_REVISION=dca509fe793f601edb92606367a655c15ac00fdf"

if /I "%~1"=="--help" goto :help
if /I "%~1"=="-h" goto :help
if /I "%~1"=="/?" goto :help
if not "%~2"=="" goto :too_many_args
call :validate_site_url
if errorlevel 1 goto :site_error

set "MODEL_ID=%~1"
if not defined MODEL_ID (
  call :choose_model
  if errorlevel 1 goto :invalid_model
)
if /I "!MODEL_ID!"=="sam3" set "MODEL_ID=sam3-concepts"

call :set_model_metadata
if errorlevel 1 goto :invalid_model
if /I "!FAMILY!"=="wsl" goto :install_wsl_model

echo.
echo ==========================================
echo  VisionLabel SAM local - !MODEL_ID!
echo ==========================================
echo.

if not exist "%APP_DIR%" mkdir "%APP_DIR%"
if not exist "%VENVS_DIR%" mkdir "%VENVS_DIR%"
if not exist "%MODELS_DIR%" mkdir "%MODELS_DIR%"

call :find_python
if errorlevel 1 goto :python_error

if not exist "!VENV_DIR!\Scripts\python.exe" (
  echo Criando ambiente isolado da família SAM 1...
  if defined USE_PY_LAUNCHER (
    py -3 -m venv "!VENV_DIR!"
  ) else (
    "!SYSTEM_PYTHON!" -m venv "!VENV_DIR!"
  )
  if errorlevel 1 goto :venv_error
)
set "PYTHON=!VENV_DIR!\Scripts\python.exe"

set "READY_FILE=!VENV_DIR!\.visionlabel-sam1-!SAM1_REVISION!.ok"
if exist "!READY_FILE!" (
  "!PYTHON!" -c "import cv2, fastapi, segment_anything, torch, uvicorn" >nul 2>nul
  if not errorlevel 1 goto :dependencies_ready
)

echo Instalando PyTorch e dependências oficiais do SAM 1. Aguarde...
"!PYTHON!" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto :install_error
"!PYTHON!" -m pip install torch torchvision
if errorlevel 1 goto :install_error
"!PYTHON!" -m pip install "https://github.com/facebookresearch/segment-anything/archive/!SAM1_REVISION!.zip"
if errorlevel 1 goto :install_error
"!PYTHON!" -m pip install fastapi uvicorn pillow opencv-python-headless numpy
if errorlevel 1 goto :install_error
>"!READY_FILE!" echo pronto

:dependencies_ready
call :download_connector
if errorlevel 1 goto :connector_error

call :migrate_legacy_vit_b
if errorlevel 1 goto :migration_error

if not exist "!CHECKPOINT!" (
  echo Baixando checkpoint oficial !CHECKPOINT_NAME!...
  if not exist "!MODEL_DIR!" mkdir "!MODEL_DIR!"
  set "CHECKPOINT_PART=!CHECKPOINT!.part"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='Continue'; Invoke-WebRequest -UseBasicParsing -Uri $env:MODEL_URL -OutFile $env:CHECKPOINT_PART; if ((Get-Item -LiteralPath $env:CHECKPOINT_PART).Length -le 0) { exit 2 }"
  if errorlevel 1 goto :download_error
  move /Y "!CHECKPOINT_PART!" "!CHECKPOINT!" >nul
  if errorlevel 1 goto :download_error
)

call :save_windows_selection
if errorlevel 1 goto :state_error

echo.
echo Modelo !MODEL_ID! instalado e selecionado.
echo A seleção foi salva em !SELECTED_MODEL_FILE!.
start "" "!SITE_URL!"

call :server_is_running
if not errorlevel 1 (
  echo.
  echo Já existe um conector em execução na porta !PORT!.
  echo Feche a janela antiga e use o iniciador para carregar !MODEL_ID!.
  exit /b 0
)

echo Mantenha esta janela aberta enquanto usar o SAM.
echo.
set "VISIONLABEL_ALLOWED_ORIGINS=!SITE_URL!,http://localhost:5173,http://127.0.0.1:5173"
"!PYTHON!" "!CONNECTOR!" --model "!MODEL_ID!" --checkpoint "!CHECKPOINT!" --device auto --port !PORT!
echo.
echo O conector foi encerrado. Execute o iniciador para abri-lo novamente.
pause
exit /b 0

:choose_model
echo.
echo Escolha o modelo:
echo.
echo   1^) SAM 1 ViT-B          ^(~375 MB; imagem^)
echo   2^) SAM 1 ViT-L          ^(~1,25 GB; imagem^)
echo   3^) SAM 1 ViT-H          ^(~2,56 GB; imagem^)
echo   4^) SAM 2.1 Hiera Tiny   ^(instalação automática no WSL2^)
echo   5^) SAM 2.1 Hiera Small  ^(WSL2; recomendado^)
echo   6^) SAM 2.1 Hiera Base+  ^(instalação automática no WSL2^)
echo   7^) SAM 2.1 Hiera Large  ^(instalação automática no WSL2^)
echo   8^) SAM 3 Concepts       ^(WSL2 + GPU NVIDIA^)
echo.
set /p "MODEL_CHOICE=Digite 1-8 ou o ID completo: "
if "!MODEL_CHOICE!"=="1" (
  set "MODEL_ID=sam1-vit-b"
  exit /b 0
)
if "!MODEL_CHOICE!"=="2" (
  set "MODEL_ID=sam1-vit-l"
  exit /b 0
)
if "!MODEL_CHOICE!"=="3" (
  set "MODEL_ID=sam1-vit-h"
  exit /b 0
)
if "!MODEL_CHOICE!"=="4" (
  set "MODEL_ID=sam2.1-hiera-tiny"
  exit /b 0
)
if "!MODEL_CHOICE!"=="5" (
  set "MODEL_ID=sam2.1-hiera-small"
  exit /b 0
)
if "!MODEL_CHOICE!"=="6" (
  set "MODEL_ID=sam2.1-hiera-base-plus"
  exit /b 0
)
if "!MODEL_CHOICE!"=="7" (
  set "MODEL_ID=sam2.1-hiera-large"
  exit /b 0
)
if "!MODEL_CHOICE!"=="8" (
  set "MODEL_ID=sam3-concepts"
  exit /b 0
)
set "MODEL_ID=!MODEL_CHOICE!"
if not defined MODEL_ID exit /b 1
exit /b 0

:set_model_metadata
set "FAMILY=sam1"
set "VENV_DIR=%VENVS_DIR%\sam1"
if /I "!MODEL_ID!"=="sam1-vit-b" (
  set "CHECKPOINT_NAME=sam_vit_b_01ec64.pth"
  set "MODEL_URL=https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
  goto :model_metadata_ready
)
if /I "!MODEL_ID!"=="sam1-vit-l" (
  set "CHECKPOINT_NAME=sam_vit_l_0b3195.pth"
  set "MODEL_URL=https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth"
  goto :model_metadata_ready
)
if /I "!MODEL_ID!"=="sam1-vit-h" (
  set "CHECKPOINT_NAME=sam_vit_h_4b8939.pth"
  set "MODEL_URL=https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth"
  goto :model_metadata_ready
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

:model_metadata_ready
set "MODEL_DIR=%MODELS_DIR%\!MODEL_ID!"
set "CHECKPOINT=!MODEL_DIR!\!CHECKPOINT_NAME!"
exit /b 0

:find_python
set "USE_PY_LAUNCHER="
set "SYSTEM_PYTHON="
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
  if not errorlevel 1 (
    set "USE_PY_LAUNCHER=1"
    exit /b 0
  )
)
where python >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%P in ('where python') do if not defined SYSTEM_PYTHON set "SYSTEM_PYTHON=%%P"
  "!SYSTEM_PYTHON!" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
  if not errorlevel 1 exit /b 0
  set "SYSTEM_PYTHON="
)
where winget >nul 2>nul
if errorlevel 1 exit /b 1
echo Python 3.10+ não foi encontrado. Instalando Python 3.11 no perfil do usuário...
winget install -e --id Python.Python.3.11 --scope user --accept-package-agreements --accept-source-agreements
if errorlevel 1 exit /b 1
set "SYSTEM_PYTHON=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not exist "!SYSTEM_PYTHON!" exit /b 1
exit /b 0

:download_connector
set "CONNECTOR_URL=!SITE_URL!/visionlabel-sam-local.py"
set "CONNECTOR_PART=!CONNECTOR!.part"
echo Baixando o conector canônico do VisionLabel...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='Continue'; Invoke-WebRequest -UseBasicParsing -Uri $env:CONNECTOR_URL -OutFile $env:CONNECTOR_PART; if ((Get-Item -LiteralPath $env:CONNECTOR_PART).Length -le 0) { exit 2 }"
if errorlevel 1 exit /b 1
findstr /C:"--model" "!CONNECTOR_PART!" >nul 2>nul
if errorlevel 1 (
  del /Q "!CONNECTOR_PART!" >nul 2>nul
  exit /b 1
)
move /Y "!CONNECTOR_PART!" "!CONNECTOR!" >nul
if errorlevel 1 exit /b 1
exit /b 0

:migrate_legacy_vit_b
if /I not "!MODEL_ID!"=="sam1-vit-b" exit /b 0
if exist "!CHECKPOINT!" exit /b 0
set "LEGACY_CHECKPOINT=%APP_DIR%\sam_vit_b_01ec64.pth"
if not exist "!LEGACY_CHECKPOINT!" exit /b 0
echo Instalação ViT-B antiga encontrada; preservando o original e copiando-o para o novo layout...
if not exist "!MODEL_DIR!" mkdir "!MODEL_DIR!"
copy /Y "!LEGACY_CHECKPOINT!" "!CHECKPOINT!.part" >nul
if errorlevel 1 exit /b 1
move /Y "!CHECKPOINT!.part" "!CHECKPOINT!" >nul
if errorlevel 1 exit /b 1
exit /b 0

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

:save_windows_selection
if not exist "!APP_DIR!" mkdir "!APP_DIR!"
if errorlevel 1 exit /b 1
>"!SELECTED_MODEL_FILE!.part" echo !MODEL_ID!
if errorlevel 1 exit /b 1
move /Y "!SELECTED_MODEL_FILE!.part" "!SELECTED_MODEL_FILE!" >nul
if errorlevel 1 exit /b 1
exit /b 0

:install_wsl_model
echo.
echo ==========================================
echo  VisionLabel SAM via WSL2 - !MODEL_ID!
echo ==========================================
echo.
echo O modelo e as dependências serão mantidos em ~/.visionlabel-sam dentro do WSL2.
echo Nenhum checkpoint será copiado para a pasta do projeto.
echo.

call :validate_wsl
if errorlevel 4 goto :wsl_downloader_missing
if errorlevel 3 goto :wsl2_required
if errorlevel 2 goto :wsl_distro_error
if errorlevel 1 goto :wsl_missing

call :save_windows_selection
if errorlevel 1 goto :state_error
call :enable_wsl_site_url

echo Baixando por HTTPS o instalador canônico para um arquivo temporário no WSL2...
echo A seleção também foi salva em !SELECTED_MODEL_FILE!.
echo.
start "" "!SITE_URL!"
wsl.exe -- bash -lc "set -euo pipefail; install_dir=$HOME/.visionlabel-sam/bin; mkdir -p $install_dir; final=$install_dir/visionlabel-sam-macos-linux.sh; partial=$final.part.$$; trap 'rm -f $partial' EXIT HUP INT TERM; if command -v curl >/dev/null 2>&1; then curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 --retry-delay 2 --output $partial $VISIONLABEL_SITE_URL/visionlabel-sam-macos-linux.sh; else wget --https-only --tries=3 --output-document=$partial $VISIONLABEL_SITE_URL/visionlabel-sam-macos-linux.sh; fi; test -s $partial; grep -q 'sam3-concepts' $partial; chmod 700 $partial; mv -f $partial $final; trap - EXIT HUP INT TERM; VISIONLABEL_SITE_URL=$VISIONLABEL_SITE_URL bash $final !MODEL_ID!"
if errorlevel 1 goto :wsl_install_error

echo.
echo O instalador WSL2 foi encerrado normalmente.
echo Para reutilizar o modelo, execute visionlabel-sam-start-windows.bat.
pause
exit /b 0

:help
echo VisionLabel SAM local - instalador para Windows e WSL2
echo.
echo Uso:
echo   visionlabel-sam-windows.bat [MODELO]
echo   visionlabel-sam-windows.bat --help
echo.
echo SAM 1 é instalado nativamente: sam1-vit-b, sam1-vit-l, sam1-vit-h.
echo SAM 2.1 é instalado automaticamente na distribuição WSL2 padrão.
echo SAM 3 também usa WSL2 e exige GPU NVIDIA disponível no WSL,
echo Python 3.12+ e um runtime CUDA compatível com 12.6+.
echo.
echo O alias sam3 é aceito e normalizado para sam3-concepts.
exit /b 0

:wsl_missing
echo.
echo O comando wsl.exe não foi encontrado.
echo Instale o WSL2 com uma distribuição Linux e execute este instalador novamente.
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
echo O WSL2 precisa de curl ou wget para baixar o instalador canônico por HTTPS.
echo No Ubuntu, execute: sudo apt update ^&^& sudo apt install -y curl
pause
exit /b 1

:wsl_install_error
echo.
echo A instalação de !MODEL_ID! no WSL2 falhou ou foi interrompida.
echo Downloads incompletos do instalador foram removidos; checkpoints ficam somente no WSL2.
echo Revise a mensagem acima, corrija o pré-requisito indicado e execute novamente.
pause
exit /b 1

:too_many_args
echo Erro: informe no máximo um modelo. Use --help para ver os IDs.
exit /b 1

:site_error
echo Erro: VISIONLABEL_SITE_URL deve usar HTTPS.
exit /b 1

:invalid_model
echo Erro: modelo inválido. Use --help para ver os IDs aceitos.
exit /b 1

:python_error
echo.
echo Não foi possível localizar ou instalar Python 3.10+.
echo Instale Python 3.11 em https://www.python.org/downloads/ e tente novamente.
pause
exit /b 1

:venv_error
echo.
echo Não foi possível criar o ambiente isolado em !VENV_DIR!.
pause
exit /b 1

:install_error
echo.
echo A instalação das dependências falhou. Verifique a conexão HTTPS e tente novamente.
pause
exit /b 1

:connector_error
echo.
echo Não foi possível baixar um conector canônico compatível de !SITE_URL!.
echo Nenhum conector parcial foi ativado.
pause
exit /b 1

:migration_error
echo.
echo A instalação antiga foi preservada, mas não foi possível copiá-la para o novo layout.
pause
exit /b 1

:download_error
echo.
echo O download HTTPS do checkpoint oficial falhou. O arquivo parcial não foi ativado.
pause
exit /b 1

:state_error
echo.
echo Não foi possível salvar a seleção em !SELECTED_MODEL_FILE!.
echo Nenhum arquivo de seleção parcial foi ativado.
pause
exit /b 1
