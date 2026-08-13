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
