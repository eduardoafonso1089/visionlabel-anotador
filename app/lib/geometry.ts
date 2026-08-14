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

export function edgeMidpoints(points: number[]) {
  const result: Array<{ x: number; y: number; edgeIndex: number }> = [];
  if (points.length < 4) return result;
  const limit = points.length === 4 ? 2 : points.length;
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

function lineLength(points: Array<[number, number]>) {
  return points.slice(1).reduce(
    (sum, point, index) => sum + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]),
    0,
  );
}

export function reshapePolygon(points: number[], path: number[], snapDistance = 34) {
  if (points.length < 6 || path.length < 4) return null;
  const ring: Array<[number, number]> = [];
  for (let index = 0; index < points.length; index += 2) ring.push([points[index], points[index + 1]]);
  const rawPath: Array<[number, number]> = [];
  for (let index = 0; index < path.length; index += 2) rawPath.push([path[index], path[index + 1]]);

  const endpointTargets = [rawPath[0], rawPath.at(-1)!].map(([x, y]) => ({ x, y }));
  const snaps = endpointTargets.map((target) => {
    let best = { edge: 0, x: 0, y: 0, t: 0, distance: Number.POSITIVE_INFINITY };
    ring.forEach((vertex, edge) => {
      const next = ring[(edge + 1) % ring.length];
      const projection = segmentProjection(target, { x: vertex[0], y: vertex[1] }, { x: next[0], y: next[1] });
      if (projection.distance < best.distance) best = { edge, ...projection };
    });
    return best;
  });
  if (snaps.some((snap) => snap.distance > snapDistance)) return null;

  const insertions = new Map<number, Array<{ endpoint: number; t: number; point: [number, number] }>>();
  snaps.forEach((snap, endpoint) => {
    const list = insertions.get(snap.edge) ?? [];
    list.push({ endpoint, t: snap.t, point: [snap.x, snap.y] });
    insertions.set(snap.edge, list);
  });

  const augmented: Array<[number, number]> = [];
  const endpointIndices = [-1, -1];
  ring.forEach((vertex, edge) => {
    augmented.push(vertex);
    for (const insertion of (insertions.get(edge) ?? []).sort((a, b) => a.t - b.t)) {
      if (insertion.t <= 0.015) endpointIndices[insertion.endpoint] = augmented.length - 1;
      else if (insertion.t >= 0.985) {
        // The endpoint is the first vertex of the next edge and is resolved after the ring is built.
        endpointIndices[insertion.endpoint] = (edge + 1) % ring.length;
      } else {
        augmented.push(insertion.point);
        endpointIndices[insertion.endpoint] = augmented.length - 1;
      }
    }
  });

  // Re-resolve endpoints by coordinates because earlier insertions shift later indices.
  snaps.forEach((snap, endpoint) => {
    endpointIndices[endpoint] = augmented.reduce((bestIndex, vertex, index) =>
      Math.hypot(vertex[0] - snap.x, vertex[1] - snap.y) <
      Math.hypot(augmented[bestIndex][0] - snap.x, augmented[bestIndex][1] - snap.y)
        ? index
        : bestIndex, 0);
  });
  const [startIndex, endIndex] = endpointIndices;
  if (startIndex === endIndex) return null;

  const simplifiedPath = openPathSimplify(rawPath, 2.2);
  simplifiedPath[0] = augmented[startIndex];
  simplifiedPath[simplifiedPath.length - 1] = augmented[endIndex];
  const forward = ringArc(augmented, startIndex, endIndex);
  const backward = ringArc(augmented, endIndex, startIndex);
  let result: Array<[number, number]>;
  if (lineLength(forward) <= lineLength(backward)) {
    result = [...simplifiedPath, ...backward.slice(1, -1)];
  } else {
    result = [...forward, ...simplifiedPath.slice(1, -1).reverse()];
  }
  const deduplicated = result.filter((point, index) => {
    const previous = result[(index - 1 + result.length) % result.length];
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= 1;
  });
  return deduplicated.length >= 3 ? deduplicated.flat() : null;
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
  if (annotation.type === "polygon") return polygonBounds(annotation.pts ?? []);
  return {
    x: Math.max(0, (annotation.x ?? 0) - 4),
    y: Math.max(0, (annotation.y ?? 0) - 4),
    width: 8,
    height: 8,
  };
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
