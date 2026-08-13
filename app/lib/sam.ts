import { contours } from "d3-contour";
import { EDITOR_HEIGHT, EDITOR_WIDTH, polygonArea } from "./geometry";
import type { Asset, SamPrompt } from "./types";

type SamResponse = Record<string, unknown>;

function readDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(blob);
  });
}

async function assetAsDataUrl(asset: Asset) {
  if (asset.src.startsWith("data:")) return asset.src;
  const response = await fetch(asset.src);
  if (!response.ok) throw new Error("Não foi possível preparar esta imagem para o SAM.");
  return readDataUrl(await response.blob());
}

function flattenPolygon(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  if (typeof value[0] === "number") return value.map(Number);
  if (Array.isArray(value[0])) {
    const nested = value as unknown[][];
    if (nested.length && nested[0].length === 2 && typeof nested[0][0] === "number") {
      return nested.flat().map(Number);
    }
    return flattenPolygon(nested[0]);
  }
  if (typeof value[0] === "object" && value[0]) {
    const points = value as Array<{ x?: unknown; y?: unknown }>;
    if (points.every((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))) {
      return points.flatMap((point) => [Number(point.x), Number(point.y)]);
    }
  }
  return null;
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

function matrixToPolygon(mask: unknown[][]) {
  const height = mask.length;
  const width = Array.isArray(mask[0]) ? mask[0].length : 0;
  if (!width || !height) return null;
  const values = mask.flatMap((row) => row.map((value) => Number(value) > 0.5 ? 1 : 0));
  const geometry = contours().size([width, height]).thresholds([0.5])(values)[0];
  if (!geometry?.coordinates.length) return null;
  const rings = geometry.coordinates.flatMap((polygon) => polygon);
  const candidates = rings.map((ring) => ring.flatMap(([x, y]) => [x, y]));
  return candidates.sort((a, b) => polygonArea(b) - polygonArea(a))[0] ?? null;
}

function normalizePolygon(points: number[], width: number, height: number) {
  const maxX = Math.max(...points.filter((_, index) => index % 2 === 0));
  const maxY = Math.max(...points.filter((_, index) => index % 2 === 1));
  const normalized = maxX <= 1.5 && maxY <= 1.5;
  return simplify(points.map((coordinate, index) => {
    if (normalized) return coordinate * (index % 2 ? EDITOR_HEIGHT : EDITOR_WIDTH);
    return coordinate * (index % 2 ? EDITOR_HEIGHT / height : EDITOR_WIDTH / width);
  })).map((coordinate, index) => Math.max(0, Math.min(index % 2 ? EDITOR_HEIGHT : EDITOR_WIDTH, coordinate)));
}

function parseResponse(body: SamResponse, width: number, height: number) {
  const data = (body.data && typeof body.data === "object" ? body.data : body) as SamResponse;
  const masks = data.masks as unknown[] | undefined;
  const candidates = [data.polygon, data.polygons, data.contour, data.contours, masks?.[0]];
  for (const candidate of candidates) {
    const direct = flattenPolygon(candidate);
    if (direct && direct.length >= 6) return normalizePolygon(direct, width, height);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const objectCandidate = candidate as SamResponse;
      const nested = flattenPolygon(objectCandidate.polygon ?? objectCandidate.segmentation ?? objectCandidate.points);
      if (nested && nested.length >= 6) return normalizePolygon(nested, width, height);
    }
  }
  const maskCandidate = data.mask ?? masks?.[0];
  if (Array.isArray(maskCandidate) && Array.isArray(maskCandidate[0])) {
    const polygon = matrixToPolygon(maskCandidate as unknown[][]);
    if (polygon) return normalizePolygon(polygon, (maskCandidate[0] as unknown[]).length, maskCandidate.length);
  }
  throw new Error("O SAM respondeu, mas não retornou polygon, polygons ou uma máscara 2D.");
}

export async function requestSamMask({ endpoint, asset, prompts }: { endpoint: string; asset: Asset; prompts: SamPrompt[] }) {
  const width = asset.width ?? 1000;
  const height = asset.height ?? 650;
  const image = await assetAsDataUrl(asset);
  const pointCoords = prompts.map((prompt) => [prompt.x / EDITOR_WIDTH * width, prompt.y / EDITOR_HEIGHT * height]);
  const pointLabels = prompts.map((prompt) => prompt.label);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        point_coords: pointCoords,
        point_labels: pointLabels,
        points: pointCoords.map(([x, y], index) => ({ x, y, label: pointLabels[index] })),
        multimask_output: false,
        return_format: "polygon",
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`O endpoint SAM respondeu com HTTP ${response.status}.`);
    return parseResponse(await response.json() as SamResponse, width, height);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("O SAM local demorou mais de 3 minutos para responder.");
    }
    if (error instanceof TypeError) {
      throw new Error("Não foi possível acessar o SAM local. Verifique se o conector está aberto e autorize o acesso à rede local.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
