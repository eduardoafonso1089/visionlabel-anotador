#!/usr/bin/env python3
"""Conector local multi-engine do SAM para o VisionLabel.

O conector nunca baixa modelos nem instala pacotes. Forneça um checkpoint local
obtido da fonte oficial do modelo escolhido.

Exemplos:
  python visionlabel-sam-local.py --checkpoint sam_vit_b_01ec64.pth
  python visionlabel-sam-local.py --model sam2.1-hiera-small \
    --checkpoint sam2.1_hiera_small.pt
  python visionlabel-sam-local.py --model sam3-concepts --checkpoint sam3.pt --device cuda
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import hashlib
import io
import math
import os
import re
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

if sys.version_info < (3, 10):
    raise SystemExit(
        "VisionLabel SAM requer Python 3.10 ou mais novo; "
        f"esta execução usa Python {sys.version_info.major}.{sys.version_info.minor}."
    )

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from PIL import Image, ImageOps, UnidentifiedImageError


SERVICE_NAME = "VisionLabel SAM local"
API_VERSION = 2
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_DATA_URL_LENGTH = ((MAX_IMAGE_BYTES + 2) // 3 * 4) + 4096
MAX_IMAGE_DIMENSION = 32_768
MAX_POINT_PROMPTS = 256
MAX_TEXT_LENGTH = 512
MAX_CLIENT_ID_LENGTH = 128
MAX_REQUEST_BODY_BYTES = MAX_DATA_URL_LENGTH + 1024 * 1024


def _bounded_env_int(
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    raw_value = os.environ.get(name, "").strip()
    if not raw_value:
        return default
    try:
        value = int(raw_value)
    except ValueError as error:
        raise SystemExit(f"{name} deve ser um número inteiro.") from error
    if value < minimum or value > maximum:
        raise SystemExit(f"{name} deve estar entre {minimum} e {maximum}.")
    return value


def _bounded_env_float(
    name: str,
    default: float,
    *,
    minimum: float,
    maximum: float,
) -> float:
    raw_value = os.environ.get(name, "").strip()
    if not raw_value:
        return default
    try:
        value = float(raw_value)
    except ValueError as error:
        raise SystemExit(f"{name} deve ser um número.") from error
    if not math.isfinite(value) or value < minimum or value > maximum:
        raise SystemExit(f"{name} deve estar entre {minimum} e {maximum}.")
    return value


MAX_IMAGE_PIXELS = _bounded_env_int(
    "VISIONLABEL_MAX_IMAGE_PIXELS",
    16_000_000,
    minimum=1_000_000,
    maximum=100_000_000,
)
MAX_CONCURRENT_PREDICTION_REQUESTS = _bounded_env_int(
    "VISIONLABEL_MAX_CONCURRENT_REQUESTS",
    4,
    minimum=1,
    maximum=16,
)
MAX_SAM3_PREDICTIONS = _bounded_env_int(
    "VISIONLABEL_SAM3_MAX_PREDICTIONS",
    64,
    minimum=1,
    maximum=512,
)
MIN_SAM3_CONCEPT_THRESHOLD = _bounded_env_float(
    "VISIONLABEL_SAM3_MIN_CONCEPT_THRESHOLD",
    0.1,
    minimum=0.01,
    maximum=0.95,
)
DEFAULT_ALLOWED_ORIGINS = (
    "https://visionlabel-anotador.eduardo1089.chatgpt.site",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


@dataclass(frozen=True)
class ModelSpec:
    model_id: str
    family: str
    model_type: str
    capabilities: tuple[str, ...]
    default_config: str | None = None


COMMON_CAPABILITIES = ("point", "negative_point", "box", "multimask")
MODEL_SPECS = {
    "sam1-vit-b": ModelSpec("sam1-vit-b", "sam1", "vit_b", COMMON_CAPABILITIES),
    "sam1-vit-l": ModelSpec("sam1-vit-l", "sam1", "vit_l", COMMON_CAPABILITIES),
    "sam1-vit-h": ModelSpec("sam1-vit-h", "sam1", "vit_h", COMMON_CAPABILITIES),
    "sam2.1-hiera-tiny": ModelSpec(
        "sam2.1-hiera-tiny",
        "sam2",
        "hiera_tiny",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_t.yaml",
    ),
    "sam2.1-hiera-small": ModelSpec(
        "sam2.1-hiera-small",
        "sam2",
        "hiera_small",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_s.yaml",
    ),
    "sam2.1-hiera-base-plus": ModelSpec(
        "sam2.1-hiera-base-plus",
        "sam2",
        "hiera_base_plus",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_b+.yaml",
    ),
    "sam2.1-hiera-large": ModelSpec(
        "sam2.1-hiera-large",
        "sam2",
        "hiera_large",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_l.yaml",
    ),
    "sam3-concepts": ModelSpec(
        "sam3-concepts",
        "sam3",
        "sam3",
        (*COMMON_CAPABILITIES, "text", "box_exemplar"),
    ),
}
MODEL_ALIASES = {"sam3": "sam3-concepts"}


class PointPrompt(BaseModel):
    x: float
    y: float
    label: int


PointCoordinate = tuple[float, float]
BoxCoordinates = tuple[float, float, float, float]


class PredictionRequest(BaseModel):
    image: str = Field(max_length=MAX_DATA_URL_LENGTH)
    model_id: str | None = None
    point_coords: list[PointCoordinate] | None = Field(default=None, max_length=MAX_POINT_PROMPTS)
    point_labels: list[int] | None = Field(default=None, max_length=MAX_POINT_PROMPTS)
    points: list[PointPrompt] | None = Field(default=None, max_length=MAX_POINT_PROMPTS)
    box: BoxCoordinates | None = None
    box_label: int = 1
    text: str | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    threshold: float | None = None
    multimask_output: bool = True
    client_id: str | None = Field(default=None, min_length=1, max_length=MAX_CLIENT_ID_LENGTH)
    request_seq: int | None = Field(default=None, ge=0)


@dataclass(frozen=True)
class LoadConfig:
    spec: ModelSpec
    checkpoint: str
    model_config: str | None
    requested_device: str


@dataclass(frozen=True)
class DecodedImage:
    pixels: np.ndarray
    content_hash: str


@dataclass(frozen=True)
class ValidatedPrompts:
    point_coords: np.ndarray | None
    point_labels: np.ndarray | None
    box: np.ndarray | None
    box_label: int
    text: str | None
    threshold: float | None


@dataclass(frozen=True)
class RawPrediction:
    mask: np.ndarray
    score: float
    bbox: list[float] | None = None


class EngineAdapter(Protocol):
    spec: ModelSpec
    device: str

    def set_image(self, image: np.ndarray) -> None: ...

    def predict(
        self,
        *,
        point_coords: np.ndarray | None,
        point_labels: np.ndarray | None,
        box: np.ndarray | None,
        box_label: int,
        text: str | None,
        threshold: float | None,
        multimask_output: bool,
    ) -> list[RawPrediction]: ...


def _to_numpy(value: Any) -> np.ndarray:
    if isinstance(value, np.ndarray):
        return value
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    dtype_name = str(getattr(value, "dtype", ""))
    if "bfloat16" in dtype_name and hasattr(value, "float"):
        value = value.float()
    if hasattr(value, "numpy"):
        return value.numpy()
    return np.asarray(value)


def _binary_mask(mask: Any) -> np.ndarray:
    array = _to_numpy(mask)
    if array.dtype == np.bool_:
        return array
    finite = array[np.isfinite(array)]
    if not finite.size:
        return np.zeros(array.shape, dtype=bool)
    cutoff = 0.0 if float(finite.min()) < 0.0 else 0.5
    return np.nan_to_num(array, nan=-math.inf) > cutoff


def _predictions_from_arrays(
    masks: Any,
    scores: Any,
    boxes: Any | None = None,
) -> list[RawPrediction]:
    mask_array = _to_numpy(masks)
    if mask_array.ndim < 2:
        raise RuntimeError("O modelo retornou máscaras em um formato inválido.")
    height, width = mask_array.shape[-2:]
    mask_array = mask_array.reshape((-1, height, width))
    score_array = _to_numpy(scores).reshape(-1)
    box_array = None if boxes is None else _to_numpy(boxes).reshape((-1, 4))

    predictions: list[RawPrediction] = []
    for index, mask in enumerate(mask_array):
        score = float(score_array[index]) if index < score_array.size else 0.0
        bbox = None
        if box_array is not None and index < len(box_array):
            bbox = [float(coordinate) for coordinate in box_array[index]]
        predictions.append(RawPrediction(_binary_mask(mask), score, bbox))
    return predictions


class Sam1Adapter:
    def __init__(self, spec: ModelSpec, checkpoint: Path, device: str):
        import torch
        from segment_anything import SamPredictor, sam_model_registry

        model = sam_model_registry[spec.model_type](checkpoint=str(checkpoint))
        model.to(device=device)
        model.eval()
        self.spec = spec
        self.device = device
        self._torch = torch
        self._predictor = SamPredictor(model)

    def set_image(self, image: np.ndarray) -> None:
        with self._torch.inference_mode():
            self._predictor.set_image(image)

    def predict(
        self,
        *,
        point_coords: np.ndarray | None,
        point_labels: np.ndarray | None,
        box: np.ndarray | None,
        box_label: int,
        text: str | None,
        threshold: float | None,
        multimask_output: bool,
    ) -> list[RawPrediction]:
        del box_label, threshold
        if text is not None:
            raise ValueError("SAM 1 não aceita prompts de texto.")
        with self._torch.inference_mode():
            masks, scores, _ = self._predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box,
                multimask_output=multimask_output,
            )
        return _predictions_from_arrays(masks, scores)


class Sam2Adapter:
    def __init__(
        self,
        spec: ModelSpec,
        checkpoint: Path,
        model_config: str,
        device: str,
    ):
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        model = build_sam2(
            model_config,
            str(checkpoint),
            device=device,
            mode="eval",
        )
        self.spec = spec
        self.device = device
        self._torch = torch
        self._predictor = SAM2ImagePredictor(model)

    def set_image(self, image: np.ndarray) -> None:
        with self._torch.inference_mode():
            self._predictor.set_image(image)

    def predict(
        self,
        *,
        point_coords: np.ndarray | None,
        point_labels: np.ndarray | None,
        box: np.ndarray | None,
        box_label: int,
        text: str | None,
        threshold: float | None,
        multimask_output: bool,
    ) -> list[RawPrediction]:
        del box_label, threshold
        if text is not None:
            raise ValueError("SAM 2 não aceita prompts de texto.")
        with self._torch.inference_mode():
            masks, scores, _ = self._predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box,
                multimask_output=multimask_output,
            )
        return _predictions_from_arrays(masks, scores)


class Sam3Adapter:
    DEFAULT_THRESHOLD = 0.5

    def __init__(self, spec: ModelSpec, checkpoint: Path, device: str):
        import torch
        from sam3.model.sam3_image_processor import Sam3Processor
        from sam3.model_builder import build_sam3_image_model

        model = build_sam3_image_model(
            device=device,
            checkpoint_path=str(checkpoint),
            load_from_HF=False,
            enable_inst_interactivity=True,
        )
        model.to(device=device)
        model.eval()
        self.spec = spec
        self.device = device
        self._torch = torch
        self._model = model
        self._processor = Sam3Processor(
            model,
            device=device,
            confidence_threshold=self.DEFAULT_THRESHOLD,
        )
        self._state: dict[str, Any] | None = None
        self._image_size: tuple[int, int] | None = None

    def set_image(self, image: np.ndarray) -> None:
        with self._torch.inference_mode():
            self._state = self._processor.set_image(Image.fromarray(image))
        self._image_size = (int(image.shape[1]), int(image.shape[0]))

    def _predict_concept(
        self,
        text: str | None,
        box: np.ndarray | None,
        box_label: int,
        threshold: float | None,
    ) -> list[RawPrediction]:
        if self._state is None or self._image_size is None:
            raise RuntimeError("Defina a imagem antes de executar o SAM 3.")
        self._processor.reset_all_prompts(self._state)
        self._processor.set_confidence_threshold(
            self.DEFAULT_THRESHOLD if threshold is None else threshold
        )
        state = self._state
        if text is not None:
            state = self._processor.set_text_prompt(prompt=text, state=state)
        if box is not None:
            width, height = self._image_size
            x0, y0, x1, y1 = [float(value) for value in box]
            exemplar = [
                (x0 + x1) / (2.0 * width),
                (y0 + y1) / (2.0 * height),
                (x1 - x0) / width,
                (y1 - y0) / height,
            ]
            state = self._processor.add_geometric_prompt(
                box=exemplar,
                label=bool(box_label),
                state=state,
            )
        masks = state.get("masks")
        scores = state.get("scores")
        if masks is None or scores is None:
            return []
        return _predictions_from_arrays(masks, scores, state.get("boxes"))

    def predict(
        self,
        *,
        point_coords: np.ndarray | None,
        point_labels: np.ndarray | None,
        box: np.ndarray | None,
        box_label: int,
        text: str | None,
        threshold: float | None,
        multimask_output: bool,
    ) -> list[RawPrediction]:
        if self._state is None:
            raise RuntimeError("Defina a imagem antes de executar o SAM 3.")
        if text is not None and point_coords is not None:
            raise ValueError(
                "SAM 3 não combina texto e pontos nesta API; use texto com uma caixa exemplar."
            )
        with self._torch.inference_mode():
            if text is not None:
                return self._predict_concept(text, box, box_label, threshold)

            if box is not None and box_label == 0:
                raise ValueError(
                    "Caixa negativa só é aceita como exemplar junto de um prompt de texto."
                )

            self._processor.reset_all_prompts(self._state)
            masks, scores, _ = self._model.predict_inst(
                self._state,
                point_coords=point_coords,
                point_labels=point_labels,
                box=box,
                multimask_output=multimask_output,
            )
        return _predictions_from_arrays(masks, scores)


def _configured_origins() -> tuple[str, ...]:
    configured = os.environ.get("VISIONLABEL_ALLOWED_ORIGINS", "")
    values = [
        origin.strip().rstrip("/")
        for origin in configured.split(",")
        if origin.strip() and origin.strip() != "*"
    ]
    return tuple(dict.fromkeys((*DEFAULT_ALLOWED_ORIGINS, *values)))


ALLOWED_ORIGINS = _configured_origins()
LOOPBACK_ORIGIN_PATTERN = r"https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?"


def _origin_is_allowed(origin: str) -> bool:
    normalized = origin.rstrip("/")
    return normalized in ALLOWED_ORIGINS or re.fullmatch(LOOPBACK_ORIGIN_PATTERN, normalized) is not None


class _RequestBodyTooLarge(Exception):
    pass


class PredictionRequestGuard:
    """Limita uploads e concorrência antes de FastAPI materializar o JSON."""

    def __init__(self, app: Any, max_body_bytes: int, max_concurrent: int):
        self.app = app
        self.max_body_bytes = max_body_bytes
        self._slots = asyncio.Semaphore(max_concurrent)

    async def _reject(self, scope: dict[str, Any], receive: Any, send: Any, status: int, detail: str) -> None:
        response = JSONResponse(status_code=status, content={"detail": detail})
        await response(scope, receive, send)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        is_prediction = (
            scope.get("type") == "http"
            and scope.get("method") == "POST"
            and str(scope.get("path", "")).rstrip("/") == "/predict"
        )
        if not is_prediction:
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except (TypeError, ValueError):
                await self._reject(scope, receive, send, 400, "Content-Length inválido.")
                return
            if declared_size < 0:
                await self._reject(scope, receive, send, 400, "Content-Length inválido.")
                return
            if declared_size > self.max_body_bytes:
                await self._reject(
                    scope,
                    receive,
                    send,
                    413,
                    "A solicitação excede o limite de bytes do conector local.",
                )
                return

        async with self._slots:
            received_bytes = 0
            response_started = False

            async def limited_receive():
                nonlocal received_bytes
                message = await receive()
                if message.get("type") == "http.request":
                    received_bytes += len(message.get("body", b""))
                    if received_bytes > self.max_body_bytes:
                        raise _RequestBodyTooLarge
                return message

            async def tracked_send(message):
                nonlocal response_started
                if message.get("type") == "http.response.start":
                    response_started = True
                await send(message)

            try:
                await self.app(scope, limited_receive, tracked_send)
            except _RequestBodyTooLarge:
                if response_started:
                    raise
                await self._reject(
                    scope,
                    receive,
                    send,
                    413,
                    "A solicitação excede o limite de bytes do conector local.",
                )


app = FastAPI(title=SERVICE_NAME, version=str(API_VERSION))
app.add_middleware(
    PredictionRequestGuard,
    max_body_bytes=MAX_REQUEST_BODY_BYTES,
    max_concurrent=MAX_CONCURRENT_PREDICTION_REQUESTS,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_origin_regex=LOOPBACK_ORIGIN_PATTERN,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
)

_runtime_lock = threading.Lock()
_predictor_lock = threading.Lock()
_request_state_lock = threading.Lock()
_latest_request_by_client: dict[str, int] = {}
_adapter: EngineAdapter | None = None
_current_image_hash: str | None = None
_startup_config: LoadConfig | None = None
_loader_started = False
_runtime: dict[str, Any] = {
    "service": SERVICE_NAME,
    "api_version": API_VERSION,
    "status": "loading",
    "model_id": None,
    "family": None,
    "model_type": "desconhecido",
    "device": "carregando",
    "capabilities": [],
    "error": None,
}


def _update_runtime(**values: Any) -> None:
    with _runtime_lock:
        _runtime.update(values)


def _runtime_snapshot() -> dict[str, Any]:
    with _runtime_lock:
        return dict(_runtime)


def _register_request(client_id: str | None, request_seq: int | None) -> None:
    if (client_id is None) != (request_seq is None):
        raise HTTPException(
            status_code=400,
            detail="Envie client_id e request_seq juntos.",
        )
    if client_id is None or request_seq is None:
        return
    with _request_state_lock:
        previous = _latest_request_by_client.get(client_id, -1)
        if request_seq < previous:
            raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
        if request_seq == previous:
            raise HTTPException(status_code=409, detail="Solicitação duplicada.")
        if client_id not in _latest_request_by_client and len(_latest_request_by_client) >= 64:
            _latest_request_by_client.pop(next(iter(_latest_request_by_client)))
        _latest_request_by_client[client_id] = request_seq


def _request_is_stale(client_id: str | None, request_seq: int | None) -> bool:
    if client_id is None or request_seq is None:
        return False
    with _request_state_lock:
        return _latest_request_by_client.get(client_id) != request_seq


def _resolve_device(requested: str) -> str:
    import torch

    mps_backend = getattr(torch.backends, "mps", None)
    mps_available = bool(mps_backend and mps_backend.is_available())
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "mps" if mps_available else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA não está disponível. Use --device cpu ou instale um PyTorch compatível."
        )
    if requested == "mps" and not mps_available:
        raise RuntimeError("Apple Silicon/MPS não está disponível. Use --device cpu.")
    return requested


def _numeric_version(value: str | None) -> tuple[int, int]:
    match = re.match(r"^(\d+)\.(\d+)", value or "")
    return (int(match.group(1)), int(match.group(2))) if match else (0, 0)


def _validate_sam3_runtime(device: str) -> None:
    import torch

    if sys.version_info < (3, 12):
        raise RuntimeError("SAM 3 exige Python 3.12 ou mais novo.")
    if _numeric_version(torch.__version__) < (2, 7):
        raise RuntimeError(f"SAM 3 exige PyTorch 2.7+; encontrado {torch.__version__}.")
    if device != "cuda":
        raise RuntimeError("SAM 3 exige GPU NVIDIA e dispositivo CUDA; CPU e MPS não são suportados neste conector.")
    cuda_version = getattr(torch.version, "cuda", None)
    if _numeric_version(cuda_version) < (12, 6):
        raise RuntimeError(f"SAM 3 exige um build PyTorch CUDA 12.6+; encontrado CUDA {cuda_version or 'ausente'}.")


def _build_adapter(config: LoadConfig) -> EngineAdapter:
    checkpoint = Path(config.checkpoint).expanduser().resolve()
    if not checkpoint.is_file():
        raise FileNotFoundError(f"Checkpoint não encontrado: {checkpoint}")
    device = _resolve_device(config.requested_device)
    _update_runtime(device=device)
    if config.spec.family == "sam3":
        _validate_sam3_runtime(device)

    if config.spec.family == "sam1":
        return Sam1Adapter(config.spec, checkpoint, device)
    if config.spec.family == "sam2":
        model_config = config.model_config or config.spec.default_config
        if not model_config:
            raise RuntimeError("Informe --model-config para este modelo SAM 2.")
        return Sam2Adapter(config.spec, checkpoint, model_config, device)
    if config.spec.family == "sam3":
        return Sam3Adapter(config.spec, checkpoint, device)
    raise RuntimeError(f"Família de modelo não suportada: {config.spec.family}")


def _load_model(config: LoadConfig) -> None:
    global _adapter, _current_image_hash
    try:
        print(f"Carregando {config.spec.model_id}…", flush=True)
        adapter = _build_adapter(config)
        with _predictor_lock:
            _adapter = adapter
            _current_image_hash = None
        _update_runtime(status="ready", device=adapter.device, error=None)
        print(
            f"VisionLabel SAM pronto: {config.spec.model_id} em {adapter.device}.",
            flush=True,
        )
    except Exception as error:  # o erro precisa permanecer consultável em /health
        message = f"{type(error).__name__}: {error}"
        _update_runtime(status="error", error=message)
        print(f"Falha ao carregar o modelo: {message}", flush=True)


@app.on_event("startup")
def start_model_loader() -> None:
    global _loader_started
    with _runtime_lock:
        if _loader_started or _startup_config is None:
            return
        _loader_started = True
        config = _startup_config
    threading.Thread(
        target=_load_model,
        args=(config,),
        name="visionlabel-model-loader",
        daemon=True,
    ).start()


@app.middleware("http")
async def allow_local_browser_access(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and not _origin_is_allowed(origin):
        return JSONResponse(
            status_code=403,
            content={"detail": "Origem não autorizada para acessar o conector local."},
        )
    response = await call_next(request)
    if origin and _origin_is_allowed(origin):
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/")
def root():
    return _runtime_snapshot()


@app.get("/health")
def health():
    return _runtime_snapshot()


def _validate_dimensions(width: int, height: int) -> None:
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="A imagem não possui dimensões válidas.")
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        raise HTTPException(
            status_code=413,
            detail=f"A imagem excede {MAX_IMAGE_DIMENSION} pixels em um dos lados.",
        )
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"A imagem possui {width * height} pixels e excede o limite de "
                f"{MAX_IMAGE_PIXELS}. Ajuste VISIONLABEL_MAX_IMAGE_PIXELS somente se "
                "o hardware tiver memória suficiente."
            ),
        )


def decode_image(data_url: str) -> DecodedImage:
    if not isinstance(data_url, str) or not data_url:
        raise HTTPException(status_code=400, detail="Imagem ausente.")
    if len(data_url) > MAX_DATA_URL_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=f"A imagem codificada excede o limite de {MAX_IMAGE_BYTES // 1024 // 1024} MB.",
        )

    header = ""
    encoded = data_url
    if "," in data_url:
        header, encoded = data_url.split(",", 1)
    if header.lower().startswith("data:") and ";base64" not in header.lower():
        raise HTTPException(status_code=400, detail="A imagem deve usar um data URL base64.")
    try:
        image_bytes = base64.b64decode(encoded.strip(), validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="Imagem base64 inválida.") from error
    if not image_bytes:
        raise HTTPException(status_code=400, detail="A imagem está vazia.")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"A imagem excede o limite de {MAX_IMAGE_BYTES // 1024 // 1024} MB.",
        )

    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            _validate_dimensions(*source.size)
            oriented = ImageOps.exif_transpose(source)
            _validate_dimensions(*oriented.size)
            pixels = np.array(oriented.convert("RGB"), dtype=np.uint8, copy=True)
    except HTTPException:
        raise
    except Image.DecompressionBombError as error:
        raise HTTPException(
            status_code=413,
            detail="A imagem excede o limite seguro de dimensões.",
        ) from error
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(
            status_code=400,
            detail="Imagem inválida ou não suportada.",
        ) from error
    return DecodedImage(pixels, hashlib.sha256(image_bytes).hexdigest())


def _validate_prompts(
    payload: PredictionRequest,
    width: int,
    height: int,
) -> ValidatedPrompts:
    coordinates = payload.point_coords
    labels = payload.point_labels
    arrays_supplied = coordinates is not None or labels is not None
    if arrays_supplied and (coordinates is None or labels is None):
        raise HTTPException(
            status_code=400,
            detail="Envie point_coords e point_labels juntos.",
        )
    if coordinates is not None and labels is not None and len(coordinates) != len(labels):
        raise HTTPException(
            status_code=400,
            detail="Envie pontos e rótulos correspondentes.",
        )
    if (not coordinates) and payload.points:
        coordinates = [[point.x, point.y] for point in payload.points]
        labels = [point.label for point in payload.points]

    coordinates = coordinates or []
    labels = labels or []
    if len(coordinates) > MAX_POINT_PROMPTS:
        raise HTTPException(
            status_code=413,
            detail=f"Use no máximo {MAX_POINT_PROMPTS} pontos por previsão.",
        )

    validated_coordinates: list[list[float]] = []
    validated_labels: list[int] = []
    for index, coordinate in enumerate(coordinates):
        if len(coordinate) != 2:
            raise HTTPException(
                status_code=400,
                detail=f"O ponto {index + 1} deve conter exatamente x e y.",
            )
        x, y = float(coordinate[0]), float(coordinate[1])
        if not math.isfinite(x) or not math.isfinite(y):
            raise HTTPException(status_code=400, detail="As coordenadas devem ser finitas.")
        if x < 0 or y < 0 or x > width or y > height:
            raise HTTPException(
                status_code=400,
                detail=f"O ponto {index + 1} está fora da imagem.",
            )
        label = int(labels[index])
        if label not in (0, 1):
            raise HTTPException(
                status_code=400,
                detail="Os rótulos dos pontos devem ser 0 (excluir) ou 1 (incluir).",
            )
        validated_coordinates.append(
            [min(x, max(0, width - 1)), min(y, max(0, height - 1))]
        )
        validated_labels.append(label)

    validated_box = None
    box_label = int(payload.box_label)
    if box_label not in (0, 1):
        raise HTTPException(
            status_code=400,
            detail="box_label deve ser 0 (excluir) ou 1 (incluir).",
        )
    if payload.box is not None:
        if len(payload.box) != 4:
            raise HTTPException(
                status_code=400,
                detail="A caixa deve estar no formato [x0, y0, x1, y1].",
            )
        x0, y0, x1, y1 = [float(value) for value in payload.box]
        if not all(math.isfinite(value) for value in (x0, y0, x1, y1)):
            raise HTTPException(status_code=400, detail="A caixa deve conter valores finitos.")
        if x0 < 0 or y0 < 0 or x1 > width or y1 > height or x1 <= x0 or y1 <= y0:
            raise HTTPException(status_code=400, detail="A caixa está fora da imagem ou é vazia.")
        validated_box = np.asarray([x0, y0, x1, y1], dtype=np.float32)

    text = payload.text.strip() if payload.text is not None else None
    if text == "":
        text = None
    if text is not None and len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=f"O texto deve ter no máximo {MAX_TEXT_LENGTH} caracteres.",
        )

    threshold = payload.threshold
    if threshold is not None and (
        not math.isfinite(float(threshold)) or float(threshold) < 0 or float(threshold) > 1
    ):
        raise HTTPException(status_code=400, detail="threshold deve estar entre 0 e 1.")

    if not validated_coordinates and validated_box is None and text is None:
        raise HTTPException(
            status_code=400,
            detail="Envie ao menos um ponto, uma caixa ou um texto.",
        )

    return ValidatedPrompts(
        np.asarray(validated_coordinates, dtype=np.float32)
        if validated_coordinates
        else None,
        np.asarray(validated_labels, dtype=np.int32) if validated_labels else None,
        validated_box,
        box_label,
        text,
        None if threshold is None else float(threshold),
    )


def mask_to_polygons(mask: np.ndarray) -> list[list[list[float]]]:
    binary = np.ascontiguousarray(mask.astype(np.uint8))
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons: list[list[list[float]]] = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(contour) <= 0:
            continue
        epsilon = max(1.0, 0.002 * cv2.arcLength(contour, True))
        simplified = cv2.approxPolyDP(contour, epsilon, True)
        if len(simplified) < 3:
            simplified = contour
        if len(simplified) >= 3:
            polygons.append(simplified[:, 0, :].astype(float).tolist())
    return polygons


def _mask_bbox(mask: np.ndarray) -> list[float] | None:
    rows, columns = np.nonzero(mask)
    if not len(columns):
        return None
    return [
        float(columns.min()),
        float(rows.min()),
        float(columns.max() + 1),
        float(rows.max() + 1),
    ]


def _serialize_predictions(
    raw_predictions: list[RawPrediction],
    width: int,
    height: int,
    threshold: float | None,
) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for raw in raw_predictions:
        score = raw.score if math.isfinite(raw.score) else 0.0
        if threshold is not None and score < threshold:
            continue
        mask = raw.mask
        if mask.shape != (height, width):
            mask = cv2.resize(
                mask.astype(np.uint8),
                (width, height),
                interpolation=cv2.INTER_NEAREST,
            ).astype(bool)
        polygons = mask_to_polygons(mask)
        if not polygons:
            continue
        prediction: dict[str, Any] = {
            "polygons": polygons,
            "polygon": polygons[0],
            "score": float(score),
        }
        bbox = raw.bbox or _mask_bbox(mask)
        if bbox is not None:
            prediction["bbox"] = bbox
        serialized.append(prediction)
    serialized.sort(key=lambda prediction: prediction["score"], reverse=True)
    return serialized


def _top_predictions(
    raw_predictions: list[RawPrediction],
    limit: int,
) -> tuple[list[RawPrediction], int, bool]:
    total = len(raw_predictions)
    if total <= limit:
        return raw_predictions, total, False
    ranked = sorted(
        raw_predictions,
        key=lambda prediction: prediction.score
        if math.isfinite(prediction.score)
        else -math.inf,
        reverse=True,
    )
    return ranked[:limit], total, True


@app.post("/predict")
def predict(payload: PredictionRequest):
    global _current_image_hash
    runtime = _runtime_snapshot()
    if runtime["status"] == "loading":
        raise HTTPException(status_code=503, detail="O modelo ainda está carregando.")
    if runtime["status"] == "error":
        raise HTTPException(
            status_code=503,
            detail=f"Falha ao carregar o modelo: {runtime['error']}",
        )
    adapter = _adapter
    if adapter is None:
        raise HTTPException(status_code=503, detail="O modelo não está disponível.")
    if payload.model_id is not None:
        requested_model_id = MODEL_ALIASES.get(payload.model_id, payload.model_id)
        if requested_model_id not in MODEL_SPECS:
            raise HTTPException(
                status_code=400,
                detail=f"model_id desconhecido: {payload.model_id}",
            )
        if requested_model_id != adapter.spec.model_id:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"O conector carregou {adapter.spec.model_id}, mas a solicitação pede "
                    f"{requested_model_id}."
                ),
            )

    _register_request(payload.client_id, payload.request_seq)
    try:
        with _predictor_lock:
            if _request_is_stale(payload.client_id, payload.request_seq):
                raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
            decoded = decode_image(payload.image)
            height, width = decoded.pixels.shape[:2]
            prompts = _validate_prompts(payload, width, height)
            if prompts.text is not None and "text" not in adapter.spec.capabilities:
                raise HTTPException(
                    status_code=400,
                    detail=f"{adapter.spec.model_id} não aceita prompts de texto.",
                )
            if prompts.text is not None and prompts.point_coords is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Não combine texto e pontos; use texto com uma caixa exemplar.",
                )
            if (
                adapter.spec.family == "sam3"
                and prompts.text is not None
                and prompts.threshold is not None
                and prompts.threshold < MIN_SAM3_CONCEPT_THRESHOLD
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "O threshold conceitual do SAM 3 deve ser pelo menos "
                        f"{MIN_SAM3_CONCEPT_THRESHOLD:g} para limitar o número de máscaras."
                    ),
                )
            if prompts.box is not None and prompts.box_label == 0 and (
                adapter.spec.family != "sam3" or prompts.text is None
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Caixa negativa requer SAM 3 e um prompt de texto conceitual.",
                )
            if _request_is_stale(payload.client_id, payload.request_seq):
                raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
            reused_embedding = _current_image_hash == decoded.content_hash
            if not reused_embedding:
                adapter.set_image(decoded.pixels)
                _current_image_hash = decoded.content_hash
            if _request_is_stale(payload.client_id, payload.request_seq):
                raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
            raw_predictions = adapter.predict(
                point_coords=prompts.point_coords,
                point_labels=prompts.point_labels,
                box=prompts.box,
                box_label=prompts.box_label,
                text=prompts.text,
                threshold=prompts.threshold,
                multimask_output=payload.multimask_output,
            )
            if _request_is_stale(payload.client_id, payload.request_seq):
                raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Falha durante a inferência: {type(error).__name__}: {error}",
        ) from error

    if _request_is_stale(payload.client_id, payload.request_seq):
        raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")

    raw_prediction_count = len(raw_predictions)
    predictions_truncated = False
    if adapter.spec.family == "sam3":
        raw_predictions, raw_prediction_count, predictions_truncated = _top_predictions(
            raw_predictions,
            MAX_SAM3_PREDICTIONS,
        )

    serialization_threshold = (
        prompts.threshold
        if adapter.spec.family == "sam3" and prompts.text is not None
        else None
    )
    predictions = _serialize_predictions(
        raw_predictions,
        width,
        height,
        serialization_threshold,
    )
    if not predictions:
        raise HTTPException(
            status_code=422,
            detail=(
                "O SAM não encontrou uma máscara acima do limiar solicitado."
                if serialization_threshold is not None
                else "O SAM não encontrou uma máscara utilizável para este prompt."
            ),
        )
    best = predictions[0]
    return {
        "predictions": predictions,
        "polygon": best["polygon"],
        "score": best["score"],
        "width": width,
        "height": height,
        "reused_embedding": reused_embedding,
        "model_id": adapter.spec.model_id,
        "family": adapter.spec.family,
        "raw_prediction_count": raw_prediction_count,
        "predictions_truncated": predictions_truncated,
        "prediction_limit": MAX_SAM3_PREDICTIONS
        if adapter.spec.family == "sam3"
        else None,
    }


def _legacy_model_id(model_type: str | None) -> str:
    return f"sam1-{(model_type or 'vit_b').replace('_', '-')}"


def main() -> None:
    global _startup_config
    parser = argparse.ArgumentParser(
        description="Executa SAM 1, SAM 2.1 ou SAM 3 localmente para o VisionLabel."
    )
    parser.add_argument(
        "--model",
        choices=sorted((*MODEL_SPECS, *MODEL_ALIASES)),
        help="Engine/modelo. Sem esta opção, --model-type seleciona SAM 1.",
    )
    parser.add_argument(
        "--checkpoint",
        required=True,
        help="Caminho para o checkpoint local; nenhum arquivo é baixado pelo conector.",
    )
    parser.add_argument(
        "--model-type",
        choices=["vit_b", "vit_l", "vit_h"],
        help="Opção legada para SAM 1; o padrão legado continua sendo vit_b.",
    )
    parser.add_argument(
        "--model-config",
        help="Nome de configuração Hydra do SAM 2; usa o nome oficial da variante por padrão.",
    )
    parser.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    parser.add_argument("--port", type=int, default=7860)
    args = parser.parse_args()
    if not 1 <= args.port <= 65_535:
        parser.error("--port deve estar entre 1 e 65535")

    requested_model_id = args.model or _legacy_model_id(args.model_type)
    model_id = MODEL_ALIASES.get(requested_model_id, requested_model_id)
    spec = MODEL_SPECS[model_id]
    _startup_config = LoadConfig(
        spec=spec,
        checkpoint=args.checkpoint,
        model_config=args.model_config,
        requested_device=args.device,
    )
    _update_runtime(
        status="loading",
        model_id=spec.model_id,
        family=spec.family,
        model_type=spec.model_type,
        device="carregando",
        capabilities=list(spec.capabilities),
        error=None,
    )
    print(
        f"VisionLabel SAM ouvindo em http://127.0.0.1:{args.port}; "
        f"{model_id} será carregado em segundo plano.",
        flush=True,
    )
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
