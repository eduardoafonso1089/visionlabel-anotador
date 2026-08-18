import { contours } from "d3-contour";
import { EDITOR_HEIGHT, EDITOR_WIDTH, polygonArea } from "./geometry";
import type { Asset, SamBoxPrompt, SamMaskPrediction, SamPrompt } from "./types";

type SamResponse = Record<string, unknown>;

export type SamPredictionResult = {
  predictions: SamMaskPrediction[];
  modelId: string | null;
  reusedEmbedding: boolean;
};

type SamRequest = {
  endpoint: string;
  asset: Asset;
  modelId?: string;
  prompts?: SamPrompt[];
  box?: SamBoxPrompt | null;
  text?: string;
  threshold?: number;
  multimaskOutput?: boolean;
  clientId?: string;
  requestSeq?: number;
  signal?: AbortSignal;
};

function readDataUrl(blob: Blob, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => reader.abort();
    if (signal?.aborted) { reject(new DOMException("Cancelado", "AbortError")); return; }
    signal?.addEventListener("abort", abort, { once: true });
    reader.onload = () => { cleanup(); resolve(String(reader.result)); };
    reader.onerror = () => { cleanup(); reject(new Error("Não foi possível ler a imagem.")); };
    reader.onabort = () => { cleanup(); reject(new DOMException("Cancelado", "AbortError")); };
    reader.readAsDataURL(blob);
  });
}

async function assetAsDataUrl(asset: Asset, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
  if (asset.src.startsWith("data:")) return asset.src;
  let response: Response;
  try {
    response = await fetch(asset.src, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Não foi possível preparar esta imagem para o SAM.");
  }
  if (!response.ok) throw new Error("Não foi possível preparar esta imagem para o SAM.");
  return readDataUrl(await response.blob(), signal);
}

function pointPolygon(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  if (value.every((coordinate) => Number.isFinite(Number(coordinate)))) {
    const polygon = value.map(Number);
    return polygon.length >= 6 && polygon.length % 2 === 0 ? polygon : null;
  }
  if (value.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))) {
    return value.flatMap((point) => [Number(point[0]), Number(point[1])]);
  }
  if (value.every((point) => point && typeof point === "object" && Number.isFinite(Number((point as { x?: unknown }).x)) && Number.isFinite(Number((point as { y?: unknown }).y)))) {
    return value.flatMap((point) => [Number((point as { x: unknown }).x), Number((point as { y: unknown }).y)]);
  }
  return null;
}

function polygonCollection(value: unknown): number[][] {
  const direct = pointPolygon(value);
  if (direct) return [direct];
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const polygon = pointPolygon(candidate);
    return polygon ? [polygon] : polygonCollection(candidate);
  });
}

function simplify(points: number[], tolerance = 2.2) {
  if (points.length <= 12) return points;
  const result: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const previousX = result.at(-2);
    const previousY = result.at(-1);
    if (previousX === undefined || previousY === undefined || Math.hypot(points[index] - previousX, points[index + 1] - previousY) >= tolerance) {
      result.push(points[index], points[index + 1]);
    }
  }
  return result.length >= 6 ? result : points;
}

function matrixToPolygons(mask: unknown[][]) {
  const height = mask.length;
  const width = Array.isArray(mask[0]) ? mask[0].length : 0;
  if (!width || !height || !mask.every((row) => Array.isArray(row) && row.length === width)) return [];
  const values = mask.flatMap((row) => row.map((value) => Number(value) > 0.5 ? 1 : 0));
  const geometry = contours().size([width, height]).thresholds([0.5])(values)[0];
  if (!geometry?.coordinates.length) return [];
  const rings = geometry.coordinates.map((polygon) => polygon[0]).filter(Boolean);
  return rings
    .map((ring) => ring.flatMap(([x, y]) => [x, y]))
    .filter((ring) => ring.length >= 6)
    .sort((a, b) => polygonArea(b) - polygonArea(a));
}

function normalizePolygon(points: number[], width: number, height: number) {
  const xCoordinates = points.filter((_, index) => index % 2 === 0);
  const yCoordinates = points.filter((_, index) => index % 2 === 1);
  const normalized = Math.max(...xCoordinates) <= 1.5 && Math.max(...yCoordinates) <= 1.5;
  return simplify(points.map((coordinate, index) => {
    if (normalized) return coordinate * (index % 2 ? EDITOR_HEIGHT : EDITOR_WIDTH);
    return coordinate * (index % 2 ? EDITOR_HEIGHT / height : EDITOR_WIDTH / width);
  })).map((coordinate, index) => Math.max(0, Math.min(index % 2 ? EDITOR_HEIGHT : EDITOR_WIDTH, coordinate)));
}

function finiteScore(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function finiteBbox(value: unknown, width: number, height: number): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((coordinate) => Number.isFinite(Number(coordinate)))) return null;
  const box = value.map(Number);
  const normalized = Math.max(...box) <= 1.5;
  const scaled = box.map((coordinate, index) => normalized
    ? coordinate * (index % 2 ? EDITOR_HEIGHT : EDITOR_WIDTH)
    : coordinate * (index % 2 ? EDITOR_HEIGHT / height : EDITOR_WIDTH / width));
  return scaled as [number, number, number, number];
}

function predictionFrom(value: unknown, width: number, height: number): SamMaskPrediction | null {
  if (!value || typeof value !== "object") return null;
  const prediction = value as SamResponse;
  let polygons = polygonCollection(prediction.polygons ?? prediction.polygon ?? prediction.contours ?? prediction.contour);
  const mask = prediction.mask;
  if (!polygons.length && Array.isArray(mask) && Array.isArray(mask[0])) {
    polygons = matrixToPolygons(mask as unknown[][]);
  }
  const normalized = polygons
    .filter((polygon) => polygon.length >= 6)
    .map((polygon) => normalizePolygon(polygon, width, height));
  if (!normalized.length) return null;
  return {
    polygons: normalized,
    score: finiteScore(prediction.score),
    bbox: finiteBbox(prediction.bbox ?? prediction.box, width, height),
  };
}

function parseResponse(body: SamResponse, fallbackWidth: number, fallbackHeight: number): SamPredictionResult {
  const data = (body.data && typeof body.data === "object" ? body.data : body) as SamResponse;
  const responseWidth = Number(data.width);
  const responseHeight = Number(data.height);
  const width = Number.isFinite(responseWidth) && responseWidth > 0 ? responseWidth : fallbackWidth;
  const height = Number.isFinite(responseHeight) && responseHeight > 0 ? responseHeight : fallbackHeight;
  const rawPredictions = Array.isArray(data.predictions) ? data.predictions : [data];
  let predictions = rawPredictions
    .map((prediction) => predictionFrom(prediction, width, height))
    .filter((prediction): prediction is SamMaskPrediction => prediction !== null);

  if (!predictions.length && Array.isArray(data.masks)) {
    predictions = data.masks.flatMap((mask, index) => {
      const prediction = predictionFrom({ mask, score: Array.isArray(data.scores) ? data.scores[index] : undefined }, width, height);
      return prediction ? [prediction] : [];
    });
  }
  if (!predictions.length) throw new Error("O SAM respondeu, mas não retornou uma máscara utilizável.");
  return {
    predictions,
    modelId: typeof data.model_id === "string" ? data.model_id : null,
    reusedEmbedding: data.reused_embedding === true,
  };
}

function scaleBox(box: SamBoxPrompt, width: number, height: number) {
  const x0 = box.x / EDITOR_WIDTH * width;
  const y0 = box.y / EDITOR_HEIGHT * height;
  const x1 = (box.x + box.w) / EDITOR_WIDTH * width;
  const y1 = (box.y + box.h) / EDITOR_HEIGHT * height;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

export async function requestSamPredictions({
  endpoint,
  asset,
  modelId,
  prompts = [],
  box,
  text,
  threshold,
  multimaskOutput = true,
  clientId,
  requestSeq,
  signal,
}: SamRequest): Promise<SamPredictionResult> {
  const width = asset.width ?? 1000;
  const height = asset.height ?? 650;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(abort, 180_000);
  try {
    const image = await assetAsDataUrl(asset, controller.signal);
    const pointCoords = prompts.map((prompt) => [prompt.x / EDITOR_WIDTH * width, prompt.y / EDITOR_HEIGHT * height]);
    const pointLabels = prompts.map((prompt) => prompt.label);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        model_id: modelId,
        point_coords: pointCoords,
        point_labels: pointLabels,
        points: pointCoords.map(([x, y], index) => ({ x, y, label: pointLabels[index] })),
        box: box ? scaleBox(box, width, height) : null,
        box_label: box?.label ?? 1,
        text: text?.trim() || null,
        threshold: threshold ?? null,
        multimask_output: multimaskOutput,
        client_id: clientId ?? null,
        request_seq: requestSeq ?? null,
        return_format: "polygons",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { detail?: unknown } | null;
      const detail = typeof errorBody?.detail === "string" ? `: ${errorBody.detail}` : "";
      throw new Error(`O endpoint SAM respondeu com HTTP ${response.status}${detail}`);
    }
    return parseResponse(await response.json() as SamResponse, width, height);
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal?.aborted) throw new Error("A solicitação ao SAM foi cancelada.");
      throw new Error("O SAM local demorou mais de 3 minutos para responder.");
    }
    if (error instanceof TypeError) {
      throw new Error("Não foi possível acessar o SAM local. Verifique se o conector está aberto e autorize o acesso à rede local.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function requestSamMask(request: Omit<SamRequest, "multimaskOutput">) {
  const result = await requestSamPredictions({ ...request, multimaskOutput: false });
  return result.predictions[0]?.polygons[0] ?? [];
}
