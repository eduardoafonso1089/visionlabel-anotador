"use client";

import {
  Box, Check, ChevronDown, ChevronLeft, ChevronRight, CircleMinus, CirclePlus,
  Cloud, Combine, Copy, Download, Eye, Hand, ImagePlus, Keyboard, Link2,
  ListRestart, LoaderCircle, Magnet, Maximize2, Menu, MoreHorizontal, MousePointer2, PenLine,
  Pentagon, Plus, Redo2, RotateCcw, Scissors, Search, Settings2, Sparkles,
  Trash2, Undo2, WandSparkles, X, ZoomIn, ZoomOut, PenTool,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deletePolygonVertex, edgeMidpoints, insertPolygonVertex, movePolygon,
  MIN_VERTEX_DISTANCE, pointsToSvg, polygonBounds, polygonCenter, reshapePolygon,
  simplifyPolygon, snapPointToPolygons, splitPolygon, transformPolygon, unionPolygons,
  updatePolygonVertex,
} from "./lib/geometry";
import { exportCoco, exportProject, exportYoloZip } from "./lib/exporters";
import { requestSamMask } from "./lib/sam";
import type { Annotation, Asset, Label, SamPrompt, Tool } from "./lib/types";

const demoAssets: Asset[] = [
  { id: "i1", name: "talhao_07_001.jpg", src: "https://images.unsplash.com/photo-1495107334309-fcf20504a5ab?auto=format&fit=crop&w=1600&q=88", width: 1600, height: 1040 },
  { id: "i2", name: "talhao_07_002.jpg", src: "https://images.unsplash.com/photo-1530836369250-ef72a3f5cda8?auto=format&fit=crop&w=1600&q=88", width: 1600, height: 1040 },
  { id: "i3", name: "talhao_07_003.jpg", src: "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=1600&q=88", width: 1600, height: 1040 },
  { id: "i4", name: "talhao_07_004.jpg", src: "https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?auto=format&fit=crop&w=1600&q=88", width: 1600, height: 1040 },
];

const startLabels: Label[] = [
  { id: "weed", name: "erva daninha", color: "#ff6b4a", key: "1" },
  { id: "crop", name: "cultura", color: "#a8e063", key: "2" },
  { id: "soil", name: "solo exposto", color: "#ffc857", key: "3" },
];

const startAnnotations: Annotation[] = [
  { id: "a1", asset: "i1", label: "weed", type: "box", x: 150, y: 215, w: 210, h: 195 },
  { id: "a2", asset: "i1", label: "crop", type: "polygon", pts: [465, 130, 650, 92, 780, 215, 728, 448, 545, 498, 412, 344] },
  { id: "a3", asset: "i1", label: "soil", type: "point", x: 815, y: 470 },
  { id: "a4", asset: "i2", label: "crop", type: "box", x: 242, y: 120, w: 474, h: 376 },
];

const colors = ["#6c8cff", "#d987ff", "#26c6b6", "#ff8a65"];

type PolygonDrag = { annotationId: string; startX: number; startY: number; points: number[] };
type VertexDrag = { annotationId: string; vertexIndex: number };
type TransformDrag = {
  annotationId: string;
  kind: "scale" | "rotate";
  center: { x: number; y: number };
  startAngle: number;
  startDistance: number;
  points: number[];
};

function ToolButton({ title, active, disabled, onClick, children, keyHint }: { title: string; active?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode; keyHint?: string }) {
  return <button className={`tool-btn ${active ? "active" : ""}`} aria-label={title} title={title} disabled={disabled} onClick={onClick}>{children}{keyHint && <small>{keyHint}</small>}</button>;
}

export default function Home() {
  const [assets, setAssets] = useState(demoAssets);
  const [current, setCurrent] = useState("i1");
  const [labels, setLabels] = useState(startLabels);
  const [activeLabel, setActiveLabel] = useState("weed");
  const [annotations, setAnnotations] = useState(startAnnotations);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<{ annotationId: string; vertexIndex: number } | null>(null);
  const [polygonDrag, setPolygonDrag] = useState<PolygonDrag | null>(null);
  const [vertexDrag, setVertexDrag] = useState<VertexDrag | null>(null);
  const [transformDrag, setTransformDrag] = useState<TransformDrag | null>(null);
  const [reshapeDraft, setReshapeDraft] = useState<number[]>([]);
  const [reshapeDrawing, setReshapeDrawing] = useState(false);
  const [snapping, setSnapping] = useState(true);
  const [snapGuide, setSnapGuide] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(92);
  const [search, setSearch] = useState("");
  const [quality, setQuality] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [addingLabel, setAddingLabel] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [panStart, setPanStart] = useState<{ x: number; y: number; left: number; top: number } | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [polygonDraft, setPolygonDraft] = useState<number[]>([]);
  const [freehandDraft, setFreehandDraft] = useState<number[]>([]);
  const [freehandDrawing, setFreehandDrawing] = useState(false);
  const [splitStart, setSplitStart] = useState<{ x: number; y: number } | null>(null);
  const [splitEnd, setSplitEnd] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [samOpen, setSamOpen] = useState(false);
  const [samEndpoint, setSamEndpoint] = useState(() => {
    if (typeof window === "undefined") return "";
    const stored = localStorage.getItem("visionlabel-sam-endpoint") ?? "";
    try {
      const host = new URL(stored).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? stored : "";
    } catch { return ""; }
  });
  const [samEndpointDraft, setSamEndpointDraft] = useState("http://127.0.0.1:7860/predict");
  const [samPromptMode, setSamPromptMode] = useState<0 | 1>(1);
  const [samPrompts, setSamPrompts] = useState<SamPrompt[]>([]);
  const [samPreview, setSamPreview] = useState<number[]>([]);
  const [samLoading, setSamLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const vertexDragRef = useRef<VertexDrag | null>(null);
  const transformDragRef = useRef<TransformDrag | null>(null);
  const idCounter = useRef(0);

  const asset = assets.find((item) => item.id === current) ?? assets[0];
  const currentAnnotations = annotations.filter((annotation) => annotation.asset === current);
  const activeAnnotation = annotations.find((annotation) => annotation.id === selected);
  const activePolygonBounds = activeAnnotation?.type === "polygon" && (activeAnnotation.pts?.length ?? 0) >= 6
    ? polygonBounds(activeAnnotation.pts ?? [])
    : null;
  const activePolygonCenter = activeAnnotation?.type === "polygon" && (activeAnnotation.pts?.length ?? 0) >= 6
    ? polygonCenter(activeAnnotation.pts ?? [])
    : null;
  const transformRotationY = activePolygonBounds
    ? activePolygonBounds.y > 52
      ? activePolygonBounds.y - 42
      : activePolygonBounds.y + activePolygonBounds.height + 42
    : 0;
  const transformRotationAnchorY = activePolygonBounds
    ? activePolygonBounds.y > 52
      ? activePolygonBounds.y
      : activePolygonBounds.y + activePolygonBounds.height
    : 0;
  const selectedPolygons = annotations.filter((annotation) => multiSelected.includes(annotation.id) && annotation.type === "polygon");
  const getLabel = useCallback((id: string) => labels.find((label) => label.id === id) ?? labels[0], [labels]);
  const completed = useMemo(() => new Set(annotations.map((annotation) => annotation.asset)).size, [annotations]);
  const remember = useCallback(() => { setHistory((items) => [...items.slice(-24), annotations]); setSaved(false); }, [annotations]);

  function makeId(prefix: string) {
    idCounter.current += 1;
    return `${prefix}-${idCounter.current}`;
  }

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((currentToast) => currentToast === message ? null : currentToast), 3800);
  }, []);

  const undo = useCallback(() => {
    if (!history.length) return;
    setAnnotations(history.at(-1)!);
    setHistory((items) => items.slice(0, -1));
    setSelected(null); setMultiSelected([]); setSelectedVertex(null); setSnapGuide(null); setSaved(false);
  }, [history]);

  const deleteSelection = useCallback(() => {
    if (polygonDraft.length) {
      setPolygonDraft((points) => points.slice(0, -2));
      return;
    }
    if (selectedVertex) {
      const annotation = annotations.find((item) => item.id === selectedVertex.annotationId);
      if (!annotation?.pts?.length) return;
      remember();
      if (annotation.pts.length === 2) {
        setAnnotations((items) => items.filter((item) => item.id !== selectedVertex.annotationId));
        setSelected(null); setMultiSelected([]); setSelectedVertex(null);
        showToast("Último nó removido; o polígono foi excluído.");
        return;
      }
      const nextPoints = deletePolygonVertex(annotation.pts, selectedVertex.vertexIndex);
      const nextVertexIndex = Math.min(selectedVertex.vertexIndex, nextPoints.length / 2 - 1);
      setAnnotations((items) => items.map((item) => item.id === selectedVertex.annotationId ? { ...item, pts: nextPoints } : item));
      setSelectedVertex({ annotationId: selectedVertex.annotationId, vertexIndex: nextVertexIndex });
      showToast("Nó removido; Delete continua pelo próximo nó da sequência.");
      return;
    }
    if (!selected) return;
    remember();
    const ids = multiSelected.length > 1 ? multiSelected : [selected];
    setAnnotations((items) => items.filter((annotation) => !ids.includes(annotation.id)));
    setSelected(null); setMultiSelected([]);
  }, [annotations, multiSelected, polygonDraft.length, remember, selected, selectedVertex, showToast]);

  const finishPolygon = useCallback(() => {
    if (polygonDraft.length < 6) return;
    remember();
    const id = makeId("annotation");
    setAnnotations((items) => [...items, { id, asset: current, label: activeLabel, type: "polygon", pts: polygonDraft }]);
    setPolygonDraft([]); setSelected(id); setMultiSelected([id]);
  }, [polygonDraft, remember, current, activeLabel]);

  useEffect(() => {
    if (saved) return;
    const timeout = window.setTimeout(() => {
      localStorage.setItem("visionlabel-annotations", JSON.stringify(annotations));
      setSaved(true);
    }, 500);
    return () => clearTimeout(timeout);
  }, [annotations, saved]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).tagName === "INPUT") return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); return; }
      if (event.key === "Enter" && tool === "polygon") finishPolygon();
      if (event.key === "Escape") {
        setPolygonDraft([]); setFreehandDraft([]); setFreehandDrawing(false); setDraft(null);
        setSplitStart(null); setSplitEnd(null); setReshapeDraft([]); setReshapeDrawing(false);
        transformDragRef.current = null; setTransformDrag(null); setSnapGuide(null);
        setSamPrompts([]); setSamPreview([]);
        setSelected(null); setMultiSelected([]); setSelectedVertex(null);
      }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); }
      const tools: Record<string, Tool> = { v: "select", h: "pan", b: "box", p: "polygon", f: "freehand", k: "point", s: "sam", t: "transform", r: "reshape" };
      const nextTool = tools[event.key.toLowerCase()];
      if (nextTool) {
        if (nextTool === "sam" && !samEndpoint) {
          setSamEndpointDraft(samEndpoint || "http://127.0.0.1:7860/predict"); setSamOpen(true);
        } else setTool(nextTool);
      }
      const label = labels.find((item) => item.key === event.key);
      if (label) setActiveLabel(label.id);
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [deleteSelection, finishPolygon, labels, samEndpoint, tool, undo]);

  function resetDrafts() {
    setPolygonDraft([]); setFreehandDraft([]); setFreehandDrawing(false); setDraft(null);
    setSplitStart(null); setSplitEnd(null); setReshapeDraft([]); setReshapeDrawing(false);
    transformDragRef.current = null; setTransformDrag(null); setSnapGuide(null); clearSam();
  }

  function editorPoint(clientX: number, clientY: number) {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return { x: Math.max(0, Math.min(1000, (clientX - bounds.left) / bounds.width * 1000)), y: Math.max(0, Math.min(650, (clientY - bounds.top) / bounds.height * 650)) };
  }

  function zoomWithWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const nextZoom = Math.max(30, Math.min(400, zoom + (event.deltaY < 0 ? 10 : -10)));
    if (nextZoom === zoom) return;
    const scroller = scrollRef.current;
    const canvas = svgRef.current?.parentElement;
    if (!scroller || !canvas) { setZoom(nextZoom); return; }
    const oldBounds = canvas.getBoundingClientRect();
    const clientX = event.clientX;
    const clientY = event.clientY;
    const anchorX = Math.max(0, Math.min(1, (clientX - oldBounds.left) / oldBounds.width));
    const anchorY = Math.max(0, Math.min(1, (clientY - oldBounds.top) / oldBounds.height));
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      const newBounds = canvas.getBoundingClientRect();
      scroller.scrollLeft += newBounds.left + anchorX * newBounds.width - clientX;
      scroller.scrollTop += newBounds.top + anchorY * newBounds.height - clientY;
    });
  }

  function capture(pointerId: number) { svgRef.current?.setPointerCapture(pointerId); }

  async function runSam(prompts: SamPrompt[]) {
    setSamLoading(true);
    try { setSamPreview(await requestSamMask({ endpoint: samEndpoint, asset, prompts })); }
    catch (error) { showToast(error instanceof Error ? error.message : "Falha ao consultar o SAM."); }
    finally { setSamLoading(false); }
  }

  function canvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const point = editorPoint(event.clientX, event.clientY);
    if (tool === "select") { setSelected(null); setMultiSelected([]); setSelectedVertex(null); return; }
    if (tool === "pan") {
      const scroller = scrollRef.current;
      if (scroller) { setPanStart({ x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop }); capture(event.pointerId); }
      return;
    }
    if (tool === "box") { setStart(point); setDraft({ ...point, w: 0, h: 0 }); capture(event.pointerId); }
    if (tool === "polygon") setPolygonDraft((points) => [...points, point.x, point.y]);
    if (tool === "freehand" && !freehandDrawing) { setFreehandDraft([point.x, point.y]); setFreehandDrawing(true); }
    if (tool === "reshape" && activeAnnotation?.type === "polygon" && !reshapeDrawing) {
      setReshapeDraft([point.x, point.y]); setReshapeDrawing(true);
    }
    if (tool === "point") {
      remember(); const id = makeId("annotation");
      setAnnotations((items) => [...items, { id, asset: current, label: activeLabel, type: "point", ...point }]);
      setSelected(id); setMultiSelected([id]);
    }
    if (tool === "sam") {
      const prompts = [...samPrompts, { ...point, label: samPromptMode }];
      setSamPrompts(prompts); void runSam(prompts);
    }
    if (tool === "split" && activeAnnotation?.type === "polygon") { setSplitStart(point); setSplitEnd(point); capture(event.pointerId); }
  }

  function canvasPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const point = editorPoint(event.clientX, event.clientY);
    if (polygonDrag) {
      setAnnotations((items) => items.map((annotation) => annotation.id === polygonDrag.annotationId ? { ...annotation, pts: movePolygon(polygonDrag.points, point.x - polygonDrag.startX, point.y - polygonDrag.startY) } : annotation)); setSaved(false); return;
    }
    const activeVertexDrag = vertexDragRef.current ?? vertexDrag;
    if (activeVertexDrag) {
      const target = snapping
        ? snapPointToPolygons(point, currentAnnotations, activeVertexDrag.annotationId)
        : { ...point, snapped: false };
      setSnapGuide(target.snapped ? { x: target.x, y: target.y } : null);
      setAnnotations((items) => items.map((annotation) => annotation.id === activeVertexDrag.annotationId ? { ...annotation, pts: updatePolygonVertex(annotation.pts ?? [], activeVertexDrag.vertexIndex, target.x, target.y) } : annotation)); setSaved(false); return;
    }
    if (tool === "pan" && panStart && scrollRef.current) {
      scrollRef.current.scrollLeft = panStart.left - (event.clientX - panStart.x); scrollRef.current.scrollTop = panStart.top - (event.clientY - panStart.y); return;
    }
    if (tool === "freehand" && freehandDrawing) {
      setFreehandDraft((points) => {
        const lastX = points.at(-2) ?? point.x; const lastY = points.at(-1) ?? point.y;
        return Math.hypot(point.x - lastX, point.y - lastY) >= 4 ? [...points, point.x, point.y] : points;
      }); return;
    }
    if (tool === "reshape" && reshapeDrawing) {
      setReshapeDraft((points) => {
        const lastX = points.at(-2) ?? point.x; const lastY = points.at(-1) ?? point.y;
        return Math.hypot(point.x - lastX, point.y - lastY) >= 4 ? [...points, point.x, point.y] : points;
      }); return;
    }
    if (tool === "split" && splitStart) { setSplitEnd(point); return; }
    if (!start || tool !== "box") return;
    setDraft({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), w: Math.abs(point.x - start.x), h: Math.abs(point.y - start.y) });
  }

  function canvasPointerUp() {
    if (polygonDrag || vertexDragRef.current || vertexDrag) { vertexDragRef.current = null; setPolygonDrag(null); setVertexDrag(null); setSnapGuide(null); return; }
    if (tool === "pan") { setPanStart(null); return; }
    if (tool === "freehand") return;
    if (tool === "reshape") return;
    if (tool === "split" && splitStart && splitEnd) { finishSplit(); return; }
    if (tool !== "box" || !draft || draft.w < 8 || draft.h < 8) { setStart(null); setDraft(null); return; }
    remember(); const id = makeId("annotation");
    setAnnotations((items) => [...items, { id, asset: current, label: activeLabel, type: "box", ...draft }]);
    setSelected(id); setMultiSelected([id]); setStart(null); setDraft(null);
  }

  function finishFreehand() {
    setFreehandDrawing(false);
    if (freehandDraft.length < 6) { setFreehandDraft([]); return; }
    remember(); const id = makeId("freehand");
    setAnnotations((items) => [...items, { id, asset: current, label: activeLabel, type: "polygon", pts: simplifyPolygon(freehandDraft, 2.2) }]);
    setFreehandDraft([]); setSelected(id); setMultiSelected([id]); showToast("Polígono criado. A mão livre continua ativa.");
  }

  function finishFreehandWithRightClick(event: React.MouseEvent<SVGSVGElement>) {
    event.preventDefault();
    if (tool === "freehand" && freehandDrawing) finishFreehand();
    if (tool === "reshape" && reshapeDrawing) finishReshape();
  }

  function finishReshape() {
    setReshapeDrawing(false);
    if (activeAnnotation?.type !== "polygon" || reshapeDraft.length < 4) { setReshapeDraft([]); return; }
    const reshaped = reshapePolygon(activeAnnotation.pts ?? [], reshapeDraft);
    setReshapeDraft([]);
    if (!reshaped) {
      showToast("Comece e termine o traço sobre duas bordas diferentes do polígono.");
      return;
    }
    remember();
    setAnnotations((items) => items.map((item) => item.id === activeAnnotation.id ? { ...item, pts: reshaped } : item));
    setSelectedVertex(null); showToast("Borda remodelada. A ferramenta continua ativa.");
  }

  function finishSplit() {
    const annotation = activeAnnotation;
    if (!annotation?.pts || !splitStart || !splitEnd) return;
    const parts = splitPolygon(annotation.pts, splitStart, splitEnd);
    setSplitStart(null); setSplitEnd(null);
    if (parts.length < 2) { showToast("A linha precisa atravessar o polígono de uma borda à outra."); return; }
    remember();
    const splitId = makeId("split");
    const created = parts.map((points, index) => ({ ...annotation, id: `${splitId}-${index}`, pts: points }));
    setAnnotations((items) => [...items.filter((item) => item.id !== annotation.id), ...created]);
    setSelected(created[0].id); setMultiSelected(created.map((item) => item.id)); showToast(`Polígono dividido em ${created.length} partes.`);
  }

  function beginPolygonDrag(event: React.PointerEvent, annotation: Annotation) {
    if (tool === "reshape") {
      event.preventDefault(); event.stopPropagation();
      const point = editorPoint(event.clientX, event.clientY);
      setSelected(annotation.id); setMultiSelected([annotation.id]); setSelectedVertex(null);
      setReshapeDraft([point.x, point.y]); setReshapeDrawing(true);
      return;
    }
    if (tool === "transform") {
      event.preventDefault(); event.stopPropagation();
      setSelected(annotation.id); setMultiSelected([annotation.id]); setSelectedVertex(null);
      return;
    }
    if (tool !== "select") return;
    event.stopPropagation();
    if (event.shiftKey) { toggleMultiSelection(annotation.id); return; }
    const point = editorPoint(event.clientX, event.clientY);
    remember(); setSelected(annotation.id); setMultiSelected([annotation.id]); setSelectedVertex(null);
    setPolygonDrag({ annotationId: annotation.id, startX: point.x, startY: point.y, points: [...(annotation.pts ?? [])] }); capture(event.pointerId);
  }

  function beginTransform(event: React.PointerEvent<SVGCircleElement>, annotation: Annotation, kind: "scale" | "rotate") {
    if (tool !== "transform" || annotation.type !== "polygon") return;
    event.preventDefault(); event.stopPropagation(); remember();
    const point = editorPoint(event.clientX, event.clientY);
    const center = polygonCenter(annotation.pts ?? []);
    const drag: TransformDrag = {
      annotationId: annotation.id,
      kind,
      center,
      startAngle: Math.atan2(point.y - center.y, point.x - center.x),
      startDistance: Math.max(1, Math.hypot(point.x - center.x, point.y - center.y)),
      points: [...(annotation.pts ?? [])],
    };
    transformDragRef.current = drag; setTransformDrag(drag);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { capture(event.pointerId); }
  }

  function moveTransformPointer(event: React.PointerEvent<SVGCircleElement>) {
    const drag = transformDragRef.current;
    if (!drag) return;
    event.preventDefault(); event.stopPropagation();
    const point = editorPoint(event.clientX, event.clientY);
    const angle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x);
    const distance = Math.max(1, Math.hypot(point.x - drag.center.x, point.y - drag.center.y));
    const nextPoints = drag.kind === "rotate"
      ? transformPolygon(drag.points, drag.center, 1, angle - drag.startAngle)
      : transformPolygon(drag.points, drag.center, distance / drag.startDistance, 0);
    setAnnotations((items) => items.map((item) => item.id === drag.annotationId ? { ...item, pts: nextPoints } : item));
    setSaved(false);
  }

  function finishTransformPointer(event: React.PointerEvent<SVGCircleElement>) {
    if (!transformDragRef.current) return;
    event.preventDefault(); event.stopPropagation();
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    transformDragRef.current = null; setTransformDrag(null); showToast("Transformação aplicada. A ferramenta continua ativa.");
  }

  function captureVertexPointer(event: React.PointerEvent<SVGCircleElement>, drag: VertexDrag) {
    vertexDragRef.current = drag;
    setVertexDrag(drag);
    try { event.currentTarget.setPointerCapture(event.pointerId); }
    catch { capture(event.pointerId); }
  }

  function moveVertexPointer(event: React.PointerEvent<SVGCircleElement>) {
    const drag = vertexDragRef.current;
    if (!drag) return;
    event.preventDefault(); event.stopPropagation();
    const point = editorPoint(event.clientX, event.clientY);
    setAnnotations((items) => items.map((annotation) => annotation.id === drag.annotationId ? { ...annotation, pts: updatePolygonVertex(annotation.pts ?? [], drag.vertexIndex, point.x, point.y) } : annotation));
    setSaved(false);
  }

  function finishVertexPointer(event: React.PointerEvent<SVGCircleElement>) {
    if (!vertexDragRef.current) return;
    event.preventDefault(); event.stopPropagation();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch { /* A captura já pode ter sido liberada pelo navegador. */ }
    vertexDragRef.current = null;
    setVertexDrag(null); setSnapGuide(null);
  }

  function beginVertexDrag(event: React.PointerEvent<SVGCircleElement>, annotation: Annotation, vertexIndex: number) {
    if (tool !== "select") return;
    event.preventDefault(); event.stopPropagation(); remember(); setSelected(annotation.id); setMultiSelected([annotation.id]); setSnapGuide(null);
    const drag = { annotationId: annotation.id, vertexIndex };
    setSelectedVertex(drag); captureVertexPointer(event, drag);
  }

  function insertVertex(event: React.PointerEvent<SVGCircleElement>, annotation: Annotation, edgeIndex: number, x: number, y: number) {
    if (tool !== "select") return;
    event.preventDefault(); event.stopPropagation();
    const points = annotation.pts ?? [];
    const nearbyVertex = points.findIndex((coordinate, index) =>
      index % 2 === 0 && Math.hypot(coordinate - x, points[index + 1] - y) < MIN_VERTEX_DISTANCE * 1.5,
    );
    if (nearbyVertex >= 0) {
      setSelected(annotation.id); setMultiSelected([annotation.id]);
      setSelectedVertex({ annotationId: annotation.id, vertexIndex: nearbyVertex / 2 });
      return;
    }
    remember();
    const vertexIndex = edgeIndex + 1;
    setAnnotations((items) => items.map((item) => item.id === annotation.id ? { ...item, pts: insertPolygonVertex(points, edgeIndex, x, y) } : item));
    const drag = { annotationId: annotation.id, vertexIndex };
    setSelected(annotation.id); setMultiSelected([annotation.id]); setSelectedVertex(drag); captureVertexPointer(event, drag);
  }

  function selectAnnotation(event: React.PointerEvent, annotation: Annotation) {
    if (tool !== "select") return;
    event.stopPropagation();
    if (event.shiftKey && annotation.type === "polygon") { toggleMultiSelection(annotation.id); return; }
    setSelected(annotation.id); setMultiSelected([annotation.id]); setSelectedVertex(null);
  }

  function toggleMultiSelection(id: string) {
    setMultiSelected((items) => {
      const base = selected && !items.includes(selected) ? [...items, selected] : items;
      const next = base.includes(id) ? base.filter((item) => item !== id) : [...base, id];
      setSelected(next.at(-1) ?? null); return next;
    });
    setSelectedVertex(null);
  }

  function simplifySelected() {
    if (activeAnnotation?.type !== "polygon") return;
    remember();
    setAnnotations((items) => items.map((item) => item.id === activeAnnotation.id ? { ...item, pts: simplifyPolygon(item.pts ?? [], 6) } : item));
    showToast("Geometria simplificada sem perder o contorno principal.");
  }

  function duplicateSelected() {
    if (activeAnnotation?.type !== "polygon") return;
    remember(); const id = makeId("copy");
    setAnnotations((items) => [...items, { ...activeAnnotation, id, pts: movePolygon(activeAnnotation.pts ?? [], 22, 22) }]);
    setSelected(id); setMultiSelected([id]); showToast("Polígono duplicado.");
  }

  function mergeSelected() {
    if (selectedPolygons.length < 2) return;
    if (new Set(selectedPolygons.map((annotation) => annotation.label)).size > 1) { showToast("Para unir, selecione polígonos da mesma classe."); return; }
    const result = unionPolygons(selectedPolygons.map((annotation) => annotation.pts ?? []));
    if (!result.length) { showToast("Não foi possível unir estas geometrias."); return; }
    remember();
    const source = selectedPolygons[0];
    const mergeId = makeId("merge");
    const created = result.map((points, index) => ({ ...source, id: `${mergeId}-${index}`, pts: points }));
    setAnnotations((items) => [...items.filter((item) => !multiSelected.includes(item.id)), ...created]);
    setSelected(created[0].id); setMultiSelected(created.map((item) => item.id)); showToast("Polígonos unidos.");
  }

  function files(list: FileList | null) {
    const uploadId = makeId("upload");
    const incoming = Array.from(list ?? []).filter((file) => file.type.startsWith("image/")).map((file, index) => ({ id: `${uploadId}-${index}`, name: file.name, src: URL.createObjectURL(file), local: true }));
    if (!incoming.length) return; setAssets((items) => [...incoming, ...items]); setCurrent(incoming[0].id); setLeftOpen(false);
  }

  function addClass() {
    if (!newLabel.trim()) return; const id = makeId("label");
    setLabels((items) => [...items, { id, name: newLabel.trim(), color: colors[items.length % colors.length], key: String(Math.min(items.length + 1, 9)) }]);
    setActiveLabel(id); setNewLabel(""); setAddingLabel(false);
  }

  async function exportData(kind: "coco" | "yolo" | "project") {
    setExporting(true);
    try {
      if (kind === "coco") exportCoco(assets, labels, annotations);
      if (kind === "yolo") await exportYoloZip(assets, labels, annotations);
      if (kind === "project") exportProject(assets, labels, annotations);
      setExportOpen(false); showToast(kind === "yolo" ? "Pacote YOLO gerado e download iniciado." : "Arquivo gerado e download iniciado.");
    } catch { showToast("Não foi possível gerar a exportação."); }
    finally { setExporting(false); }
  }

  function openSamSettings() { setSamEndpointDraft(samEndpoint || "http://127.0.0.1:7860/predict"); setSamOpen(true); }
  async function connectSam() {
    const endpoint = samEndpointDraft.trim();
    try {
      const url = new URL(endpoint);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        showToast("Use um endereço local: localhost ou 127.0.0.1."); return;
      }
      const healthUrl = `${url.origin}${url.pathname.replace(/\/predict\/?$/, "")}/health`;
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(6_000) });
      if (!response.ok) throw new Error();
    } catch {
      showToast("O conector local não respondeu. Inicie o arquivo Python e tente novamente."); return;
    }
    setSamEndpoint(endpoint); localStorage.setItem("visionlabel-sam-endpoint", endpoint);
    setSamOpen(false); setTool("sam"); showToast("SAM local conectado. Clique sobre o objeto na imagem.");
  }
  function activateSam() { if (!samEndpoint) { openSamSettings(); return; } setTool("sam"); }
  function acceptSamMask() {
    if (samPreview.length < 6) return;
    remember(); const id = makeId("sam");
    setAnnotations((items) => [...items, { id, asset: current, label: activeLabel, type: "polygon", pts: samPreview }]);
    setSelected(id); setMultiSelected([id]); setSelectedVertex(null); clearSam(); showToast("Máscara adicionada. O SAM continua ativo.");
  }
  function clearSam() { setSamPrompts([]); setSamPreview([]); }
  function chooseImage(id: string) { setCurrent(id); setSelected(null); setMultiSelected([]); setSelectedVertex(null); resetDrafts(); setLeftOpen(false); }
  function go(direction: number) { const index = assets.findIndex((item) => item.id === current); chooseImage(assets[Math.max(0, Math.min(assets.length - 1, index + direction))].id); }

  return <main className="shell">
    <header className="topbar">
      <div className="brand-side"><button className="mobile" onClick={() => setLeftOpen(true)} aria-label="Abrir imagens"><Menu size={19} /></button><div className="mark"><Pentagon size={19} /></div><b className="brand">vision<span>label</span></b><i /><button className="project"><em />Ervas daninhas — Talhão 07 <ChevronDown size={14} /></button></div>
      <div className="head-actions"><span className={`save ${saved ? "done" : ""}`}><Cloud size={14} />{saved ? "Salvo neste dispositivo" : "Salvando…"}</span><button className={`sam-connection ${samEndpoint ? "connected" : ""}`} onClick={openSamSettings}><Link2 size={14} />{samEndpoint ? "SAM local ativo" : "Ativar SAM local"}</button><div className="export"><button className="export-main" disabled={exporting} onClick={() => setExportOpen(!exportOpen)}>{exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Exportar <ChevronDown size={13} /></button>{exportOpen && <div className="export-pop"><p>Formato de exportação</p><button onClick={() => void exportData("coco")}><b>COCO JSON</b><span>caixas, polígonos e pontos-chave</span></button><button onClick={() => void exportData("yolo")}><b>YOLO ZIP</b><span>um label por imagem + data.yaml</span></button><button onClick={() => void exportData("project")}><b>Projeto VisionLabel</b><span>backup editável</span></button></div>}</div><button className="avatar">EA</button><button className="mobile" onClick={() => setRightOpen(true)} aria-label="Abrir classes"><MoreHorizontal size={19} /></button></div>
    </header>

    <div className="workspace">
      <aside className={`assets ${leftOpen ? "open" : ""}`}>
        <div className="drawer-head"><b>Imagens</b><button onClick={() => setLeftOpen(false)}><X size={19} /></button></div>
        <div className="aside-title"><span>IMAGENS <b>{assets.length}</b></span><button onClick={() => input.current?.click()}><Plus size={16} /></button></div>
        <input hidden ref={input} type="file" accept="image/*" multiple onChange={(event) => files(event.target.files)} />
        <button className="import" onClick={() => input.current?.click()}><ImagePlus size={16} /> Importar imagens</button>
        <label className="search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar imagem…" /></label>
        <div className="progress"><div><span>Progresso</span><b>{completed} de {assets.length}</b></div><i><em style={{ width: `${completed / assets.length * 100}%` }} /></i></div>
        <div className="asset-list">{assets.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).map((item, index) => { const count = annotations.filter((annotation) => annotation.asset === item.id).length; return <button key={item.id} className={current === item.id ? "active" : ""} onClick={() => chooseImage(item.id)}><div className="thumb" style={{ backgroundImage: `url(${item.src})` }}><span>{String(index + 1).padStart(2, "0")}</span>{count > 0 && <b>{count}</b>}</div><div><strong>{item.name}</strong><small>{item.width && item.height ? `${item.width} × ${item.height}` : "Imagem local"}</small></div><i className={count ? "checked" : ""}>{count ? "✓" : ""}</i></button>; })}</div>
        <div className="privacy"><Cloud size={14} /> Suas imagens ficam no navegador.</div>
      </aside>

      <section className="editor">
        <div className="tools">
          <div><ToolButton title="Selecionar e mover (V)" keyHint="V" active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 size={18} /></ToolButton><ToolButton title="Mover canvas (H)" keyHint="H" active={tool === "pan"} onClick={() => setTool("pan")}><Hand size={18} /></ToolButton></div><i />
          <div><ToolButton title="Caixa (B)" keyHint="B" active={tool === "box"} onClick={() => setTool("box")}><Box size={18} /></ToolButton><ToolButton title="Polígono por pontos (P)" keyHint="P" active={tool === "polygon"} onClick={() => setTool("polygon")}><Pentagon size={18} /></ToolButton><ToolButton title="Polígono à mão livre (F)" keyHint="F" active={tool === "freehand"} onClick={() => setTool("freehand")}><PenLine size={18} /></ToolButton><ToolButton title="Ponto-chave (K)" keyHint="K" active={tool === "point"} onClick={() => setTool("point")}><span className="point-icon" /></ToolButton><ToolButton title="Segmentar com SAM (S)" keyHint="S" active={tool === "sam"} onClick={activateSam}><WandSparkles size={18} /></ToolButton></div><i />
          <div className="edit-tools"><ToolButton title="Simplificar polígono" disabled={activeAnnotation?.type !== "polygon"} onClick={simplifySelected}><ListRestart size={18} /></ToolButton><ToolButton title="Duplicar polígono" disabled={activeAnnotation?.type !== "polygon"} onClick={duplicateSelected}><Copy size={17} /></ToolButton><ToolButton title="Unir polígonos selecionados" disabled={selectedPolygons.length < 2} onClick={mergeSelected}><Combine size={18} /></ToolButton><ToolButton title="Cortar polígono com linha" disabled={activeAnnotation?.type !== "polygon"} active={tool === "split"} onClick={() => setTool("split")}><Scissors size={17} /></ToolButton><ToolButton title="Rotacionar e redimensionar (T)" keyHint="T" disabled={activeAnnotation?.type !== "polygon"} active={tool === "transform"} onClick={() => setTool("transform")}><Maximize2 size={17} /></ToolButton><ToolButton title="Remodelar borda à mão livre (R)" keyHint="R" disabled={activeAnnotation?.type !== "polygon"} active={tool === "reshape"} onClick={() => setTool("reshape")}><PenTool size={17} /></ToolButton><ToolButton title={snapping ? "Encaixe em vértices e arestas ativo" : "Ativar encaixe em vértices e arestas"} active={snapping} onClick={() => { setSnapping((value) => !value); setSnapGuide(null); }}><Magnet size={17} /></ToolButton></div><i />
          <div><ToolButton title="Desfazer" disabled={!history.length} onClick={undo}><Undo2 size={18} /></ToolButton><ToolButton title="Refazer" disabled><Redo2 size={18} /></ToolButton><ToolButton title={selectedVertex ? "Excluir nó e avançar na sequência" : polygonDraft.length ? "Remover último ponto criado" : "Excluir forma inteira"} disabled={!selected && !polygonDraft.length} onClick={deleteSelection}><Trash2 size={18} /></ToolButton></div><span className="spacer" />
          <div className="zoom"><button onClick={() => setZoom((value) => Math.max(30, value - 10))}><ZoomOut size={15} /></button><span>{zoom}%</span><button onClick={() => setZoom((value) => Math.min(400, value + 10))}><ZoomIn size={15} /></button></div><ToolButton title="Redefinir zoom" onClick={() => setZoom(92)}><RotateCcw size={16} /></ToolButton>
        </div>

        <div className={`stage ${tool}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); files(event.dataTransfer.files); }}><div className="scroll" ref={scrollRef} onWheel={zoomWithWheel}><div className="canvas" style={{ width: `${zoom}%`, aspectRatio: `${asset.width ?? 1000}/${asset.height ?? 650}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img crossOrigin="anonymous" src={asset.src} alt={`Imagem para anotação: ${asset.name}`} draggable={false} onLoad={(event) => { const image = event.currentTarget; if (asset.width !== image.naturalWidth || asset.height !== image.naturalHeight) setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, width: image.naturalWidth, height: image.naturalHeight } : item)); }} />
          <svg ref={svgRef} viewBox="0 0 1000 650" preserveAspectRatio="none" onPointerDown={canvasPointerDown} onPointerMove={canvasPointerMove} onPointerUp={canvasPointerUp} onPointerCancel={canvasPointerUp} onContextMenu={finishFreehandWithRightClick} onDoubleClick={() => tool === "polygon" && finishPolygon()}>
            {currentAnnotations.map((annotation) => {
              const label = getLabel(annotation.label);
              const isSelected = multiSelected.includes(annotation.id);
              if (annotation.type === "box") return <g key={annotation.id} onPointerDown={(event) => selectAnnotation(event, annotation)}><rect x={annotation.x} y={annotation.y} width={annotation.w} height={annotation.h} fill={`${label.color}28`} stroke={label.color} strokeWidth={isSelected ? 5 : 3} /><g transform={`translate(${annotation.x},${(annotation.y ?? 0) - 31})`}><rect width={Math.max(100, label.name.length * 10 + 25)} height="31" rx="5" fill={label.color} /><text x="12" y="21" fontSize="16" fontWeight="700" fill="#112018">{label.name}</text></g></g>;
              if (annotation.type === "polygon") return <g key={annotation.id}><polygon className={isSelected && tool === "select" ? "movable-polygon" : ""} onPointerDown={(event) => beginPolygonDrag(event, annotation)} points={pointsToSvg(annotation.pts)} fill={`${label.color}30`} stroke={label.color} strokeWidth={isSelected ? 5 : 3} />{tool === "select" && isSelected && annotation.id === selected && edgeMidpoints(annotation.pts ?? []).map((midpoint) => <circle className="edge-handle" onPointerDown={(event) => insertVertex(event, annotation, midpoint.edgeIndex, midpoint.x, midpoint.y)} onPointerMove={moveVertexPointer} onPointerUp={finishVertexPointer} onPointerCancel={finishVertexPointer} key={`edge-${midpoint.edgeIndex}`} cx={midpoint.x} cy={midpoint.y} r="2.75" />)}{tool === "select" && isSelected && annotation.id === selected && (annotation.pts ?? []).map((coordinate, index, points) => index % 2 === 0 ? <circle className={`vertex-handle ${selectedVertex?.annotationId === annotation.id && selectedVertex.vertexIndex === index / 2 ? "selected" : ""}`} onPointerDown={(event) => beginVertexDrag(event, annotation, index / 2)} onPointerMove={moveVertexPointer} onPointerUp={finishVertexPointer} onPointerCancel={finishVertexPointer} key={index} cx={coordinate} cy={points[index + 1]} r="8" fill="#fff" stroke={label.color} strokeWidth="4" /> : null)}</g>;
              return <g key={annotation.id} onPointerDown={(event) => selectAnnotation(event, annotation)}><circle cx={annotation.x} cy={annotation.y} r={isSelected ? 17 : 13} fill="#fff" stroke={label.color} strokeWidth="6" /><circle cx={annotation.x} cy={annotation.y} r="4" fill={label.color} /></g>;
            })}
            {tool === "transform" && activeAnnotation?.type === "polygon" && activePolygonBounds && activePolygonCenter && <g className="transform-overlay">
              <rect x={activePolygonBounds.x} y={activePolygonBounds.y} width={activePolygonBounds.width} height={activePolygonBounds.height} />
              <line x1={activePolygonCenter.x} y1={transformRotationAnchorY} x2={activePolygonCenter.x} y2={transformRotationY} />
              <circle className="transform-handle rotate-handle" cx={activePolygonCenter.x} cy={transformRotationY} r="10" onPointerDown={(event) => beginTransform(event, activeAnnotation, "rotate")} onPointerMove={moveTransformPointer} onPointerUp={finishTransformPointer} onPointerCancel={finishTransformPointer} />
              <circle className="transform-handle scale-handle" cx={activePolygonBounds.x + activePolygonBounds.width} cy={activePolygonBounds.y + activePolygonBounds.height} r="10" onPointerDown={(event) => beginTransform(event, activeAnnotation, "scale")} onPointerMove={moveTransformPointer} onPointerUp={finishTransformPointer} onPointerCancel={finishTransformPointer} />
              <circle className="transform-center" cx={activePolygonCenter.x} cy={activePolygonCenter.y} r="5" />
            </g>}
            {draft && <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} fill={`${getLabel(activeLabel).color}25`} stroke={getLabel(activeLabel).color} strokeWidth="3" strokeDasharray="9 7" />}
            {polygonDraft.length > 1 && <g><polyline points={pointsToSvg(polygonDraft)} fill={`${getLabel(activeLabel).color}20`} stroke={getLabel(activeLabel).color} strokeWidth="3" strokeDasharray="9 7" />{polygonDraft.map((coordinate, index, points) => index % 2 === 0 ? <circle key={index} cx={coordinate} cy={points[index + 1]} r="6" fill={getLabel(activeLabel).color} stroke="#fff" strokeWidth="2" /> : null)}</g>}
            {freehandDraft.length > 1 && <polyline className="freehand-line" points={pointsToSvg(freehandDraft)} fill={`${getLabel(activeLabel).color}22`} stroke={getLabel(activeLabel).color} strokeWidth="4" />}
            {reshapeDraft.length > 1 && <g><polyline className="reshape-line" points={pointsToSvg(reshapeDraft)} />{reshapeDraft.length >= 4 && <><circle className="reshape-endpoint" cx={reshapeDraft[0]} cy={reshapeDraft[1]} r="7" /><circle className="reshape-endpoint" cx={reshapeDraft.at(-2)} cy={reshapeDraft.at(-1)} r="7" /></>}</g>}
            {splitStart && splitEnd && <line className="split-line" x1={splitStart.x} y1={splitStart.y} x2={splitEnd.x} y2={splitEnd.y} />}
            {snapGuide && <g className="snap-guide"><circle cx={snapGuide.x} cy={snapGuide.y} r="12" /><line x1={snapGuide.x - 7} y1={snapGuide.y} x2={snapGuide.x + 7} y2={snapGuide.y} /><line x1={snapGuide.x} y1={snapGuide.y - 7} x2={snapGuide.x} y2={snapGuide.y + 7} /></g>}
            {samPreview.length >= 6 && <polygon className="sam-mask-preview" points={pointsToSvg(samPreview)} fill={`${getLabel(activeLabel).color}52`} stroke={getLabel(activeLabel).color} strokeWidth="4" strokeDasharray="10 6" />}
            {samPrompts.map((prompt, index) => <g key={index} className={`sam-prompt ${prompt.label ? "positive" : "negative"}`}><circle cx={prompt.x} cy={prompt.y} r="13" /><line x1={prompt.x - 6} y1={prompt.y} x2={prompt.x + 6} y2={prompt.y} />{prompt.label === 1 && <line x1={prompt.x} y1={prompt.y - 6} x2={prompt.x} y2={prompt.y + 6} />}</g>)}
          </svg>
          {tool === "polygon" && polygonDraft.length > 0 && <div className="tip"><kbd>Enter</kbd> concluir · <kbd>Esc</kbd> cancelar</div>}
          {tool === "freehand" && <div className="tip">{freehandDrawing ? <>Mova o mouse pelo contorno · <kbd>botão direito</kbd> fecha o polígono</> : <><kbd>clique esquerdo</kbd> inicia sem precisar manter pressionado</>}</div>}
          {tool === "split" && <div className="tip">Arraste uma linha de uma borda à outra do polígono</div>}
          {tool === "transform" && <div className="tip">Arraste o círculo superior para girar · arraste o canto para redimensionar</div>}
          {tool === "reshape" && <div className="tip">{reshapeDrawing ? <>Contorne a nova borda · <kbd>botão direito</kbd> aplica</> : <>Comece sobre uma borda e termine sobre outra, sem manter o clique</>}</div>}
          {activeAnnotation?.type === "polygon" && tool === "select" && <div className="polygon-tip">Roda do mouse amplia · nó + Delete remove em sequência · corpo + Delete apaga tudo</div>}
          {tool === "sam" && <div className="sam-controls"><div><button className={samPromptMode === 1 ? "active positive" : ""} onClick={() => setSamPromptMode(1)}><CirclePlus size={15} /> Incluir</button><button className={samPromptMode === 0 ? "active negative" : ""} onClick={() => setSamPromptMode(0)}><CircleMinus size={15} /> Excluir</button></div><span>{samLoading ? <><LoaderCircle className="spin" size={14} /> Segmentando…</> : `${samPrompts.length} ponto${samPrompts.length === 1 ? "" : "s"}`}</span><div><button disabled={!samPrompts.length || samLoading} onClick={clearSam}>Limpar</button><button className="accept" disabled={samPreview.length < 6 || samLoading} onClick={acceptSamMask}><Check size={14} /> Aceitar máscara</button><button aria-label="Configurar SAM" onClick={openSamSettings}><Settings2 size={15} /></button></div></div>}
        </div></div></div>
        <div className="status"><div><button onClick={() => go(-1)} disabled={assets[0].id === current}><ChevronLeft size={16} /></button><span><b>{assets.findIndex((item) => item.id === current) + 1}</b> / {assets.length}</span><button onClick={() => go(1)} disabled={assets.at(-1)?.id === current}><ChevronRight size={16} /></button></div><p><Sparkles size={14} />{transformDrag ? "Transformando polígono…" : reshapeDrawing ? "Remodelando borda…" : selectedVertex ? `Nó selecionado — encaixe ${snapping ? "ativo" : "inativo"}` : polygonDraft.length ? `${polygonDraft.length / 2} ponto(s) — Delete desfaz na ordem de criação` : multiSelected.length > 1 ? `${multiSelected.length} polígonos selecionados` : currentAnnotations.length ? `${currentAnnotations.length} anotações nesta imagem` : "Pronta para anotar"}</p><button><Keyboard size={15} /> Atalhos</button></div>
      </section>

      <aside className={`labels ${rightOpen ? "open" : ""}`}>
        <div className="drawer-head"><b>Classes e qualidade</b><button onClick={() => setRightOpen(false)}><X size={19} /></button></div>
        <div className="tabs"><button className={!quality ? "active" : ""} onClick={() => setQuality(false)}>Classes</button><button className={quality ? "active" : ""} onClick={() => setQuality(true)}>Qualidade <b>{currentAnnotations.length ? 1 : 0}</b></button></div>
        {!quality ? <><div className="label-help"><b>CLASSE ATIVA</b><span>Novas formas usarão esta classe.</span></div><div className="label-list">{labels.map((label) => <button key={label.id} className={activeLabel === label.id ? "active" : ""} onClick={() => setActiveLabel(label.id)}><i style={{ background: label.color }} /><span>{label.name}</span><em>{currentAnnotations.filter((annotation) => annotation.label === label.id).length}</em><kbd>{label.key}</kbd><Eye size={14} /></button>)}</div>
          {addingLabel ? <div className="new-class"><input autoFocus placeholder="Nome da classe" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addClass()} /><button onClick={addClass}>Adicionar</button><button onClick={() => setAddingLabel(false)}>Cancelar</button></div> : <button className="add-class" onClick={() => setAddingLabel(true)}><Plus size={15} /> Nova classe</button>}
          <div className="instances"><div><b>ANOTAÇÕES · {currentAnnotations.length}</b><MoreHorizontal size={16} /></div>{currentAnnotations.map((annotation, index) => { const label = getLabel(annotation.label); return <button key={annotation.id} className={multiSelected.includes(annotation.id) ? "active" : ""} onClick={(event) => { if (event.shiftKey && annotation.type === "polygon") toggleMultiSelection(annotation.id); else { setSelected(annotation.id); setMultiSelected([annotation.id]); } setSelectedVertex(null); setTool("select"); }}><i style={{ borderColor: label.color }}>{annotation.type === "point" ? "•" : ""}</i><span>{label.name} <small>#{index + 1}</small></span><Eye size={14} /></button>; })}</div>
        </> : <div className="quality"><div className="score"><strong>92<small>/100</small></strong><span>Boa consistência</span></div><article className="warn"><b>!</b><div><strong>1 possível sobreposição</strong><p>Revise “cultura #2” perto da borda direita.</p></div></article><article><b>✓</b><div><strong>Classes válidas</strong><p>Todas as formas possuem uma classe.</p></div></article><article><b>✓</b><div><strong>Sem formas vazias</strong><p>Nenhuma área inválida foi detectada.</p></div></article><button onClick={() => { setQuality(false); setSelected(currentAnnotations[0]?.id ?? null); setMultiSelected(currentAnnotations[0] ? [currentAnnotations[0].id] : []); }}>Revisar apontamento</button></div>}
        <div className="hint"><b>{activeAnnotation?.type === "polygon" ? "Edição vetorial estilo QGIS" : "Dica rápida"}</b><p>{activeAnnotation?.type === "polygon" ? "Mova e encaixe vértices, remodele bordas, transforme, simplifique, una ou corte pela barra superior." : "Use B, P, F, K e S para anotar sem tirar a mão do teclado."}</p></div>
      </aside>
    </div>

    {samOpen && <div className="modal-backdrop"><section className="sam-modal sam-local-modal" role="dialog" aria-modal="true" aria-labelledby="sam-title"><header><div><span><WandSparkles size={18} /></span><div><h2 id="sam-title">SAM local, sem token</h2><p>O modelo e as imagens permanecem no seu computador.</p></div></div><button onClick={() => setSamOpen(false)} aria-label="Fechar"><X size={19} /></button></header><div className="hardware-warning"><b>Antes de rodar</b><p><strong>Recomendado — ViT-B:</strong> GPU NVIDIA com 6 GB de VRAM (8 GB ideal) ou CPU com 4+ núcleos e 16 GB de RAM. Em CPU funciona, mas o carregamento da imagem pode levar dezenas de segundos.</p><p><strong>ViT-L / ViT-H:</strong> prefira 12–16 GB de VRAM e 32 GB de RAM. São checkpoints maiores e mais lentos.</p></div><div className="sam-setup"><b>Configuração rápida</b><ol><li><a href="https://github.com/facebookresearch/segment-anything#model-checkpoints" target="_blank" rel="noreferrer"><Download size={13} /> Abrir página oficial dos checkpoints</a><small>Escolha <strong>ViT-B</strong> na seção Model Checkpoints.</small></li><li><a href="/visionlabel-sam-local.py" download><Download size={13} /> Baixar conector local</a></li><li>Instale as dependências e execute o conector apontando para o <code>.pth</code>.</li></ol><pre>pip install torch torchvision fastapi uvicorn pillow opencv-python</pre><pre>pip install git+https://github.com/facebookresearch/segment-anything.git</pre><pre>python visionlabel-sam-local.py --checkpoint sam_vit_b_01ec64.pth --model-type vit_b</pre></div><label>Endereço local<input autoFocus type="url" placeholder="http://127.0.0.1:7860/predict" value={samEndpointDraft} onChange={(event) => setSamEndpointDraft(event.target.value)} /></label><div className="sam-contract"><b>Sem upload e sem credenciais</b><p>O Site conversa apenas com o conector em <code>localhost</code>. Seu navegador poderá pedir permissão para acessar a rede local. Nenhum token é usado ou armazenado.</p></div><footer><button onClick={() => setSamOpen(false)}>Cancelar</button><button className="connect" onClick={() => void connectSam()}><Link2 size={15} /> Verificar e usar</button></footer></section></div>}
    {(leftOpen || rightOpen) && <button className="backdrop" onClick={() => { setLeftOpen(false); setRightOpen(false); }} aria-label="Fechar painel" />}
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
  </main>;
}
