@echo off
chcp 65001 >nul
setlocal EnableExtensions
title VisionLabel SAM local

set "APP_DIR=%LOCALAPPDATA%\VisionLabelSAM"
set "VENV_DIR=%APP_DIR%\venv"
set "CONNECTOR=%APP_DIR%\visionlabel-sam-local.py"
set "CHECKPOINT=%APP_DIR%\sam_vit_b_01ec64.pth"
set "READY_FILE=%APP_DIR%\dependencies-v2.ok"
set "MODEL_URL=https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
set "SITE_URL=https://visionlabel-anotador.eduardo1089.chatgpt.site"

echo.
echo ==========================================
echo        VisionLabel SAM local
echo ==========================================
echo Este instalador prepara o SAM no seu computador.
echo Na primeira execucao o processo pode demorar alguns minutos.
echo.

if not exist "%APP_DIR%" mkdir "%APP_DIR%"

set "SELF_PATH=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$content=[IO.File]::ReadAllText($env:SELF_PATH); $marker='# === VISIONLABEL_'+'PYTHON ==='; $index=$content.IndexOf($marker,[StringComparison]::Ordinal); if($index -lt 0){exit 41}; $python=$content.Substring($index+$marker.Length).TrimStart([char]13,[char]10); if([string]::IsNullOrWhiteSpace($python)){exit 42}; [IO.File]::WriteAllText($env:CONNECTOR,$python,[Text.UTF8Encoding]::new($false))"
if errorlevel 1 goto :extract_error

set "PY_CMD="
where py >nul 2>nul && set "PY_CMD=py -3"
if not defined PY_CMD where python >nul 2>nul && set "PY_CMD=python"
if defined PY_CMD %PY_CMD% --version >nul 2>nul || set "PY_CMD="
if not defined PY_CMD (
  where winget >nul 2>nul || goto :python_error
  echo Instalando Python 3.11...
  winget install -e --id Python.Python.3.11 --scope user --accept-package-agreements --accept-source-agreements
  if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
)
if not defined PY_CMD goto :python_error

if not exist "%VENV_DIR%\Scripts\python.exe" (
  echo Criando ambiente isolado...
  %PY_CMD% -m venv "%VENV_DIR%"
  if errorlevel 1 goto :install_error
)
set "PYTHON=%VENV_DIR%\Scripts\python.exe"

if not exist "%READY_FILE%" (
  echo Atualizando o instalador de pacotes...
  "%PYTHON%" -m pip install --upgrade pip
  if errorlevel 1 goto :install_error
  echo Instalando PyTorch e dependencias do SAM. Aguarde...
  "%PYTHON%" -m pip install torch torchvision fastapi uvicorn pillow opencv-python-headless numpy
  if errorlevel 1 goto :install_error
  "%PYTHON%" -m pip install "https://github.com/facebookresearch/segment-anything/archive/refs/heads/main.zip"
  if errorlevel 1 goto :install_error
  echo pronto>"%READY_FILE%"
)

if not exist "%CHECKPOINT%" (
  echo Baixando o checkpoint oficial ViT-B, aproximadamente 375 MB...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%MODEL_URL%' -OutFile '%CHECKPOINT%'"
  if errorlevel 1 goto :download_error
)

echo.
echo Preparacao concluida. Mantenha esta janela aberta.
echo O VisionLabel sera aberto no navegador; espere a mensagem SAM pronto.
start "" "%SITE_URL%"
echo.
"%PYTHON%" "%CONNECTOR%" --checkpoint "%CHECKPOINT%" --model-type vit_b --device auto
echo.
echo O conector foi encerrado. Abra este instalador novamente para reutiliza-lo.
pause
exit /b 0

:python_error
echo.
echo Nao foi possivel instalar ou localizar o Python 3.
echo Instale Python 3.11 em https://www.python.org/downloads/ e abra este arquivo novamente.
pause
exit /b 1

:extract_error
echo.
echo Nao foi possivel preparar o conector local.
pause
exit /b 1

:install_error
echo.
echo A instalacao das dependencias falhou. Verifique a conexao e tente novamente.
pause
exit /b 1

:download_error
echo.
echo O download do modelo falhou. Verifique a conexao e tente novamente.
pause
exit /b 1

# === VISIONLABEL_PYTHON ===
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import threading
from pathlib import Path

import cv2
import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from segment_anything import SamPredictor, sam_model_registry


class PredictionRequest(BaseModel):
    image: str
    point_coords: list[list[float]]
    point_labels: list[int]
    multimask_output: bool = True


app = FastAPI(title="VisionLabel SAM local", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

predictor: SamPredictor | None = None
predictor_lock = threading.Lock()
current_image_hash: str | None = None
runtime = {"device": "carregando", "model_type": "desconhecido"}


@app.middleware("http")
async def allow_local_browser_access(request: Request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/")
def root():
    return {"service": "VisionLabel SAM local", "status": "ready", **runtime}


@app.get("/health")
def health():
    return {"status": "ready" if predictor is not None else "loading", **runtime}


def decode_image(data_url: str) -> np.ndarray:
    try:
        encoded = data_url.split(",", 1)[1] if "," in data_url else data_url
        image_bytes = base64.b64decode(encoded)
        return np.asarray(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    except Exception as error:
        raise HTTPException(status_code=400, detail="Imagem invalida.") from error


def mask_to_polygon(mask: np.ndarray) -> list[list[float]]:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise HTTPException(status_code=422, detail="O SAM nao encontrou um contorno.")
    contour = max(contours, key=cv2.contourArea)
    epsilon = max(1.0, 0.002 * cv2.arcLength(contour, True))
    simplified = cv2.approxPolyDP(contour, epsilon, True)
    if len(simplified) < 3:
        simplified = contour
    return simplified[:, 0, :].astype(float).tolist()


@app.post("/predict")
def predict(payload: PredictionRequest):
    global current_image_hash
    if predictor is None:
        raise HTTPException(status_code=503, detail="O modelo ainda esta carregando.")
    if not payload.point_coords or len(payload.point_coords) != len(payload.point_labels):
        raise HTTPException(status_code=400, detail="Envie pontos e rotulos correspondentes.")
    image_hash = hashlib.sha256(payload.image.encode("utf-8")).hexdigest()
    image = decode_image(payload.image)
    coordinates = np.asarray(payload.point_coords, dtype=np.float32)
    labels = np.asarray(payload.point_labels, dtype=np.int32)
    with predictor_lock:
        reused_embedding = current_image_hash == image_hash
        if not reused_embedding:
            predictor.set_image(image)
            current_image_hash = image_hash
        masks, scores, _ = predictor.predict(
            point_coords=coordinates,
            point_labels=labels,
            multimask_output=True,
        )
    best = int(np.argmax(scores))
    return {
        "polygon": mask_to_polygon(masks[best]),
        "score": float(scores[best]),
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "reused_embedding": reused_embedding,
    }


def main():
    global predictor
    parser = argparse.ArgumentParser(description="Executa o SAM localmente para o VisionLabel.")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--model-type", choices=["vit_b", "vit_l", "vit_h"], default="vit_b")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    parser.add_argument("--port", type=int, default=7860)
    args = parser.parse_args()
    checkpoint = Path(args.checkpoint).expanduser().resolve()
    if not checkpoint.is_file():
        raise SystemExit(f"Checkpoint nao encontrado: {checkpoint}")
    mps_available = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    if args.device == "auto":
        device = "cuda" if torch.cuda.is_available() else "mps" if mps_available else "cpu"
    else:
        device = args.device
    if device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA nao esta disponivel. Use --device cpu.")
    if device == "mps" and not mps_available:
        raise SystemExit("Apple Silicon/MPS nao esta disponivel. Use --device cpu.")
    print(f"Carregando SAM {args.model_type} em {device}...")
    sam = sam_model_registry[args.model_type](checkpoint=str(checkpoint))
    sam.to(device=device)
    sam.eval()
    predictor = SamPredictor(sam)
    runtime.update({"device": device, "model_type": args.model_type})
    print(f"SAM pronto em http://127.0.0.1:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
