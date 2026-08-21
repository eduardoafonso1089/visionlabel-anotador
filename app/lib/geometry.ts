import type { Annotation } from "./types";
import polygonClipping from "polygon-clipping";

export const EDITOR_WIDTH = 1000;
export const EDITOR_HEIGHT = 650;
export const MIN_VERTEX_DISTANCE = 10;

export function pointsToSvg(points: number[] = []) {
  return points.reduce(
    (value, coordinate, index) =>
      index % 2 ? `${value}${coordinate} ` : `${value}${coordinate},`,
    "",
  );
}

export function deletePolygonVertex(points: number[], vertexIndex: number) {
  if (vertexIndex < 0 || vertexIndex >= points.length / 2) {
    return points;
  }
  if (points.length <= 2) return [];
  return points.filter((_, index) => {
    const pointIndex = Math.floor(index / 2);
    return pointIndex !== vertexIndex;
  });
}

export function insertPolygonVertex(points: number[], edgeIndex: number, x: number, y: number) {
  const tooClose = points.some((coordinate, index) =>
    index % 2 === 0 && Math.hypot(coordinate - x, points[index + 1] - y) < MIN_VERTEX_DISTANCE,
  );
  if (tooClose) return points;
  const insertionIndex = (edgeIndex + 1) * 2;
  return [
    ...points.slice(0, insertionIndex),
    Math.max(0, Math.min(EDITOR_WIDTH, x)),
    Math.max(0, Math.min(EDITOR_HEIGHT, y)),
    ...points.slice(insertionIndex),
  ];
}

// `open` descarta a aresta de fechamento, para polilinhas não ganharem um ponto de inserção
// entre o último e o primeiro vértice.
export function edgeMidpoints(points: number[], open = false) {
  const result: Array<{ x: number; y: number; edgeIndex: number }> = [];
  if (points.length < 4) return result;
  const limit = open ? points.length - 2 : points.length === 4 ? 2 : points.length;
  for (let index = 0; index < limit; index += 2) {
    const next = (index + 2) % points.length;
    if (Math.hypot(points[index] - points[next], points[index + 1] - points[next + 1]) < MIN_VERTEX_DISTANCE * 3) continue;
    result.push({
      x: (points[index] + points[next]) / 2,
      y: (points[index + 1] + points[next + 1]) / 2,
      edgeIndex: index / 2,
    });
  }
  return result;
}

export function movePolygon(points: number[], dx: number, dy: number) {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  const boundedDx = Math.max(-Math.min(...xs), Math.min(EDITOR_WIDTH - Math.max(...xs), dx));
  const boundedDy = Math.max(-Math.min(...ys), Math.min(EDITOR_HEIGHT - Math.max(...ys), dy));
  return points.map((coordinate, index) =>
    index % 2 === 0 ? coordinate + boundedDx : coordinate + boundedDy,
  );
}

export function annotationsBounds(annotations: Annotation[]) {
  const bounds = annotations.map(annotationBounds);
  return {
    x: Math.min(...bounds.map((item) => item.x)),
    y: Math.min(...bounds.map((item) => item.y)),
    width: Math.max(...bounds.map((item) => item.x + item.width)) - Math.min(...bounds.map((item) => item.x)),
    height: Math.max(...bounds.map((item) => item.y + item.height)) - Math.min(...bounds.map((item) => item.y)),
  };
}

export function boundedAnnotationDelta(annotations: Annotation[], dx: number, dy: number) {
  if (!annotations.length) return { dx: 0, dy: 0 };
  const bounds = annotationsBounds(annotations);
  return {
    dx: Math.max(-bounds.x, Math.min(EDITOR_WIDTH - bounds.x - bounds.width, dx)),
    dy: Math.max(-bounds.y, Math.min(EDITOR_HEIGHT - bounds.y - bounds.height, dy)),
  };
}

export function translateAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.type === "polygon" || annotation.type === "line") {
    return {
      ...annotation,
      pts: (annotation.pts ?? []).map((coordinate, index) => coordinate + (index % 2 ? dy : dx)),
    };
  }
  return { ...annotation, x: (annotation.x ?? 0) + dx, y: (annotation.y ?? 0) + dy };
}

export function polygonBounds(points: number[]) {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

export function polygonCenter(points: number[]) {
  const bounds = polygonBounds(points);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function fitPointsToEditor(points: number[]) {
  let fitted = [...points];
  let bounds = polygonBounds(fitted);
  if (bounds.width > EDITOR_WIDTH || bounds.height > EDITOR_HEIGHT) {
    const center = polygonCenter(fitted);
    const factor = Math.min(
      EDITOR_WIDTH / Math.max(bounds.width, 1),
      EDITOR_HEIGHT / Math.max(bounds.height, 1),
    );
    fitted = fitted.map((coordinate, index) =>
      index % 2
        ? center.y + (coordinate - center.y) * factor
        : center.x + (coordinate - center.x) * factor,
    );
    bounds = polygonBounds(fitted);
  }
  const dx = bounds.x < 0
    ? -bounds.x
    : bounds.x + bounds.width > EDITOR_WIDTH
      ? EDITOR_WIDTH - bounds.x - bounds.width
      : 0;
  const dy = bounds.y < 0
    ? -bounds.y
    : bounds.y + bounds.height > EDITOR_HEIGHT
      ? EDITOR_HEIGHT - bounds.y - bounds.height
      : 0;
  return fitted.map((coordinate, index) => coordinate + (index % 2 ? dy : dx));
}

export function transformPolygon(
  points: number[],
  center: { x: number; y: number },
  scale = 1,
  rotation = 0,
) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const safeScale = Math.max(0.08, Math.min(12, scale));
  const transformed: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const dx = (points[index] - center.x) * safeScale;
    const dy = (points[index + 1] - center.y) * safeScale;
    transformed.push(
      center.x + dx * cosine - dy * sine,
      center.y + dx * sine + dy * cosine,
    );
  }
  return fitPointsToEditor(transformed);
}

function segmentProjection(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) };
}

export function snapPointToPolygons(
  point: { x: number; y: number },
  annotations: Annotation[],
  excludeId: string,
  tolerance = 13,
) {
  let best = { ...point, snapped: false, distance: tolerance };
  for (const annotation of annotations) {
    if (annotation.id === excludeId || annotation.type !== "polygon" || !annotation.pts?.length) continue;
    const points = annotation.pts;
    for (let index = 0; index < points.length; index += 2) {
      const vertexDistance = Math.hypot(point.x - points[index], point.y - points[index + 1]);
      if (vertexDistance < best.distance) {
        best = { x: points[index], y: points[index + 1], snapped: true, distance: vertexDistance };
      }
      const next = (index + 2) % points.length;
      const projection = segmentProjection(
        point,
        { x: points[index], y: points[index + 1] },
        { x: points[next], y: points[next + 1] },
      );
      if (projection.distance < best.distance) {
        best = { x: projection.x, y: projection.y, snapped: true, distance: projection.distance };
      }
    }
  }
  return best;
}

function openPathSimplify(points: Array<[number, number]>, tolerance: number) {
  return rdp(points, tolerance);
}

function ringArc(vertices: Array<[number, number]>, start: number, end: number) {
  const result: Array<[number, number]> = [vertices[start]];
  let index = start;
  while (index !== end) {
    index = (index + 1) % vertices.length;
    result.push(vertices[index]);
  }
  return result;
}

export function pointInPolygon(point: { x: number; y: number }, points: number[]) {
  let inside = false;
  for (let index = 0, previous = points.length - 2; index < points.length; previous = index, index += 2) {
    const xi = points[index]; const yi = points[index + 1];
    const xj = points[previous]; const yj = points[previous + 1];
    const crosses = yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentIntersection(
  a: [number, number], b: [number, number],
  c: [number, number], d: [number, number],
) {
  const abx = b[0] - a[0]; const aby = b[1] - a[1];
  const cdx = d[0] - c[0]; const cdy = d[1] - c[1];
  const denominator = abx * cdy - aby * cdx;
  if (Math.abs(denominator) < 1e-8) return null;
  const acx = c[0] - a[0]; const acy = c[1] - a[1];
  const pathT = (acx * cdy - acy * cdx) / denominator;
  const edgeT = (acx * aby - acy * abx) / denominator;
  if (pathT < 0 || pathT > 1 || edgeT < 0 || edgeT > 1) return null;
  return { x: a[0] + pathT * abx, y: a[1] + pathT * aby, pathT, edgeT };
}

export type ReshapeResult = {
  points: number[] | null;
  mode: "add" | "delete" | null;
  reason: "mixed" | "crossings" | "direction" | null;
};

export function reshapePolygon(points: number[], path: number[]): ReshapeResult {
  if (points.length < 6 || path.length < 6) return { points: null, mode: null, reason: "crossings" };
  const ring: Array<[number, number]> = [];
  const trace: Array<[number, number]> = [];
  for (let index = 0; index < points.length; index += 2) ring.push([points[index], points[index + 1]]);
  for (let index = 0; index < path.length; index += 2) trace.push([path[index], path[index + 1]]);

  const startInside = pointInPolygon({ x: trace[0][0], y: trace[0][1] }, points);
  const endInside = pointInPolygon({ x: trace.at(-1)![0], y: trace.at(-1)![1] }, points);
  if (startInside !== endInside) return { points: null, mode: null, reason: "mixed" };
  const mode: "add" | "delete" = startInside ? "add" : "delete";

  const intersections: Array<{
    pathSegment: number; pathT: number; edge: number; edgeT: number; point: [number, number];
  }> = [];
  for (let pathSegment = 0; pathSegment < trace.length - 1; pathSegment += 1) {
    for (let edge = 0; edge < ring.length; edge += 1) {
      const hit = segmentIntersection(trace[pathSegment], trace[pathSegment + 1], ring[edge], ring[(edge + 1) % ring.length]);
      if (!hit) continue;
      const duplicate = intersections.some((item) => Math.hypot(item.point[0] - hit.x, item.point[1] - hit.y) < 1);
      if (!duplicate) intersections.push({ pathSegment, pathT: hit.pathT, edge, edgeT: hit.edgeT, point: [hit.x, hit.y] });
    }
  }
  intersections.sort((a, b) => a.pathSegment + a.pathT - b.pathSegment - b.pathT);
  if (intersections.length < 2) return { points: null, mode, reason: "crossings" };
  const first = intersections[0];
  const last = intersections.at(-1)!;
  if (Math.hypot(first.point[0] - last.point[0], first.point[1] - last.point[1]) < 2) {
    return { points: null, mode, reason: "crossings" };
  }

  const traceSection: Array<[number, number]> = [first.point];
  for (let index = first.pathSegment + 1; index <= last.pathSegment; index += 1) traceSection.push(trace[index]);
  traceSection.push(last.point);
  const simplifiedTrace = openPathSimplify(traceSection, 2.2);

  const insertions = new Map<number, Array<{ endpoint: number; t: number; point: [number, number] }>>();
  [first, last].forEach((hit, endpoint) => {
    const list = insertions.get(hit.edge) ?? [];
    list.push({ endpoint, t: hit.edgeT, point: hit.point });
    insertions.set(hit.edge, list);
  });
  const augmented: Array<[number, number]> = [];
  ring.forEach((vertex, edge) => {
    augmented.push(vertex);
    for (const insertion of (insertions.get(edge) ?? []).sort((a, b) => a.t - b.t)) {
      if (insertion.t > 0.001 && insertion.t < 0.999) augmented.push(insertion.point);
    }
  });
  const endpointIndices = [first.point, last.point].map((target) => augmented.reduce((best, vertex, index) =>
    Math.hypot(vertex[0] - target[0], vertex[1] - target[1]) <
    Math.hypot(augmented[best][0] - target[0], augmented[best][1] - target[1]) ? index : best, 0));
  const [startIndex, endIndex] = endpointIndices;
  if (startIndex === endIndex) return { points: null, mode, reason: "crossings" };
  simplifiedTrace[0] = augmented[startIndex];
  simplifiedTrace[simplifiedTrace.length - 1] = augmented[endIndex];

  const forward = ringArc(augmented, startIndex, endIndex);
  const backward = ringArc(augmented, endIndex, startIndex);
  const candidates = [
    [...simplifiedTrace, ...backward.slice(1, -1)],
    [...forward, ...simplifiedTrace.slice(1, -1).reverse()],
  ].map((candidate) => candidate.filter((point, index) => {
    const previous = candidate[(index - 1 + candidate.length) % candidate.length];
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= 1;
  })).filter((candidate) => candidate.length >= 3);
  if (!candidates.length) return { points: null, mode, reason: "crossings" };

  const originalArea = polygonArea(points);
  const minimumChange = Math.max(12, originalArea * 0.0001);
  const directionalCandidates = candidates.filter((candidate) => {
    const area = polygonArea(candidate.flat());
    return mode === "add" ? area > originalArea + minimumChange : area < originalArea - minimumChange;
  });
  if (!directionalCandidates.length) return { points: null, mode, reason: "direction" };
  const selectedCandidate = directionalCandidates.reduce((best, candidate) => {
    const candidateArea = polygonArea(candidate.flat());
    const bestArea = polygonArea(best.flat());
    return mode === "add"
      ? candidateArea < bestArea ? candidate : best
      : candidateArea > bestArea ? candidate : best;
  });
  return { points: selectedCandidate.flat(), mode, reason: null };
}

export function annotationBounds(annotation: Annotation) {
  if (annotation.type === "box") {
    return {
      x: annotation.x ?? 0,
      y: annotation.y ?? 0,
      width: annotation.w ?? 0,
      height: annotation.h ?? 0,
    };
  }
  if (annotation.type === "polygon" || annotation.type === "line") return polygonBounds(annotation.pts ?? []);
  return {
    x: Math.max(0, (annotation.x ?? 0) - 4),
    y: Math.max(0, (annotation.y ?? 0) - 4),
    width: 8,
    height: 8,
  };
}

export function annotationIntersectsRect(
  annotation: Annotation,
  rect: { x: number; y: number; width: number; height: number },
) {
  const bounds = annotationBounds(annotation);
  return bounds.x <= rect.x + rect.width && bounds.x + bounds.width >= rect.x &&
    bounds.y <= rect.y + rect.height && bounds.y + bounds.height >= rect.y;
}

export function polygonArea(points: number[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += points[index] * points[next + 1] - points[next] * points[index + 1];
  }
  return Math.abs(area / 2);
}

export function scalePoints(points: number[], width: number, height: number) {
  const sx = width / EDITOR_WIDTH;
  const sy = height / EDITOR_HEIGHT;
  return points.map((coordinate, index) => coordinate * (index % 2 ? sy : sx));
}

export function updatePolygonVertex(points: number[], vertexIndex: number, x: number, y: number) {
  const clampedX = Math.max(0, Math.min(EDITOR_WIDTH, x));
  const clampedY = Math.max(0, Math.min(EDITOR_HEIGHT, y));
  const overlapsAnotherVertex = points.some((coordinate, index) =>
    index % 2 === 0 && index / 2 !== vertexIndex &&
    Math.hypot(coordinate - clampedX, points[index + 1] - clampedY) < MIN_VERTEX_DISTANCE,
  );
  if (overlapsAnotherVertex) return points;
  return points.map((coordinate, index) => {
    if (index === vertexIndex * 2) return clampedX;
    if (index === vertexIndex * 2 + 1) return clampedY;
    return coordinate;
  });
}

function perpendicularDistance(point: [number, number], start: [number, number], end: [number, number]) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function rdp(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], points[0], points.at(-1)!);
    if (distance > maxDistance) { maxDistance = distance; splitIndex = index; }
  }
  if (maxDistance <= tolerance) return [points[0], points.at(-1)!];
  return [
    ...rdp(points.slice(0, splitIndex + 1), tolerance).slice(0, -1),
    ...rdp(points.slice(splitIndex), tolerance),
  ];
}

export function simplifyPolygon(points: number[], tolerance = 4) {
  const tuples: Array<[number, number]> = [];
  for (let index = 0; index < points.length; index += 2) tuples.push([points[index], points[index + 1]]);
  if (tuples.length < 4) return points;
  const simplified = rdp([...tuples, tuples[0]], tolerance).slice(0, -1);
  return simplified.length >= 3 ? simplified.flat() : points;
}

function toRing(points: number[]): Array<[number, number]> {
  const ring: Array<[number, number]> = [];
  for (let index = 0; index < points.length; index += 2) ring.push([points[index], points[index + 1]]);
  ring.push(ring[0]);
  return ring;
}

function ringsFromMultiPolygon(multiPolygon: polygonClipping.MultiPolygon) {
  return multiPolygon
    .flatMap((polygon) => polygon.slice(0, 1))
    .map((ring) => ring.slice(0, -1).flat())
    .filter((points) => points.length >= 6);
}

export function unionPolygons(polygons: number[][]) {
  if (polygons.length < 2) return polygons;
  const subject: polygonClipping.Polygon = [toRing(polygons[0])];
  const clips = polygons.slice(1).map((points) => [toRing(points)] as polygonClipping.Polygon);
  return ringsFromMultiPolygon(polygonClipping.union(subject, ...clips));
}

export function splitPolygon(points: number[], start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 5) return [points];
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy * 0.9;
  const py = ux * 0.9;
  const extension = 2000;
  const ax = start.x - ux * extension;
  const ay = start.y - uy * extension;
  const bx = end.x + ux * extension;
  const by = end.y + uy * extension;
  const cutter: polygonClipping.Polygon = [[
    [ax + px, ay + py],
    [bx + px, by + py],
    [bx - px, by - py],
    [ax - px, ay - py],
    [ax + px, ay + py],
  ]];
  const difference = polygonClipping.difference([toRing(points)], cutter);
  const result = ringsFromMultiPolygon(difference);
  return result.length >= 2 ? result : [points];
}
