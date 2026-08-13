#!/usr/bin/env python3
"""Conector local do SAM para o VisionLabel.

Use somente checkpoints baixados da fonte oficial da Meta. Exemplo:
python visionlabel-sam-local.py --checkpoint sam_vit_b_01ec64.pth --model-type vit_b
"""

from __future__ import annotations

import argparse
import base64
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


app = FastAPI(title="VisionLabel SAM local", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

predictor: SamPredictor | None = None
predictor_lock = threading.Lock()
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
        raise HTTPException(status_code=400, detail="Imagem inválida.") from error


def mask_to_polygon(mask: np.ndarray) -> list[list[float]]:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise HTTPException(status_code=422, detail="O SAM não encontrou um contorno.")
    contour = max(contours, key=cv2.contourArea)
    epsilon = max(1.0, 0.002 * cv2.arcLength(contour, True))
    simplified = cv2.approxPolyDP(contour, epsilon, True)
    if len(simplified) < 3:
        simplified = contour
    return simplified[:, 0, :].astype(float).tolist()


@app.post("/predict")
def predict(payload: PredictionRequest):
    if predictor is None:
        raise HTTPException(status_code=503, detail="O modelo ainda está carregando.")
    if not payload.point_coords or len(payload.point_coords) != len(payload.point_labels):
        raise HTTPException(status_code=400, detail="Envie pontos e rótulos correspondentes.")

    image = decode_image(payload.image)
    coordinates = np.asarray(payload.point_coords, dtype=np.float32)
    labels = np.asarray(payload.point_labels, dtype=np.int32)
    with predictor_lock:
        predictor.set_image(image)
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
    }


def main():
    global predictor
    parser = argparse.ArgumentParser(description="Executa o SAM localmente para o VisionLabel.")
    parser.add_argument("--checkpoint", required=True, help="Caminho para o checkpoint .pth")
    parser.add_argument("--model-type", choices=["vit_b", "vit_l", "vit_h"], default="vit_b")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--port", type=int, default=7860)
    args = parser.parse_args()

    checkpoint = Path(args.checkpoint).expanduser().resolve()
    if not checkpoint.is_file():
        raise SystemExit(f"Checkpoint não encontrado: {checkpoint}")
    device = "cuda" if args.device == "auto" and torch.cuda.is_available() else args.device
    if device == "auto":
        device = "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA não está disponível. Use --device cpu ou instale o PyTorch com CUDA.")

    print(f"Carregando SAM {args.model_type} em {device}…")
    sam = sam_model_registry[args.model_type](checkpoint=str(checkpoint))
    sam.to(device=device)
    sam.eval()
    predictor = SamPredictor(sam)
    runtime.update({"device": device, "model_type": args.model_type})
    print(f"VisionLabel SAM pronto em http://127.0.0.1:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
