"use client";

import {
  Box, Check, ChevronDown, ChevronLeft, ChevronRight, CircleMinus, CirclePlus,
  Combine, Copy, Download, Eye, EyeOff, FileText, FolderOpen, FolderUp, Hand, HardDriveDownload, ImagePlus, Images, Keyboard, Languages, Link2,
  Focus, ListRestart, LoaderCircle, Magnet, Maximize2, Menu, MoreHorizontal, MousePointer2, PenLine, Save, ShieldCheck,
  Monitor, Moon, Palette, Pencil, Pentagon, Plus, Redo2, Scissors, Search, Settings2, Sparkles,
  Sun, Tags, Trash2, Undo2, WandSparkles, X, ZoomIn, ZoomOut, PenTool,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SamSetupModal from "./components/SamSetupModal";
import {
  annotationIntersectsRect, boundedAnnotationDelta, deletePolygonVertex, edgeMidpoints,
  insertPolygonVertex, movePolygon, MIN_VERTEX_DISTANCE, pointInPolygon, pointsToSvg,
  polygonBounds, polygonCenter, reshapePolygon, simplifyPolygon, snapPointToPolygons,
  splitPolygon, transformPolygon, translateAnnotation, unionPolygons, updatePolygonVertex,
} from "./lib/geometry";
import { exportCoco, exportYoloZip } from "./lib/exporters";
import { getCopy } from "./lib/i18n";
import { openVisionLabelProject, saveVisionLabelProject } from "./lib/project";
import type { ProjectSaveMode } from "./lib/project";
import { requestSamPredictions } from "./lib/sam";
import { DEFAULT_SAM_MODEL_ID, getSamModel, isSamModelId } from "./lib/sam-models";
import type { SamModelId } from "./lib/sam-models";
import type { Language, ThemeMode } from "./lib/i18n";
import type { Annotation, Asset, Label, SamBoxPrompt, SamMaskPrediction, SamPrompt, Tool } from "./lib/types";

const UNLABELED_ID = "unlabeled";
const UNLABELED_COLOR = "#929a95";
const unlabeledLabel = (name = "Sem label"): Label => ({ id: UNLABELED_ID, name, color: UNLABELED_COLOR, key: "" });

const colors = ["#6c8cff", "#d987ff", "#26c6b6", "#ff8a65"];

type AnnotationDrag = { startX: number; startY: number; originals: Annotation[] };
type VertexDrag = { annotationId: string; vertexIndex: number };
type SelectionMarquee = {
  startX: number; startY: number; currentX: number; currentY: number; additiveIds: string[];
};
type TransformDrag = {
  annotationId: string;
  kind: "scale" | "rotate";
  center: { x: number; y: number };
  startAngle: number;
  startDistance: number;
  points: number[];
};
type SamInteractionMode = "points" | "box" | "text";
type SamConnectionState = "idle" | "checking" | "loading" | "ready" | "error" | "offline";
type SamRunOptions = {
  prompts?: SamPrompt[];
  box?: SamBoxPrompt | null;
  text?: string;
  multimaskOutput?: boolean;
};

function ToolButton({ title, active, disabled, onClick, children, keyHint }: { title: string; active?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode; keyHint?: string }) {
  return <button className={`tool-btn ${active ? "active" : ""}`} aria-label={title} title={title} disabled={disabled} onClick={onClick}>{children}{keyHint && <small>{keyHint}</small>}</button>;
}

function polygonHandleRadius(vertexCount: number, zoomScale: number) {
  return Math.max(2.4, Math.min(5.2, 25 / Math.sqrt(Math.max(1, vertexCount)))) * zoomScale;
}

function formatBytes(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function randomIdPart() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [current, setCurrent] = useState("");
  const [labels, setLabels] = useState<Label[]>(() => [unlabeledLabel()]);
  const [activeLabel, setActiveLabel] = useState(UNLABELED_ID);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [hiddenAnnotations, setHiddenAnnotations] = useState<string[]>([]);
  const [hiddenLabels, setHiddenLabels] = useState<string[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<{ annotationId: string; vertexIndex: number } | null>(null);
  const [annotationDrag, setAnnotationDrag] = useState<AnnotationDrag | null>(null);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee | null>(null);
  const [vertexDrag, setVertexDrag] = useState<VertexDrag | null>(null);
  const [transformDrag, setTransformDrag] = useState<TransformDrag | null>(null);
  const [reshapeDraft, setReshapeDraft] = useState<number[]>([]);
  const [reshapeDrawing, setReshapeDrawing] = useState(false);
  const [reshapeStartInside, setReshapeStartInside] = useState<boolean | null>(null);
  const [snapping, setSnapping] = useState(true);
  const [snapGuide, setSnapGuide] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(92);
  const [lineThickness, setLineThickness] = useState(() => {
    if (typeof window === "undefined") return 3;
    const stored = Number(localStorage.getItem("visionlabel-line-thickness"));
    return Number.isFinite(stored) && stored >= 1 && stored <= 10 ? stored : 3;
  });
  const [search, setSearch] = useState("");
  const [quality, setQuality] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectSaveOpen, setProjectSaveOpen] = useState(false);
  const [projectSaveMode, setProjectSaveMode] = useState<ProjectSaveMode>("complete");
  const [saved, setSaved] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newLabelColor, setNewLabelColor] = useState(colors[0]);
  const [batchLabel, setBatchLabel] = useState(UNLABELED_ID);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectEditing, setProjectEditing] = useState(false);
  const [projectName, setProjectName] = useState("Novo projeto");
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [classManagerOpen, setClassManagerOpen] = useState(false);
  const [preferencesTab, setPreferencesTab] = useState<"appearance" | "language">("appearance");
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window === "undefined") return "pt";
    const stored = localStorage.getItem("visionlabel-language");
    return stored === "en" || stored === "fr" || stored === "es" ? stored : "pt";
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const stored = localStorage.getItem("visionlabel-theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  });
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [panStart, setPanStart] = useState<{ x: number; y: number; left: number; top: number } | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [polygonDraft, setPolygonDraft] = useState<number[]>([]);
  const [freehandDraft, setFreehandDraft] = useState<number[]>([]);
  const [freehandDrawing, setFreehandDrawing] = useState(false);
  const [splitStart, setSplitStart] = useState<{ x: number; y: number } | null>(null);
  const [splitEnd, setSplitEnd] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [pendingDeleteClassIds, setPendingDeleteClassIds] = useState<string[]>([]);
  const [pendingDeleteAnnotationIds, setPendingDeleteAnnotationIds] = useState<string[]>([]);
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
  const [samConnectionState, setSamConnectionState] = useState<SamConnectionState>("idle");
  const [samRuntime, setSamRuntime] = useState("");
  const [samLoadedModelId, setSamLoadedModelId] = useState<string | null>(null);
  const [samModelId, setSamModelId] = useState<SamModelId>(() => {
    if (typeof window === "undefined") return DEFAULT_SAM_MODEL_ID;
    const stored = localStorage.getItem("visionlabel-sam-model");
    return isSamModelId(stored) ? stored : DEFAULT_SAM_MODEL_ID;
  });
  const [samPromptMode, setSamPromptMode] = useState<0 | 1>(1);
  const [samInteractionMode, setSamInteractionMode] = useState<SamInteractionMode>("points");
  const [samPrompts, setSamPrompts] = useState<SamPrompt[]>([]);
  const [samBoxStart, setSamBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [samBox, setSamBox] = useState<SamBoxPrompt | null>(null);
  const [samText, setSamText] = useState("");
  const [samThreshold, setSamThreshold] = useState(0.5);
  const [samPredictions, setSamPredictions] = useState<SamMaskPrediction[]>([]);
  const [samLoading, setSamLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const openProjectInputRef = useRef<HTMLInputElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const projectSwitcherRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const annotationDragRef = useRef<AnnotationDrag | null>(null);
  const selectionMarqueeRef = useRef<SelectionMarquee | null>(null);
  const vertexDragRef = useRef<VertexDrag | null>(null);
  const transformDragRef = useRef<TransformDrag | null>(null);
  const reshapeTargetRef = useRef<string | null>(null);
  const samRequestRef = useRef(0);
  const samAbortRef = useRef<AbortController | null>(null);
  const samClientIdRef = useRef("");
  const projectObjectUrlsRef = useRef<string[]>([]);
  const idCounter = useRef(0);

  const asset = assets.find((item) => item.id === current) ?? assets[0];
  const currentAnnotations = annotations.filter((annotation) => annotation.asset === current);
  const currentPolygonIds = currentAnnotations.filter((annotation) => annotation.type === "polygon").map((annotation) => annotation.id);
  const allCurrentPolygonsSelected = currentPolygonIds.length > 0 && currentPolygonIds.every((id) => multiSelected.includes(id));
  const visibleAnnotations = currentAnnotations.filter((annotation) =>
    !hiddenAnnotations.includes(annotation.id) && !hiddenLabels.includes(annotation.label),
  );
  const copy = getCopy(language);
  const selectedSamModel = getSamModel(samModelId) ?? getSamModel(DEFAULT_SAM_MODEL_ID)!;
  const samPreviewPolygons = samPredictions.flatMap((prediction) => prediction.polygons);
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
  const handleScale = Math.max(0.25, Math.min(3.34, 100 / zoom));
  const selectedIds = multiSelected.length ? multiSelected : selected ? [selected] : [];
  const resolvedBatchLabel = labels.some((label) => label.id === batchLabel) ? batchLabel : labels[0]?.id ?? "";
  const selectableClasses = labels.filter((label) => label.id !== UNLABELED_ID);
  const pendingDeleteClasses = labels.filter((label) => pendingDeleteClassIds.includes(label.id));
  const pendingAffectedAnnotations = annotations.filter((annotation) => pendingDeleteClassIds.includes(annotation.label)).length;
  const pendingDeleteAnnotations = annotations.filter((annotation) => pendingDeleteAnnotationIds.includes(annotation.id));
  const missingProjectImages = assets.filter((item) => item.missing).length;
  const knownProjectImageBytes = assets.reduce((total, item) => total + (item.byteSize ?? 0), 0);
  const annotationProjectBytes = JSON.stringify({ assets: assets.map((item) => ({ id: item.id, name: item.name, width: item.width, height: item.height })), labels, annotations }).length;
  const selectedPolygons = annotations.filter((annotation) => multiSelected.includes(annotation.id) && annotation.type === "polygon");
  const getLabel = useCallback((id: string) => labels.find((label) => label.id === id) ?? labels[0] ?? unlabeledLabel(copy.unlabeled), [copy.unlabeled, labels]);
  const completed = useMemo(() => new Set(annotations.map((annotation) => annotation.asset)).size, [annotations]);
  const remember = useCallback(() => { setHistory((items) => [...items.slice(-24), annotations]); setSaved(false); }, [annotations]);

  useEffect(() => {
    samClientIdRef.current = `visionlabel-${randomIdPart()}`;
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.lang = language === "pt" ? "pt-BR" : language;
    localStorage.setItem("visionlabel-theme", themeMode);
    localStorage.setItem("visionlabel-language", language);
  }, [language, themeMode]);

  useEffect(() => {
    localStorage.setItem("visionlabel-line-thickness", String(lineThickness));
  }, [lineThickness]);

  useEffect(() => {
    localStorage.setItem("visionlabel-sam-model", samModelId);
  }, [samModelId]);

  useEffect(() => {
    localStorage.removeItem("visionlabel-labels");
    localStorage.removeItem("visionlabel-annotations");
    localStorage.removeItem("visionlabel-project-name");
  }, []);

  useEffect(() => () => {
    projectObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (saved) return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, [saved]);

  useEffect(() => {
    const closeProjectMenu = (event: PointerEvent) => {
      if (!projectSwitcherRef.current?.contains(event.target as Node)) setProjectOpen(false);
    };
    document.addEventListener("pointerdown", closeProjectMenu);
    return () => document.removeEventListener("pointerdown", closeProjectMenu);
  }, []);

  function makeId(prefix: string) {
    idCounter.current += 1;
    return `${prefix}-${randomIdPart()}-${idCounter.current}`;
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
    const ids = multiSelected.length > 1 ? multiSelected : [selected];
    if (ids.length > 1) { setPendingDeleteAnnotationIds(ids); return; }
    remember();
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
    const keydown = (event: KeyboardEvent) => {
      if (samOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setSamOpen(false);
        }
        return;
      }
      if ((event.target as HTMLElement).tagName === "INPUT" && event.key !== "Escape") return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); return; }
      if (event.key === "Enter" && tool === "polygon") finishPolygon();
      if (event.key === "Escape") {
        setProjectOpen(false); setProjectEditing(false); setProjectSaveOpen(false); setClassManagerOpen(false); setSamOpen(false); setSelectedClassIds([]);
        setPolygonDraft([]); setFreehandDraft([]); setFreehandDrawing(false); setDraft(null);
        setSplitStart(null); setSplitEnd(null); setReshapeDraft([]); setReshapeDrawing(false);
        annotationDragRef.current = null; setAnnotationDrag(null);
        selectionMarqueeRef.current = null; setSelectionMarquee(null);
        reshapeTargetRef.current = null; setReshapeStartInside(null);
        transformDragRef.current = null; setTransformDrag(null); setSnapGuide(null);
        samAbortRef.current?.abort(); samRequestRef.current += 1; setSamPrompts([]); setSamBoxStart(null); setSamBox(null); setSamPredictions([]); setSamLoading(false);
        setSelected(null); setMultiSelected([]); setSelectedVertex(null);
      }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); }
      const tools: Record<string, Tool> = { v: "select", h: "pan", b: "box", p: "polygon", f: "freehand", k: "point", s: "sam", t: "transform", r: "reshape" };
      const nextTool = tools[event.key.toLowerCase()];
      if (nextTool) {
        if (nextTool === "sam" && (!samEndpoint || samConnectionState !== "ready" || samLoadedModelId !== samModelId)) {
          setSamEndpointDraft(samEndpoint || "http://127.0.0.1:7860/predict"); setSamOpen(true);
        } else if (nextTool === "sam") {
          samAbortRef.current?.abort(); samRequestRef.current += 1; setSamPrompts([]); setSamBoxStart(null); setSamBox(null); setSamPredictions([]); setSamLoading(false);
          setSamPromptMode(1); setTool(tool === "sam" ? "select" : "sam");
        } else setTool(nextTool);
      }
      const label = labels.find((item) => item.key === event.key);
      if (label) setActiveLabel(label.id);
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [deleteSelection, finishPolygon, labels, samConnectionState, samEndpoint, samLoadedModelId, samModelId, samOpen, tool, undo]);

  function resetDrafts() {
    setPolygonDraft([]); setFreehandDraft([]); setFreehandDrawing(false); setDraft(null);
    setSplitStart(null); setSplitEnd(null); setReshapeDraft([]); setReshapeDrawing(false);
    annotationDragRef.current = null; setAnnotationDrag(null);
    selectionMarqueeRef.current = null; setSelectionMarquee(null);
    reshapeTargetRef.current = null; setReshapeStartInside(null);
    transformDragRef.current = null; setTransformDrag(null); setSnapGuide(null); clearSam();
  }

  function editorPoint(clientX: number, clientY: number) {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return { x: Math.max(0, Math.min(1000, (clientX - bounds.left) / bounds.width * 1000)), y: Math.max(0, Math.min(650, (clientY - bounds.top) / bounds.height * 650)) };
  }

  function zoomWithWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.shiftKey) return;
    event.preventDefault();
    const wheelDelta = event.deltaY || event.deltaX;
    if (!wheelDelta) return;
    const nextZoom = Math.max(10, Math.min(400, zoom + (wheelDelta < 0 ? 10 : -10)));
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

  function fitImageToViewport() {
    const scroller = scrollRef.current;
    if (!scroller) { setZoom(92); return; }
    const imageWidth = asset.width ?? 1000;
    const imageHeight = asset.height ?? 650;
    const widthAtHundred = Math.max(1, scroller.clientWidth);
    const heightAtHundred = widthAtHundred * imageHeight / imageWidth;
    const heightFit = scroller.clientHeight / Math.max(1, heightAtHundred) * 100;
    const nextZoom = Math.max(10, Math.min(100, Math.floor(Math.min(100, heightFit) * 0.96)));
    setZoom(nextZoom);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const currentScroller = scrollRef.current;
      if (!currentScroller) return;
      currentScroller.scrollTo({
        left: Math.max(0, (currentScroller.scrollWidth - currentScroller.clientWidth) / 2),
        top: Math.max(0, (currentScroller.scrollHeight - currentScroller.clientHeight) / 2),
        behavior: "smooth",
      });
    }));
    showToast(copy.imageCentered);
  }

  function capture(pointerId: number) { svgRef.current?.setPointerCapture(pointerId); }

  async function runSam({
    prompts = samPrompts,
    box = samBox,
    text,
    multimaskOutput = false,
  }: SamRunOptions = {}) {
    if (!prompts.length && !box && !text?.trim()) return;
    samAbortRef.current?.abort();
    const controller = new AbortController();
    samAbortRef.current = controller;
    const requestId = ++samRequestRef.current;
    setSamLoading(true);
    try {
      const result = await requestSamPredictions({
        endpoint: samEndpoint,
        asset,
        modelId: samModelId,
        prompts,
        box,
        text,
        threshold: text?.trim() ? samThreshold : undefined,
        multimaskOutput,
        clientId: samClientIdRef.current,
        requestSeq: requestId,
        signal: controller.signal,
      });
      if (requestId === samRequestRef.current) setSamPredictions(result.predictions);
    } catch (error) {
      if (requestId === samRequestRef.current) showToast(error instanceof Error ? error.message : "Falha ao consultar o SAM.");
    } finally {
      if (samAbortRef.current === controller) samAbortRef.current = null;
      if (requestId === samRequestRef.current) setSamLoading(false);
    }
  }

  function canvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button === 1 || (tool === "pan" && event.button === 0)) {
      event.preventDefault();
      const scroller = scrollRef.current;
      if (scroller) {
        setPanStart({ x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop });
        capture(event.pointerId);
      }
      return;
    }
    if (event.button !== 0) return;
    const point = editorPoint(event.clientX, event.clientY);
    if (tool === "select") {
      const marquee: SelectionMarquee = {
        startX: point.x, startY: point.y, currentX: point.x, currentY: point.y,
        additiveIds: event.shiftKey ? [...multiSelected] : [],
      };
      selectionMarqueeRef.current = marquee; setSelectionMarquee(marquee); setSelectedVertex(null); capture(event.pointerId); return;
    }
    if (tool === "box") { setStart(point); setDraft({ ...point, w: 0, h: 0 }); capture(event.pointerId); }
    if (tool === "polygon") {
      const closeToFirst = polygonDraft.length >= 6 &&
        Math.hypot(point.x - polygonDraft[0], point.y - polygonDraft[1]) <= 16;
      if (closeToFirst) finishPolygon();
      else setPolygonDraft((points) => [...points, point.x, point.y]);
    }
    if (tool === "freehand" && !freehandDrawing) { setFreehandDraft([point.x, point.y]); setFreehandDrawing(true); }
    if (tool === "reshape" && activeAnnotation?.type === "polygon") {
      if (reshapeDrawing) finishReshape(point);
      else beginReshape(point, activeAnnotation.id);
    }
    if (tool === "point") {
      remember(); const id = makeId("annotation");
      setAnnotations((items) => [...items, { id, asset: current, label: activeLabel, type: "point", ...point }]);
      setSelected(id); setMultiSelected([id]);
    }
    if (tool === "sam") {
      if (samInteractionMode === "box" && selectedSamModel.capabilities.boxPrompts) {
        const nextBox: SamBoxPrompt = { ...point, w: 0, h: 0, label: 1 };
        setSamBoxStart(point); setSamBox(nextBox); capture(event.pointerId); return;
      }
      if (samInteractionMode === "points" && selectedSamModel.capabilities.pointPrompts) {
        const prompts = [...samPrompts, { ...point, label: samPromptMode }];
        setSamPrompts(prompts); void runSam({ prompts });
      }
    }
    if (tool === "split" && activeAnnotation?.type === "polygon") { setSplitStart(point); setSplitEnd(point); capture(event.pointerId); }
  }

  function canvasPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const point = editorPoint(event.clientX, event.clientY);
    const activeMarquee = selectionMarqueeRef.current;
    if (activeMarquee) {
      const next = { ...activeMarquee, currentX: point.x, currentY: point.y };
      selectionMarqueeRef.current = next; setSelectionMarquee(next); return;
    }
    const activeVertexDrag = vertexDragRef.current ?? vertexDrag;
    if (activeVertexDrag) {
      const target = snapping
        ? snapPointToPolygons(point, visibleAnnotations, activeVertexDrag.annotationId)
        : { ...point, snapped: false };
      setSnapGuide(target.snapped ? { x: target.x, y: target.y } : null);
      setAnnotations((items) => items.map((annotation) => annotation.id === activeVertexDrag.annotationId ? { ...annotation, pts: updatePolygonVertex(annotation.pts ?? [], activeVertexDrag.vertexIndex, target.x, target.y) } : annotation)); setSaved(false); return;
    }
    if (panStart && scrollRef.current) {
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
    if (tool === "sam" && samInteractionMode === "box" && samBoxStart) {
      setSamBox({
        x: Math.min(samBoxStart.x, point.x),
        y: Math.min(samBoxStart.y, point.y),
        w: Math.abs(point.x - samBoxStart.x),
        h: Math.abs(point.y - samBoxStart.y),
        label: 1,
      });
      return;
    }
    if (!start || tool !== "box") return;
    setDraft({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), w: Math.abs(point.x - start.x), h: Math.abs(point.y - start.y) });
  }

  function canvasPointerUp() {
    if (panStart) { setPanStart(null); return; }
    if (selectionMarqueeRef.current) { finishSelectionMarquee(); return; }
    if (vertexDragRef.current || vertexDrag) { vertexDragRef.current = null; setVertexDrag(null); setSnapGuide(null); return; }
    if (tool === "freehand") return;
    if (tool === "reshape") return;
    if (tool === "split" && splitStart && splitEnd) { finishSplit(); return; }
    if (tool === "sam" && samInteractionMode === "box" && samBoxStart) {
      setSamBoxStart(null);
      if (!samBox || samBox.w < 8 || samBox.h < 8) { setSamBox(null); return; }
      void runSam({ box: samBox, prompts: samPrompts });
      return;
    }
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

  function finishDrawingWithRightClick(event: React.MouseEvent<SVGSVGElement>) {
    event.preventDefault();
    if (tool === "polygon" && polygonDraft.length >= 6) finishPolygon();
    if (tool === "freehand" && freehandDrawing) finishFreehand();
  }

  function beginReshape(point: { x: number; y: number }, annotationId: string) {
    const annotation = annotations.find((item) => item.id === annotationId);
    if (annotation?.type !== "polygon") return;
    reshapeTargetRef.current = annotationId;
    setReshapeDraft([point.x, point.y]); setReshapeDrawing(true);
    setReshapeStartInside(pointInPolygon(point, annotation.pts ?? []));
  }

  function finishReshape(endPoint: { x: number; y: number }) {
    const targetId = reshapeTargetRef.current;
    const annotation = annotations.find((item) => item.id === targetId);
    const path = [...reshapeDraft, endPoint.x, endPoint.y];
    setReshapeDrawing(false); setReshapeDraft([]); setReshapeStartInside(null); reshapeTargetRef.current = null;
    if (annotation?.type !== "polygon" || path.length < 6) return;
    const result = reshapePolygon(annotation.pts ?? [], path);
    if (!result.points) {
      if (result.reason === "mixed") showToast("Operação inválida: comece e termine ambos dentro ou ambos fora do polígono.");
      else if (result.reason === "direction") showToast(result.mode === "add" ? "O traço precisa sair do polígono para adicionar área." : "O traço precisa atravessar o polígono para remover área.");
      else showToast("O traço precisa cruzar a borda do polígono duas vezes.");
      return;
    }
    remember();
    setAnnotations((items) => items.map((item) => item.id === annotation.id ? { ...item, pts: result.points! } : item));
    setSelectedVertex(null);
    showToast(result.mode === "add" ? "Área adicionada ao polígono." : "Área removida do polígono.");
  }

  function finishSelectionMarquee() {
    const marquee = selectionMarqueeRef.current;
    selectionMarqueeRef.current = null; setSelectionMarquee(null);
    if (!marquee) return;
    const rect = {
      x: Math.min(marquee.startX, marquee.currentX),
      y: Math.min(marquee.startY, marquee.currentY),
      width: Math.abs(marquee.currentX - marquee.startX),
      height: Math.abs(marquee.currentY - marquee.startY),
    };
    if (rect.width < 4 && rect.height < 4) {
      const next = marquee.additiveIds;
      setMultiSelected(next); setSelected(next.at(-1) ?? null); syncBatchLabel(next); return;
    }
    const hits = visibleAnnotations.filter((annotation) => annotationIntersectsRect(annotation, rect)).map((annotation) => annotation.id);
    const next = Array.from(new Set([...marquee.additiveIds, ...hits]));
    setMultiSelected(next); setSelected(next.at(-1) ?? null); syncBatchLabel(next);
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

  function beginAnnotationDrag(event: React.PointerEvent<SVGElement>, annotation: Annotation) {
    if (event.button !== 0) return;
    if (tool === "reshape") {
      event.preventDefault(); event.stopPropagation();
      const point = editorPoint(event.clientX, event.clientY);
      if (reshapeDrawing) finishReshape(point);
      else {
        setSelected(annotation.id); setMultiSelected([annotation.id]); setSelectedVertex(null);
        setBatchLabel(annotation.label);
        beginReshape(point, annotation.id);
      }
      return;
    }
    if (tool === "transform") {
      event.preventDefault(); event.stopPropagation();
      setSelected(annotation.id); setMultiSelected([annotation.id]); setSelectedVertex(null);
      setBatchLabel(annotation.label);
      return;
    }
    if (tool !== "select") return;
    event.preventDefault(); event.stopPropagation();
    if (event.shiftKey) { toggleMultiSelection(annotation.id); return; }
    const point = editorPoint(event.clientX, event.clientY);
    const ids = multiSelected.includes(annotation.id) && multiSelected.length > 1 ? multiSelected : [annotation.id];
    const originals = annotations.filter((item) => ids.includes(item.id));
    const drag: AnnotationDrag = { startX: point.x, startY: point.y, originals };
    remember(); setSelected(annotation.id); setMultiSelected(ids); setSelectedVertex(null); syncBatchLabel(ids);
    annotationDragRef.current = drag; setAnnotationDrag(drag);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { capture(event.pointerId); }
  }

  function moveAnnotationPointer(event: React.PointerEvent<SVGElement>) {
    const drag = annotationDragRef.current;
    if (!drag) return;
    event.preventDefault(); event.stopPropagation();
    const point = editorPoint(event.clientX, event.clientY);
    const delta = boundedAnnotationDelta(drag.originals, point.x - drag.startX, point.y - drag.startY);
    const originals = new Map(drag.originals.map((annotation) => [annotation.id, annotation]));
    setAnnotations((items) => items.map((item) => {
      const original = originals.get(item.id);
      return original ? translateAnnotation(original, delta.dx, delta.dy) : item;
    }));
    setSaved(false);
  }

  function finishAnnotationPointer(event: React.PointerEvent<SVGElement>) {
    if (!annotationDragRef.current) return;
    event.preventDefault(); event.stopPropagation();
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    annotationDragRef.current = null; setAnnotationDrag(null);
  }

  function beginTransform(event: React.PointerEvent<SVGCircleElement>, annotation: Annotation, kind: "scale" | "rotate") {
    if (event.button !== 0 || tool !== "transform" || annotation.type !== "polygon") return;
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
    if (event.button !== 0 || tool !== "select") return;
    event.preventDefault(); event.stopPropagation(); remember(); setSelected(annotation.id); setMultiSelected([annotation.id]); setSnapGuide(null);
    const drag = { annotationId: annotation.id, vertexIndex };
    setSelectedVertex(drag); captureVertexPointer(event, drag);
  }

  function insertVertex(event: React.PointerEvent<SVGCircleElement>, annotation: Annotation, edgeIndex: number, x: number, y: number) {
    if (event.button !== 0 || tool !== "select") return;
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

  function syncBatchLabel(ids: string[]) {
    const selectedAnnotations = annotations.filter((annotation) => ids.includes(annotation.id));
    const firstLabel = selectedAnnotations[0]?.label;
    if (firstLabel && selectedAnnotations.every((annotation) => annotation.label === firstLabel)) setBatchLabel(firstLabel);
  }

  function toggleMultiSelection(id: string) {
    const base = selected && !multiSelected.includes(selected) ? [...multiSelected, selected] : multiSelected;
    const next = base.includes(id) ? base.filter((item) => item !== id) : [...base, id];
    setMultiSelected(next); setSelected(next.at(-1) ?? null); syncBatchLabel(next);
    setSelectedVertex(null);
  }

  function toggleAnnotationVisibility(id: string) {
    const annotation = annotations.find((item) => item.id === id);
    if (annotation && hiddenLabels.includes(annotation.label)) {
      setHiddenLabels((items) => items.filter((item) => item !== annotation.label));
      setHiddenAnnotations((items) => items.filter((item) => item !== id));
      return;
    }
    const willHide = !hiddenAnnotations.includes(id);
    setHiddenAnnotations((items) => willHide ? [...items, id] : items.filter((item) => item !== id));
    if (willHide) {
      setMultiSelected((items) => items.filter((item) => item !== id));
      if (selected === id) setSelected(null);
      if (selectedVertex?.annotationId === id) setSelectedVertex(null);
    }
  }

  function toggleLabelVisibility(id: string) {
    const willHide = !hiddenLabels.includes(id);
    setHiddenLabels((items) => willHide ? [...items, id] : items.filter((item) => item !== id));
    if (willHide) {
      const hiddenIds = currentAnnotations.filter((annotation) => annotation.label === id).map((annotation) => annotation.id);
      setMultiSelected((items) => items.filter((item) => !hiddenIds.includes(item)));
      if (selected && hiddenIds.includes(selected)) setSelected(null);
      if (selectedVertex && hiddenIds.includes(selectedVertex.annotationId)) setSelectedVertex(null);
    }
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
    setAnnotations((items) => [...items, {
      ...activeAnnotation,
      id,
      instanceId: activeAnnotation.instanceId ? makeId("instance") : undefined,
      pts: movePolygon(activeAnnotation.pts ?? [], 22, 22),
    }]);
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
    const imageFiles = Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const missingByName = new Map<string, Asset[]>();
    assets.filter((item) => item.missing).forEach((item) => {
      const key = item.name.toLocaleLowerCase();
      missingByName.set(key, [...(missingByName.get(key) ?? []), item]);
    });
    const replacements = new Map<string, Asset>();
    const incoming: Asset[] = [];
    imageFiles.forEach((file, index) => {
      const src = URL.createObjectURL(file);
      projectObjectUrlsRef.current.push(src);
      const candidates = missingByName.get(file.name.toLocaleLowerCase()) ?? [];
      const target = candidates.shift();
      if (target) replacements.set(target.id, { ...target, src, local: true, missing: false, byteSize: file.size });
      else incoming.push({ id: `${uploadId}-${index}`, name: file.name, src, local: true, byteSize: file.size });
    });
    setAssets((items) => [...incoming, ...items.map((item) => replacements.get(item.id) ?? item)]);
    const nextCurrent = replacements.values().next().value?.id ?? incoming[0]?.id;
    if (nextCurrent) setCurrent(nextCurrent);
    setSaved(false); setLeftOpen(false);
    if (replacements.size) showToast(`${replacements.size} ${copy.projectImagesRestored}`);
  }

  function addClass() {
    const name = newLabel.trim();
    if (!name) return;
    const existing = labels.find((label) => label.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      setActiveLabel(existing.id); setBatchLabel(existing.id); setNewLabel("");
      showToast(`${existing.name} já existe e agora é a classe ativa.`);
      requestAnimationFrame(() => labelInputRef.current?.focus());
      return;
    }
    const id = makeId("label");
    const key = Array.from({ length: 9 }, (_, index) => String(index + 1)).find((candidate) => !labels.some((label) => label.key === candidate)) ?? "";
    setLabels((items) => [...items, { id, name, color: newLabelColor, key }]);
    setActiveLabel(id); setBatchLabel(id); setNewLabel(""); setSaved(false);
    setNewLabelColor(colors[(labels.length + 1) % colors.length]);
    showToast(`${name} criada e selecionada.`);
    requestAnimationFrame(() => labelInputRef.current?.focus());
  }

  function requestClassDeletion(classIds: string[]) {
    const validIds = classIds.filter((id, index) => id !== UNLABELED_ID && classIds.indexOf(id) === index && labels.some((label) => label.id === id));
    if (validIds.length) setPendingDeleteClassIds(validIds);
  }

  function toggleAllCurrentPolygons() {
    if (!currentPolygonIds.length) return;
    if (allCurrentPolygonsSelected) {
      setSelected(null); setMultiSelected([]); setSelectedVertex(null); return;
    }
    setSelected(currentPolygonIds[0]); setMultiSelected(currentPolygonIds); setSelectedVertex(null); setTool("select");
    const first = annotations.find((annotation) => annotation.id === currentPolygonIds[0]);
    if (first) setBatchLabel(first.label);
  }

  function deletePendingAnnotations() {
    const ids = pendingDeleteAnnotationIds.filter((id, index) => pendingDeleteAnnotationIds.indexOf(id) === index && annotations.some((annotation) => annotation.id === id));
    if (!ids.length) { setPendingDeleteAnnotationIds([]); return; }
    remember();
    setAnnotations((items) => items.filter((annotation) => !ids.includes(annotation.id)));
    setHiddenAnnotations((items) => items.filter((id) => !ids.includes(id)));
    setSelected(null); setMultiSelected([]); setSelectedVertex(null); setPendingDeleteAnnotationIds([]); setSaved(false);
    showToast(`${ids.length} ${copy.annotationsDeleted}`);
  }

  function deletePendingClasses() {
    const ids = pendingDeleteClassIds.filter((id) => id !== UNLABELED_ID && labels.some((label) => label.id === id));
    if (!ids.length) { setPendingDeleteClassIds([]); return; }
    const deletedIds = new Set(ids);
    const deletedLabels = labels.filter((label) => deletedIds.has(label.id));
    const reassignedCount = annotations.filter((annotation) => deletedIds.has(annotation.label)).length;
    const remainingLabels = labels.filter((item) => !deletedIds.has(item.id));
    const needsUnlabeled = reassignedCount > 0 || remainingLabels.length === 0;
    const fallback = remainingLabels.find((item) => item.id === UNLABELED_ID)
      ?? (needsUnlabeled ? unlabeledLabel(copy.unlabeled) : remainingLabels[0])
      ?? unlabeledLabel(copy.unlabeled);
    if (reassignedCount) remember();
    setLabels(needsUnlabeled && !remainingLabels.some((item) => item.id === UNLABELED_ID)
      ? [...remainingLabels, fallback]
      : remainingLabels);
    if (reassignedCount) {
      setAnnotations((items) => items.map((annotation) => deletedIds.has(annotation.label) ? { ...annotation, label: UNLABELED_ID } : annotation));
      setSaved(false);
    }
    setHiddenLabels((items) => items.filter((id) => !deletedIds.has(id) && (!reassignedCount || id !== UNLABELED_ID)));
    if (deletedIds.has(activeLabel)) setActiveLabel(fallback?.id ?? UNLABELED_ID);
    if (deletedIds.has(batchLabel)) setBatchLabel(fallback?.id ?? UNLABELED_ID);
    setSelectedClassIds((items) => items.filter((id) => !deletedIds.has(id)));
    setPendingDeleteClassIds([]); setSaved(false);
    showToast(reassignedCount
      ? `${deletedLabels.length} classe(s) excluída(s). ${reassignedCount} anotação(ões) foram movidas para ${copy.unlabeled}.`
      : `${deletedLabels.length} classe(s) excluída(s).`);
  }

  function reclassifySelection() {
    if (!selectedIds.length || !resolvedBatchLabel) return;
    const label = labels.find((item) => item.id === resolvedBatchLabel);
    if (!label) return;
    remember();
    setAnnotations((items) => items.map((annotation) => selectedIds.includes(annotation.id) ? { ...annotation, label: resolvedBatchLabel } : annotation));
    setSaved(false);
    showToast(`${selectedIds.length} anotação(ões) alteradas para ${label.name}.`);
  }

  function beginProjectRename() {
    setProjectNameDraft(projectName); setProjectEditing(true);
    requestAnimationFrame(() => projectInputRef.current?.focus());
  }

  function saveProjectName() {
    const name = projectNameDraft.trim();
    if (!name) return;
    setProjectName(name); setProjectEditing(false); setProjectOpen(false); setSaved(false);
    showToast("Nome do projeto atualizado.");
  }

  function requestOpenProject() {
    if (!saved && !window.confirm(copy.replaceUnsavedProject)) return;
    const picker = openProjectInputRef.current;
    if (!picker) return;
    picker.value = "";
    try {
      if (typeof picker.showPicker === "function") picker.showPicker();
      else picker.click();
    } catch { picker.click(); }
  }

  function requestNewProject() {
    if (!saved && !window.confirm(copy.replaceUnsavedWithNewProject)) return;
    projectObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    projectObjectUrlsRef.current = [];
    if (input.current) input.current.value = "";
    if (openProjectInputRef.current) openProjectInputRef.current.value = "";
    idCounter.current = 0;
    setProjectName(copy.newProject); setProjectNameDraft("");
    setAssets([]); setCurrent(""); setAnnotations([]); setLabels([unlabeledLabel(copy.unlabeled)]);
    setActiveLabel(UNLABELED_ID); setBatchLabel(UNLABELED_ID); setHistory([]);
    setSelected(null); setMultiSelected([]); setSelectedVertex(null); setSelectedClassIds([]);
    setPendingDeleteAnnotationIds([]); setPendingDeleteClassIds([]); setHiddenAnnotations([]); setHiddenLabels([]);
    setSearch(""); setQuality(false); setTool("select"); setZoom(92); resetDrafts();
    setProjectOpen(false); setProjectEditing(false); setProjectSaveOpen(false); setExportOpen(false);
    setClassManagerOpen(false); setLeftOpen(false); setRightOpen(false); setSaved(true);
    showToast(copy.newProjectReady);
  }

  async function loadProjectFile(file: File) {
    setProjectBusy(true);
    try {
      const loaded = await openVisionLabelProject(file);
      projectObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      projectObjectUrlsRef.current = loaded.objectUrls;
      const firstLabel = loaded.labels.find((label) => label.id !== UNLABELED_ID) ?? loaded.labels[0];
      setProjectName(loaded.projectName); setAssets(loaded.assets); setAnnotations(loaded.annotations); setLabels(loaded.labels);
      setCurrent(loaded.assets[0].id); setActiveLabel(firstLabel.id); setBatchLabel(firstLabel.id);
      setHistory([]); setSelected(null); setMultiSelected([]); setSelectedVertex(null); setHiddenAnnotations([]); setHiddenLabels([]);
      setSearch(""); setTool("select"); resetDrafts(); setProjectOpen(false); setLeftOpen(loaded.missingImages > 0); setSaved(true);
      showToast(loaded.missingImages
        ? `${copy.projectOpened}. ${loaded.missingImages} ${copy.projectImagesNeedReload}`
        : `${copy.projectOpened}: ${file.name}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : copy.projectOpenError);
    } finally { setProjectBusy(false); }
  }

  function openSaveProjectDialog() {
    if (!assets.length) {
      setLeftOpen(true);
      showToast(copy.emptyProjectHint);
      return;
    }
    setProjectSaveMode(missingProjectImages ? "annotations" : "complete");
    setExportOpen(false); setProjectOpen(false); setProjectSaveOpen(true);
  }

  async function savePortableProject(mode: ProjectSaveMode) {
    if (mode === "complete" && missingProjectImages) return;
    setProjectBusy(true);
    try {
      const fileName = await saveVisionLabelProject(projectName, assets, labels, annotations, mode);
      setSaved(true); setExportOpen(false); setProjectOpen(false); setProjectSaveOpen(false);
      showToast(`${copy.projectSaved}: ${fileName}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : copy.projectSaveError);
    } finally { setProjectBusy(false); }
  }

  async function exportData(kind: "coco" | "yolo" | "project") {
    if (!assets.length) { setExportOpen(false); setLeftOpen(true); showToast(copy.emptyProjectHint); return; }
    if (kind === "project") { openSaveProjectDialog(); return; }
    setExporting(true);
    try {
      if (kind === "coco") exportCoco(assets, labels, annotations);
      if (kind === "yolo") await exportYoloZip(assets, labels, annotations);
      setExportOpen(false); showToast(kind === "yolo" ? "Pacote YOLO gerado e download iniciado." : "Arquivo gerado e download iniciado.");
    } catch { showToast("Não foi possível gerar a exportação."); }
    finally { setExporting(false); }
  }

  async function probeSam(endpoint: string) {
    setSamConnectionState("checking");
    try {
      const url = new URL(endpoint);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        setSamConnectionState("offline"); setSamRuntime(""); setSamLoadedModelId(null); return { ready: false, modelId: null };
      }
      const healthUrl = `${url.origin}${url.pathname.replace(/\/predict\/?$/, "")}/health`;
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(6_000) });
      if (!response.ok) throw new Error();
      const health = await response.json() as { status?: string; device?: string; model_type?: string; model_id?: string; family?: string; error?: string };
      const legacyModelIds: Record<string, string> = { vit_b: "sam1-vit-b", vit_l: "sam1-vit-l", vit_h: "sam1-vit-h" };
      const modelId = health.model_id ?? (health.model_type ? legacyModelIds[health.model_type] : null) ?? null;
      const modelName = modelId ? getSamModel(modelId)?.name ?? modelId : health.model_type;
      setSamLoadedModelId(modelId);
      setSamRuntime([modelName, health.device, health.error].filter(Boolean).join(" · "));
      if (health.status !== "ready") {
        setSamConnectionState(health.status === "error" ? "error" : "loading");
        return { ready: false, modelId };
      }
      setSamConnectionState("ready");
      return { ready: true, modelId };
    } catch {
      setSamConnectionState("offline"); setSamRuntime(""); setSamLoadedModelId(null); return { ready: false, modelId: null };
    }
  }
  function openSamSettings() {
    const endpoint = samEndpoint || "http://127.0.0.1:7860/predict";
    setSamEndpointDraft(endpoint); setSamOpen(true);
    void probeSam(endpoint);
  }
  async function connectSam() {
    const endpoint = samEndpointDraft.trim();
    const health = await probeSam(endpoint);
    if (!health.ready) {
      showToast("O SAM ainda não está pronto. Abra o instalador, mantenha a janela em execução e tente novamente.");
      return;
    }
    if (health.modelId !== samModelId) {
      showToast(`O conector está usando ${health.modelId ?? "um modelo desconhecido"}. Reinicie-o com ${samModelId}.`);
      return;
    }
    setSamEndpoint(endpoint); localStorage.setItem("visionlabel-sam-endpoint", endpoint);
    clearSam(); setSamPromptMode(1); setSamOpen(false); setTool("sam"); showToast(`${selectedSamModel.name} conectado. Clique sobre o objeto na imagem.`);
  }
  function activateSam() {
    if (tool === "sam") {
      clearSam(); setTool("select"); showToast(copy.samToolDisabled); return;
    }
    if (!samEndpoint || samConnectionState !== "ready" || samLoadedModelId !== samModelId) { openSamSettings(); return; }
    clearSam(); setSamPromptMode(1); setTool("sam"); showToast(copy.samToolEnabled);
  }
  function acceptSamMask() {
    if (!samPreviewPolygons.length) return;
    remember();
    const additions = samPredictions.flatMap((prediction) => {
      const instanceId = makeId("sam-instance");
      return prediction.polygons.map((points) => ({
        id: makeId("sam"),
        instanceId,
        asset: current,
        label: activeLabel,
        type: "polygon" as const,
        pts: [...points],
      }));
    });
    const ids = additions.map((annotation) => annotation.id);
    setAnnotations((items) => [...items, ...additions]);
    setSelected(ids[0] ?? null); setMultiSelected(ids); setSelectedVertex(null); setBatchLabel(activeLabel);
    clearSam(); setTool("select"); showToast(copy.samSavedEditable);
  }
  function clearSam() {
    invalidateSamPrediction();
    setSamPrompts([]); setSamBoxStart(null); setSamBox(null); setSamText("");
  }
  function invalidateSamPrediction() {
    samAbortRef.current?.abort(); samAbortRef.current = null; samRequestRef.current += 1;
    setSamPredictions([]); setSamLoading(false);
  }
  function restartSam() { clearSam(); setSamPromptMode(1); showToast(copy.samRestarted); }
  function chooseSamInteractionMode(mode: SamInteractionMode) {
    if (mode === samInteractionMode) return;
    clearSam(); setSamInteractionMode(mode); setSamPromptMode(1);
  }
  function runSamText() {
    const text = samText.trim();
    if (!text) { showToast("Descreva o conceito que deseja segmentar."); return; }
    void runSam({ prompts: [], box: null, text, multimaskOutput: true });
  }
  function chooseImage(id: string) { setCurrent(id); setSelected(null); setMultiSelected([]); setSelectedVertex(null); resetDrafts(); setLeftOpen(false); }
  function go(direction: number) {
    if (!assets.length) return;
    const index = Math.max(0, assets.findIndex((item) => item.id === current));
    chooseImage(assets[Math.max(0, Math.min(assets.length - 1, index + direction))].id);
  }

  if (!mounted) return <main className="shell app-loading" aria-busy="true"><div className="loading-card"><span className="mark"><Pentagon size={18} /></span><b>vision<span>label</span></b></div></main>;

  return <main className="shell">
    <header className="topbar">
      <input hidden ref={openProjectInputRef} type="file" accept=".visionlabel,application/zip,application/vnd.visionlabel.project+zip" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void loadProjectFile(file); }} />
      <div className="brand-side">
        <button className="mobile" onClick={() => setLeftOpen(true)} aria-label={copy.openImages}><Menu size={19} /></button>
        <div className="mark"><Pentagon size={19} /></div><b className="brand">vision<span>label</span></b><i />
        <div className="project-switcher" ref={projectSwitcherRef}>
          <button className={`project ${projectOpen ? "open" : ""}`} aria-haspopup="dialog" aria-expanded={projectOpen} onClick={() => { setProjectOpen((value) => !value); setProjectEditing(false); }}><em />{projectName} <ChevronDown size={14} /></button>
          {projectOpen && <section className="project-pop" role="dialog" aria-label={copy.projectCurrent}>
            <p>{copy.projectCurrent}</p>
            {projectEditing ? <div className="project-rename"><input ref={projectInputRef} value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveProjectName(); if (event.key === "Escape") setProjectEditing(false); }} /><button onClick={saveProjectName}><Check size={14} />{copy.save}</button></div> : <>
              <div className="project-summary"><span><em />{projectName}</span><small>{assets.length} {copy.projectImages} · {annotations.length} {copy.projectAnnotations}</small></div>
              <button onClick={requestNewProject}><Plus size={14} /><span><b>{copy.newProject}</b><small>{copy.newProjectHint}</small></span></button>
              <button onClick={requestOpenProject}><FolderUp size={14} /><span><b>{copy.openProject}</b><small>{copy.openProjectHint}</small></span></button>
              <button onClick={openSaveProjectDialog}><Save size={14} /><span><b>{copy.saveProject}</b><small>{copy.saveProjectHint}</small></span></button>
              <button onClick={beginProjectRename}><Pencil size={14} /><span><b>{copy.renameProject}</b><small>{projectName}</small></span></button>
            </>}
          </section>}
        </div>
      </div>
      <div className="head-actions"><span className={`save ${saved ? "done" : ""}`}><HardDriveDownload size={14} />{saved ? copy.saved : copy.saving}</span><button className="open-project-main" disabled={projectBusy} onClick={requestOpenProject}><FolderUp size={15} /><span>{copy.openProject}</span></button><button className="project-save-main" disabled={projectBusy} onClick={openSaveProjectDialog}>{projectBusy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}<span>{copy.saveProject}</span></button><button className={`sam-connection ${samConnectionState === "ready" && samLoadedModelId === samModelId ? "connected" : ""}`} title={selectedSamModel.name} onClick={openSamSettings}><Link2 size={14} />{samConnectionState === "ready" && samLoadedModelId === samModelId ? selectedSamModel.name : copy.activateSam}</button><div className="export"><button className="export-main" disabled={exporting || projectBusy} onClick={() => setExportOpen(!exportOpen)}>{exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} {copy.export} <ChevronDown size={13} /></button>{exportOpen && <div className="export-pop"><p>{copy.exportFormat}</p><button onClick={() => void exportData("coco")}><b>COCO JSON</b><span>{copy.cocoDesc}</span></button><button onClick={() => void exportData("yolo")}><b>YOLO ZIP</b><span>{copy.yoloDesc}</span></button><button onClick={() => void exportData("project")}><b>VisionLabel</b><span>{copy.projectBackup}</span></button></div>}</div><button className="preferences-button" title={copy.preferences} aria-label={copy.preferences} onClick={() => setPreferencesOpen(true)}><Languages size={17} /></button><span className="local-mode" title={copy.localOnlyHint}><ShieldCheck size={14} />{copy.localOnly}</span><button className="mobile" onClick={() => setRightOpen(true)} aria-label={copy.classes}><MoreHorizontal size={19} /></button></div>
    </header>

    <div className="workspace">
      <aside className={`assets ${leftOpen ? "open" : ""}`}>
        <div className="drawer-head"><b>{copy.images}</b><button onClick={() => setLeftOpen(false)}><X size={19} /></button></div>
        <div className="aside-title"><span>{copy.images} <b>{assets.length}</b></span><button onClick={() => input.current?.click()}><Plus size={16} /></button></div>
        <input hidden ref={input} type="file" accept="image/*" multiple onChange={(event) => files(event.target.files)} />
        <button className="import" onClick={() => input.current?.click()}><ImagePlus size={16} /> {copy.importImages}</button>
        <label className="search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchImage} /></label>
        <div className="progress"><div><span>{copy.progress}</span><b>{completed} {copy.of} {assets.length}</b></div><i><em style={{ width: `${assets.length ? completed / assets.length * 100 : 0}%` }} /></i></div>
        <div className="asset-list">{assets.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).map((item, index) => { const count = annotations.filter((annotation) => annotation.asset === item.id).length; return <button key={item.id} className={`${current === item.id ? "active" : ""} ${item.missing ? "missing" : ""}`} onClick={() => chooseImage(item.id)}><div className="thumb" style={{ backgroundImage: item.src ? `url(${item.src})` : "none" }}><span>{String(index + 1).padStart(2, "0")}</span>{count > 0 && <b>{count}</b>}</div><div><strong>{item.name}</strong><small>{item.missing ? copy.imageNotLoaded : item.width && item.height ? `${item.width} × ${item.height}` : copy.localImage}</small></div><i className={count ? "checked" : ""}>{count ? "✓" : ""}</i></button>; })}</div>
        <div className="privacy"><ShieldCheck size={14} /> {copy.privacy}</div>
      </aside>

      <section className="editor">
        <div className="tools">
          <div><ToolButton title={copy.select} keyHint="V" active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 size={18} /></ToolButton><ToolButton title={`${copy.pan} · ${copy.middlePan}`} keyHint="H" active={tool === "pan"} onClick={() => setTool("pan")}><Hand size={18} /></ToolButton></div><i />
          <div><ToolButton title={copy.box} keyHint="B" active={tool === "box"} onClick={() => setTool("box")}><Box size={18} /></ToolButton><ToolButton title={copy.polygon} keyHint="P" active={tool === "polygon"} onClick={() => setTool("polygon")}>{tool === "polygon" ? <PenTool size={18} /> : <Pentagon size={18} />}</ToolButton><ToolButton title={copy.freehand} keyHint="F" active={tool === "freehand"} onClick={() => setTool("freehand")}><PenLine size={18} /></ToolButton><ToolButton title={copy.point} keyHint="K" active={tool === "point"} onClick={() => setTool("point")}><span className="point-icon" /></ToolButton><ToolButton title={tool === "sam" ? copy.samDeactivate : copy.sam} keyHint="S" active={tool === "sam"} onClick={activateSam}><WandSparkles size={18} /></ToolButton></div><i />
          <div className="edit-tools"><ToolButton title={copy.simplify} disabled={activeAnnotation?.type !== "polygon"} onClick={simplifySelected}><ListRestart size={18} /></ToolButton><ToolButton title={copy.duplicate} disabled={activeAnnotation?.type !== "polygon"} onClick={duplicateSelected}><Copy size={17} /></ToolButton><ToolButton title={copy.merge} disabled={selectedPolygons.length < 2} onClick={mergeSelected}><Combine size={18} /></ToolButton><ToolButton title={copy.split} disabled={activeAnnotation?.type !== "polygon"} active={tool === "split"} onClick={() => setTool("split")}><Scissors size={17} /></ToolButton><ToolButton title={copy.transform} keyHint="T" disabled={activeAnnotation?.type !== "polygon"} active={tool === "transform"} onClick={() => setTool("transform")}><Maximize2 size={17} /></ToolButton><ToolButton title={copy.reshape} keyHint="R" disabled={activeAnnotation?.type !== "polygon"} active={tool === "reshape"} onClick={() => setTool("reshape")}><PenTool size={17} /></ToolButton><ToolButton title={snapping ? copy.snapOn : copy.snapOff} active={snapping} onClick={() => { setSnapping((value) => !value); setSnapGuide(null); }}><Magnet size={17} /></ToolButton></div><i />
          <div><ToolButton title="Desfazer" disabled={!history.length} onClick={undo}><Undo2 size={18} /></ToolButton><ToolButton title="Refazer" disabled><Redo2 size={18} /></ToolButton><ToolButton title={selectedVertex ? "Excluir nó e avançar na sequência" : polygonDraft.length ? "Remover último ponto criado" : "Excluir forma inteira"} disabled={!selected && !polygonDraft.length} onClick={deleteSelection}><Trash2 size={18} /></ToolButton></div><span className="spacer" />
          <label className="stroke-control" title={copy.lineThickness}><PenLine size={14} /><input aria-label={copy.lineThickness} type="range" min="1" max="10" step="1" value={lineThickness} onChange={(event) => setLineThickness(Number(event.target.value))} /><output>{lineThickness}px</output></label><div className="zoom" title={copy.shiftZoom}><button aria-label={copy.zoomOut} onClick={() => setZoom((value) => Math.max(10, value - 10))}><ZoomOut size={15} /></button><span>{zoom}%</span><button aria-label={copy.zoomIn} onClick={() => setZoom((value) => Math.min(400, value + 10))}><ZoomIn size={15} /></button></div><ToolButton title={copy.fitImage} onClick={fitImageToViewport}><Focus size={16} /></ToolButton>
        </div>

        <div className={`stage ${tool} ${panStart ? "panning" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const projectFile = Array.from(event.dataTransfer.files).find((file) => file.name.toLowerCase().endsWith(".visionlabel")); if (projectFile) { if (saved || window.confirm(copy.replaceUnsavedProject)) void loadProjectFile(projectFile); } else files(event.dataTransfer.files); }}><div className="scroll" ref={scrollRef} onWheel={zoomWithWheel}>{asset ? <div className="canvas" style={{ width: `${zoom}%`, aspectRatio: `${asset.width ?? 1000}/${asset.height ?? 650}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {asset.missing ? <div className="missing-image"><Images size={34} /><b>{asset.name}</b><p>{copy.imageMissingHint}</p><button onClick={() => input.current?.click()}><FolderOpen size={15} />{copy.reloadProjectImages}</button></div> : <img crossOrigin="anonymous" src={asset.src} alt={`Imagem para anotação: ${asset.name}`} draggable={false} onLoad={(event) => { const image = event.currentTarget; if (asset.width !== image.naturalWidth || asset.height !== image.naturalHeight) setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, width: image.naturalWidth, height: image.naturalHeight } : item)); }} />}
          <svg ref={svgRef} viewBox="0 0 1000 650" preserveAspectRatio="none" onPointerDown={canvasPointerDown} onPointerMove={canvasPointerMove} onPointerUp={canvasPointerUp} onPointerCancel={canvasPointerUp} onAuxClick={(event) => event.preventDefault()} onContextMenu={finishDrawingWithRightClick} onDoubleClick={() => tool === "polygon" && finishPolygon()}>
            {visibleAnnotations.map((annotation) => {
              const label = getLabel(annotation.label);
              const isSelected = multiSelected.includes(annotation.id);
              if (annotation.type === "box") return <g className={tool === "select" ? "movable-annotation" : ""} key={annotation.id} onPointerDown={(event) => beginAnnotationDrag(event, annotation)} onPointerMove={moveAnnotationPointer} onPointerUp={finishAnnotationPointer} onPointerCancel={finishAnnotationPointer}><rect x={annotation.x} y={annotation.y} width={annotation.w} height={annotation.h} fill={`${label.color}28`} stroke={label.color} strokeWidth={isSelected ? lineThickness + 2 : lineThickness} /><g transform={`translate(${annotation.x},${(annotation.y ?? 0) - 31})`}><rect width={Math.max(100, label.name.length * 10 + 25)} height="31" rx="5" fill={label.color} /><text x="12" y="21" fontSize="16" fontWeight="700" fill="#112018">{label.name}</text></g></g>;
              if (annotation.type === "polygon") return <g key={annotation.id}><polygon className={tool === "select" ? "movable-annotation" : ""} onPointerDown={(event) => beginAnnotationDrag(event, annotation)} onPointerMove={moveAnnotationPointer} onPointerUp={finishAnnotationPointer} onPointerCancel={finishAnnotationPointer} points={pointsToSvg(annotation.pts)} fill={`${label.color}30`} stroke={label.color} strokeWidth={isSelected ? lineThickness + 2 : lineThickness} />{tool === "select" && isSelected && annotation.id === selected && multiSelected.length === 1 && edgeMidpoints(annotation.pts ?? []).map((midpoint) => <circle className="edge-handle" onPointerDown={(event) => insertVertex(event, annotation, midpoint.edgeIndex, midpoint.x, midpoint.y)} onPointerMove={moveVertexPointer} onPointerUp={finishVertexPointer} onPointerCancel={finishVertexPointer} key={`edge-${midpoint.edgeIndex}`} cx={midpoint.x} cy={midpoint.y} r={2.1 * handleScale} strokeWidth={1 * handleScale} />)}{tool === "select" && isSelected && annotation.id === selected && multiSelected.length === 1 && (annotation.pts ?? []).map((coordinate, index, points) => index % 2 === 0 ? <circle className={`vertex-handle ${selectedVertex?.annotationId === annotation.id && selectedVertex.vertexIndex === index / 2 ? "selected" : ""}`} onPointerDown={(event) => beginVertexDrag(event, annotation, index / 2)} onPointerMove={moveVertexPointer} onPointerUp={finishVertexPointer} onPointerCancel={finishVertexPointer} key={index} cx={coordinate} cy={points[index + 1]} r={polygonHandleRadius(points.length / 2, handleScale)} fill="#fff" stroke={label.color} strokeWidth={Math.max(1.2, polygonHandleRadius(points.length / 2, handleScale) * .46)} /> : null)}</g>;
              return <g className={tool === "select" ? "movable-annotation" : ""} key={annotation.id} onPointerDown={(event) => beginAnnotationDrag(event, annotation)} onPointerMove={moveAnnotationPointer} onPointerUp={finishAnnotationPointer} onPointerCancel={finishAnnotationPointer}><circle cx={annotation.x} cy={annotation.y} r={isSelected ? 17 : 13} fill="#fff" stroke={label.color} strokeWidth="6" /><circle cx={annotation.x} cy={annotation.y} r="4" fill={label.color} /></g>;
            })}
            {selectionMarquee && <rect className="selection-marquee" x={Math.min(selectionMarquee.startX, selectionMarquee.currentX)} y={Math.min(selectionMarquee.startY, selectionMarquee.currentY)} width={Math.abs(selectionMarquee.currentX - selectionMarquee.startX)} height={Math.abs(selectionMarquee.currentY - selectionMarquee.startY)} />}
            {tool === "transform" && activeAnnotation?.type === "polygon" && activePolygonBounds && activePolygonCenter && <g className="transform-overlay">
              <rect x={activePolygonBounds.x} y={activePolygonBounds.y} width={activePolygonBounds.width} height={activePolygonBounds.height} />
              <line x1={activePolygonCenter.x} y1={transformRotationAnchorY} x2={activePolygonCenter.x} y2={transformRotationY} />
              <circle className="transform-handle rotate-handle" cx={activePolygonCenter.x} cy={transformRotationY} r="10" onPointerDown={(event) => beginTransform(event, activeAnnotation, "rotate")} onPointerMove={moveTransformPointer} onPointerUp={finishTransformPointer} onPointerCancel={finishTransformPointer} />
              <circle className="transform-handle scale-handle" cx={activePolygonBounds.x + activePolygonBounds.width} cy={activePolygonBounds.y + activePolygonBounds.height} r="10" onPointerDown={(event) => beginTransform(event, activeAnnotation, "scale")} onPointerMove={moveTransformPointer} onPointerUp={finishTransformPointer} onPointerCancel={finishTransformPointer} />
              <circle className="transform-center" cx={activePolygonCenter.x} cy={activePolygonCenter.y} r="5" />
            </g>}
            {draft && <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} fill={`${getLabel(activeLabel).color}25`} stroke={getLabel(activeLabel).color} strokeWidth={lineThickness} strokeDasharray="9 7" />}
            {polygonDraft.length > 1 && <g><polyline points={pointsToSvg(polygonDraft)} fill={`${getLabel(activeLabel).color}20`} stroke={getLabel(activeLabel).color} strokeWidth={lineThickness} strokeDasharray="9 7" />{polygonDraft.map((coordinate, index, points) => index % 2 === 0 ? <circle className={index === 0 && polygonDraft.length >= 6 ? "polygon-close-point" : ""} key={index} cx={coordinate} cy={points[index + 1]} r={(index === 0 && polygonDraft.length >= 6 ? 6.5 : 4.2) * handleScale} fill={getLabel(activeLabel).color} stroke="#fff" strokeWidth={1.5 * handleScale} /> : null)}</g>}
            {freehandDraft.length > 1 && <polyline className="freehand-line" points={pointsToSvg(freehandDraft)} fill={`${getLabel(activeLabel).color}22`} stroke={getLabel(activeLabel).color} strokeWidth={lineThickness} />}
            {reshapeDraft.length > 1 && <g><polyline className="reshape-line" points={pointsToSvg(reshapeDraft)} />{reshapeDraft.length >= 4 && <><circle className="reshape-endpoint" cx={reshapeDraft[0]} cy={reshapeDraft[1]} r="7" /><circle className="reshape-endpoint" cx={reshapeDraft.at(-2)} cy={reshapeDraft.at(-1)} r="7" /></>}</g>}
            {splitStart && splitEnd && <line className="split-line" x1={splitStart.x} y1={splitStart.y} x2={splitEnd.x} y2={splitEnd.y} />}
            {snapGuide && <g className="snap-guide"><circle cx={snapGuide.x} cy={snapGuide.y} r="12" /><line x1={snapGuide.x - 7} y1={snapGuide.y} x2={snapGuide.x + 7} y2={snapGuide.y} /><line x1={snapGuide.x} y1={snapGuide.y - 7} x2={snapGuide.x} y2={snapGuide.y + 7} /></g>}
            {tool === "sam" && samPreviewPolygons.map((polygon, index) => <polygon key={`sam-preview-${index}`} className="sam-mask-preview" points={pointsToSvg(polygon)} fill={`${getLabel(activeLabel).color}52`} stroke={getLabel(activeLabel).color} strokeWidth={lineThickness} strokeDasharray="10 6" />)}
            {tool === "sam" && samBox && <rect className="sam-box-prompt" x={samBox.x} y={samBox.y} width={samBox.w} height={samBox.h} fill={`${getLabel(activeLabel).color}16`} stroke={getLabel(activeLabel).color} strokeWidth={lineThickness} strokeDasharray="9 6" />}
            {tool === "sam" && samPrompts.map((prompt, index) => <g key={index} className={`sam-prompt ${prompt.label ? "positive" : "negative"}`}><circle cx={prompt.x} cy={prompt.y} r="13" /><line x1={prompt.x - 6} y1={prompt.y} x2={prompt.x + 6} y2={prompt.y} />{prompt.label === 1 && <line x1={prompt.x} y1={prompt.y - 6} x2={prompt.x} y2={prompt.y + 6} />}</g>)}
          </svg>
          {tool === "polygon" && polygonDraft.length > 0 && <div className="tip">{copy.polygonFinish}</div>}
          {tool === "freehand" && <div className="tip">{freehandDrawing ? copy.freehandFinish : copy.freehandStart}</div>}
          {tool === "split" && <div className="tip">{copy.splitTip}</div>}
          {tool === "transform" && <div className="tip">{copy.transformTip}</div>}
          {tool === "reshape" && <div className="tip">{reshapeDrawing ? (reshapeStartInside ? copy.reshapeAdd : copy.reshapeDelete) : copy.reshapeStart}</div>}
          {activeAnnotation?.type === "polygon" && tool === "select" && <div className="polygon-tip">{copy.middlePan} · nó + Delete remove em sequência · corpo + Delete apaga tudo</div>}
          {tool === "sam" && <div className="sam-controls sam-controls-capability">
            <div className="sam-mode-tabs" role="tablist" aria-label="Tipo de prompt SAM">
              <button className={samInteractionMode === "points" ? "active" : ""} onClick={() => chooseSamInteractionMode("points")}>Pontos</button>
              {selectedSamModel.capabilities.boxPrompts && <button className={samInteractionMode === "box" ? "active" : ""} onClick={() => chooseSamInteractionMode("box")}><Box size={13} />Caixa</button>}
              {selectedSamModel.capabilities.textPrompts && <button className={samInteractionMode === "text" ? "active" : ""} onClick={() => chooseSamInteractionMode("text")}><Sparkles size={13} />Texto</button>}
            </div>
            <div className="sam-mode-input">
              {samInteractionMode === "points" && <><button className={samPromptMode === 1 ? "active positive" : ""} onClick={() => setSamPromptMode(1)}><CirclePlus size={15} />{copy.samInclude}</button><button className={samPromptMode === 0 ? "active negative" : ""} onClick={() => setSamPromptMode(0)}><CircleMinus size={15} />{copy.samExclude}</button></>}
              {samInteractionMode === "box" && <small>Arraste uma caixa ao redor do objeto.</small>}
              {samInteractionMode === "text" && <form onSubmit={(event) => { event.preventDefault(); runSamText(); }}><input aria-label="Conceito para segmentar" placeholder="Ex.: todas as pessoas" value={samText} onChange={(event) => { invalidateSamPrediction(); setSamText(event.target.value); }} /><button type="submit" disabled={!samText.trim() || samLoading}>Segmentar</button><label title="Limiar de confiança">Conf. {Math.round(samThreshold * 100)}%<input aria-label="Limiar de confiança" type="range" min="0.1" max="0.95" step="0.05" value={samThreshold} onChange={(event) => { invalidateSamPrediction(); setSamThreshold(Number(event.target.value)); }} /></label></form>}
            </div>
            <span>{samLoading ? <><LoaderCircle className="spin" size={14} />{copy.samSegmenting}</> : samPredictions.length ? `${samPredictions.length} resultado(s) · ${samPreviewPolygons.length} contorno(s)` : samInteractionMode === "points" ? `${samPrompts.length} ${copy.samPoints}` : selectedSamModel.name}</span>
            <div className="sam-actions"><button disabled={!samPrompts.length && !samBox && !samText && !samPreviewPolygons.length && !samLoading} onClick={restartSam}><ListRestart size={14} />{copy.samRestart}</button><button className="accept" disabled={!samPreviewPolygons.length || samLoading} onClick={acceptSamMask}><Check size={14} />{copy.samSaveEdit}{samPreviewPolygons.length > 1 ? ` (${samPreviewPolygons.length})` : ""}</button><button aria-label={copy.samConfigure} onClick={openSamSettings}><Settings2 size={15} /></button></div>
          </div>}
        </div> : <div className="empty-project"><span><Images size={30} /></span><h2>{copy.emptyProjectTitle}</h2><p>{copy.emptyProjectHint}</p><div><button className="primary" onClick={() => input.current?.click()}><ImagePlus size={16} />{copy.importImages}</button><button onClick={requestOpenProject}><FolderUp size={16} />{copy.openProject}</button></div><small>{copy.privacy}</small></div>}</div></div>
        <div className="status"><div><button onClick={() => go(-1)} disabled={!asset || assets[0]?.id === current}><ChevronLeft size={16} /></button><span><b>{asset ? assets.findIndex((item) => item.id === current) + 1 : 0}</b> / {assets.length}</span><button onClick={() => go(1)} disabled={!asset || assets.at(-1)?.id === current}><ChevronRight size={16} /></button></div><p><Sparkles size={14} />{annotationDrag ? `${copy.moving} (${annotationDrag.originals.length})` : selectionMarquee ? copy.selecting : transformDrag ? copy.transforming : reshapeDrawing ? copy.reshaping : selectedVertex ? `Nó selecionado — encaixe ${snapping ? "ativo" : "inativo"}` : polygonDraft.length ? `${polygonDraft.length / 2} ponto(s) — Delete desfaz na ordem de criação` : multiSelected.length > 1 ? `${multiSelected.length} ${copy.selectedObjects}` : currentAnnotations.length ? `${currentAnnotations.length} ${copy.imageAnnotations}` : asset ? copy.ready : copy.emptyProjectTitle}</p><button><Keyboard size={15} /> {copy.shortcuts}</button></div>
      </section>

      <aside className={`labels ${rightOpen ? "open" : ""}`}>
        <div className="drawer-head"><b>{copy.annotations} · {copy.quality}</b><button onClick={() => setRightOpen(false)}><X size={19} /></button></div>
        <div className="tabs"><button className={!quality ? "active" : ""} onClick={() => setQuality(false)}>{copy.annotations}</button><button className={quality ? "active" : ""} onClick={() => setQuality(true)}>{copy.quality} <b>{currentAnnotations.length ? 1 : 0}</b></button></div>
        {!quality ? <div className="annotation-editor"><section className="annotation-panel-head"><div><b>{copy.annotations} · {currentAnnotations.length}</b><span>{copy.annotationPanelHint}</span></div><div className="annotation-panel-actions"><button disabled={!currentPolygonIds.length} onClick={toggleAllCurrentPolygons}><Check size={13} />{allCurrentPolygonsSelected ? copy.clearPolygonSelection : copy.selectAllPolygons}</button><button onClick={() => { setSelectedClassIds([]); setClassManagerOpen(true); }}><Palette size={14} />{copy.manageClasses}</button></div></section>
          {selectedIds.length > 0 && <section className="batch-class"><div><Tags size={14} /><span><b>{selectedIds.length} {copy.batchSelection}</b><small>{copy.changeClass}</small></span></div><div><select aria-label={copy.changeClass} value={resolvedBatchLabel} onChange={(event) => setBatchLabel(event.target.value)}>{labels.map((label) => <option key={label.id} value={label.id}>{label.id === UNLABELED_ID ? copy.unlabeled : label.name}</option>)}</select><button onClick={reclassifySelection}>{copy.applyClass}</button><button className="batch-delete" onClick={() => setPendingDeleteAnnotationIds(selectedIds)}><Trash2 size={13} />{copy.deleteSelectedAnnotations}</button></div></section>}
          <div className="instances">{currentAnnotations.map((annotation, index) => { const label = getLabel(annotation.label); const isHidden = hiddenAnnotations.includes(annotation.id) || hiddenLabels.includes(annotation.label); const isChecked = multiSelected.includes(annotation.id); return <div key={annotation.id} className={`instance-row ${isChecked ? "active" : ""} ${isHidden ? "hidden" : ""}`}><button className={`annotation-selector ${isChecked ? "selected" : ""}`} aria-label={`${copy.selectAnnotation}: ${annotation.label === UNLABELED_ID ? copy.unlabeled : label.name} #${index + 1}`} aria-pressed={isChecked} onClick={() => { toggleMultiSelection(annotation.id); setTool("select"); }}>{isChecked && <Check size={11} />}</button><button className="instance-main" onClick={(event) => { if (event.shiftKey) toggleMultiSelection(annotation.id); else { setSelected(annotation.id); setMultiSelected([annotation.id]); setBatchLabel(annotation.label); } setSelectedVertex(null); setTool("select"); }}><i style={{ borderColor: label.color }}>{annotation.type === "point" ? "•" : ""}</i><span>{annotation.label === UNLABELED_ID ? copy.unlabeled : label.name} <small>#{index + 1}</small></span></button><button className="visibility-toggle" title={isHidden ? copy.showAnnotation : copy.hideAnnotation} aria-label={`${isHidden ? copy.showAnnotation : copy.hideAnnotation}: ${label.name} #${index + 1}`} onClick={() => toggleAnnotationVisibility(annotation.id)}>{isHidden ? <EyeOff size={14} /> : <Eye size={14} />}</button></div>; })}</div>
        </div> : <div className="quality"><div className="score"><strong>92<small>/100</small></strong><span>{copy.goodConsistency}</span></div><article className="warn"><b>!</b><div><strong>{copy.possibleOverlap}</strong><p>{copy.overlapText}</p></div></article><article><b>✓</b><div><strong>{copy.validClasses}</strong><p>{copy.validClassesText}</p></div></article><article><b>✓</b><div><strong>{copy.noEmpty}</strong><p>{copy.noEmptyText}</p></div></article><button onClick={() => { setQuality(false); setSelected(visibleAnnotations[0]?.id ?? null); setMultiSelected(visibleAnnotations[0] ? [visibleAnnotations[0].id] : []); }}>{copy.review}</button></div>}
        <div className="hint"><b>{activeAnnotation?.type === "polygon" ? copy.vectorEditing : copy.quickTip}</b><p>{activeAnnotation?.type === "polygon" ? copy.vectorHint : copy.shortcutHint}</p></div>
      </aside>
    </div>

    {classManagerOpen && <div className="modal-backdrop class-manager-backdrop"><section className="class-manager-page" role="dialog" aria-modal="true" aria-labelledby="class-manager-title"><header><div><span><Palette size={20} /></span><div><h2 id="class-manager-title">{copy.classManagerTitle}</h2><p>{copy.classManagerHint}</p></div></div><button onClick={() => { setClassManagerOpen(false); setSelectedClassIds([]); }} aria-label={copy.close}><X size={21} /></button></header><div className="class-manager-body"><div className="class-manager-sidebar"><section className="label-creator"><div><Palette size={14} /><span><b>{copy.labelStudio}</b><small>{copy.labelStudioHint}</small></span></div><div className="label-create-row"><input ref={labelInputRef} aria-label={copy.className} placeholder={copy.className} value={newLabel} onChange={(event) => setNewLabel(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addClass()} /><input className="label-color" type="color" aria-label={copy.labelColor} title={copy.labelColor} value={newLabelColor} onChange={(event) => setNewLabelColor(event.target.value)} /><button aria-label={copy.createLabel} title={copy.createLabel} disabled={!newLabel.trim()} onClick={addClass}><Plus size={15} /></button></div></section><section className="class-manager-active"><div><Tags size={14} /><span><b>{copy.newAnnotationClass}</b><small>{copy.newShapesClass}</small></span></div><select aria-label={copy.newAnnotationClass} value={activeLabel} onChange={(event) => setActiveLabel(event.target.value)}>{labels.map((label) => <option key={label.id} value={label.id}>{label.id === UNLABELED_ID ? copy.unlabeled : label.name}</option>)}</select></section></div><section className="class-manager-classes"><div className="class-manager-list-head"><div><b>{copy.classList}</b><span>{labels.length} {copy.classes.toLocaleLowerCase()}</span></div>{selectableClasses.length > 0 && <button onClick={() => setSelectedClassIds(selectedClassIds.length === selectableClasses.length ? [] : selectableClasses.map((label) => label.id))}>{selectedClassIds.length === selectableClasses.length ? copy.clearClassSelection : copy.selectAllClasses}</button>}</div>{selectedClassIds.length > 0 && <div className="class-selection-summary"><span>{selectedClassIds.length} {copy.classesSelected}</span><button onClick={() => requestClassDeletion(selectedClassIds)}><Trash2 size={12} />{copy.deleteSelectedClasses}</button></div>}<div className="label-list class-manager-list">{labels.map((label) => { const isHidden = hiddenLabels.includes(label.id); const isUnlabeled = label.id === UNLABELED_ID; const isChecked = selectedClassIds.includes(label.id); return <div key={label.id} className={`label-row ${isHidden ? "hidden" : ""} ${isChecked ? "checked" : ""}`}>{isUnlabeled ? <span className="label-selector-spacer" /> : <button className={`label-selector ${isChecked ? "selected" : ""}`} aria-label={`${copy.selectClass}: ${label.name}`} aria-pressed={isChecked} onClick={() => setSelectedClassIds((items) => items.includes(label.id) ? items.filter((id) => id !== label.id) : [...items, label.id])}>{isChecked && <Check size={11} />}</button>}<div className="label-main"><i style={{ background: label.color }} /><span>{isUnlabeled ? copy.unlabeled : label.name}</span><em>{annotations.filter((annotation) => annotation.label === label.id).length}</em>{label.key ? <kbd>{label.key}</kbd> : <span />}</div><button className="visibility-toggle" title={isHidden ? copy.showClass : copy.hideClass} aria-label={`${isHidden ? copy.showClass : copy.hideClass}: ${label.name}`} onClick={() => toggleLabelVisibility(label.id)}>{isHidden ? <EyeOff size={14} /> : <Eye size={14} />}</button><button className="delete-label" disabled={isUnlabeled} title={isUnlabeled ? copy.unlabeledProtected : copy.deleteClass} aria-label={`${copy.deleteClass}: ${label.name}`} onClick={() => requestClassDeletion([label.id])}><Trash2 size={13} /></button></div>; })}</div></section></div><footer><button onClick={() => { setClassManagerOpen(false); setSelectedClassIds([]); }}><Check size={14} />{copy.close}</button></footer></section></div>}
    {projectSaveOpen && <div className="modal-backdrop"><section className="sam-modal project-save-modal" role="dialog" aria-modal="true" aria-labelledby="project-save-title"><header><div><span><Save size={18} /></span><div><h2 id="project-save-title">{copy.saveProjectTitle}</h2><p>{copy.saveProjectDescription}</p></div></div><button onClick={() => setProjectSaveOpen(false)} aria-label={copy.close}><X size={19} /></button></header><div className="project-save-options" role="radiogroup" aria-label={copy.saveProjectTitle}><button className={projectSaveMode === "annotations" ? "active" : ""} role="radio" aria-checked={projectSaveMode === "annotations"} onClick={() => setProjectSaveMode("annotations")}><span><FileText size={20} /></span><div><b>{copy.annotationsOnly}</b><p>{copy.annotationsOnlyHint}</p><small>{formatBytes(annotationProjectBytes)} · {assets.length} {copy.imageReferences}</small></div><Check size={16} /></button><button className={projectSaveMode === "complete" ? "active" : ""} role="radio" aria-checked={projectSaveMode === "complete"} disabled={missingProjectImages > 0} onClick={() => setProjectSaveMode("complete")}><span><Images size={20} /></span><div><b>{copy.imagesAndAnnotations}</b><p>{copy.imagesAndAnnotationsHint}</p><small>{knownProjectImageBytes ? `${formatBytes(knownProjectImageBytes)} + ${formatBytes(annotationProjectBytes)}` : copy.sizeCalculatedOnSave}</small>{missingProjectImages > 0 && <em>{missingProjectImages} {copy.projectImagesNeedReload}</em>}</div><Check size={16} /></button></div><div className="project-save-privacy"><ShieldCheck size={16} /><div><b>{copy.localOnly}</b><p>{copy.projectSavePrivacy}</p></div></div><footer><button onClick={() => setProjectSaveOpen(false)}>{copy.cancel}</button><button className="connect" disabled={projectBusy || (projectSaveMode === "complete" && missingProjectImages > 0)} onClick={() => void savePortableProject(projectSaveMode)}>{projectBusy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{copy.generateProjectFile}</button></footer></section></div>}
    {pendingDeleteAnnotations.length > 0 && <div className="modal-backdrop"><section className="sam-modal delete-class-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-annotations-title" aria-describedby="delete-annotations-description"><header><div><span><Trash2 size={18} /></span><div><h2 id="delete-annotations-title">{copy.confirmDeleteAnnotations}</h2><p>{pendingDeleteAnnotations.length} {copy.annotationsToDelete}</p></div></div><button onClick={() => setPendingDeleteAnnotationIds([])} aria-label={copy.close}><X size={19} /></button></header><p id="delete-annotations-description" className="delete-class-warning">{copy.deleteAnnotationsWarning}</p><div className="delete-class-impact"><span>{copy.annotationsToDelete}</span><b>{pendingDeleteAnnotations.length}</b></div><footer><button onClick={() => setPendingDeleteAnnotationIds([])}>{copy.cancel}</button><button className="danger" onClick={deletePendingAnnotations}><Trash2 size={14} />{copy.confirmDelete}</button></footer></section></div>}
    {pendingDeleteClasses.length > 0 && <div className="modal-backdrop"><section className="sam-modal delete-class-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-class-title" aria-describedby="delete-class-description"><header><div><span><Trash2 size={18} /></span><div><h2 id="delete-class-title">{pendingDeleteClasses.length === 1 ? copy.confirmDeleteClass : copy.confirmDeleteClasses}</h2><p>{pendingDeleteClasses.map((label) => label.name).join(", ")}</p></div></div><button onClick={() => setPendingDeleteClassIds([])} aria-label={copy.close}><X size={19} /></button></header><p id="delete-class-description" className="delete-class-warning">{copy.deleteClassWarning} <strong>{copy.unlabeled}</strong>.</p><div className="delete-class-impact"><span>{copy.affectedAnnotations}</span><b>{pendingAffectedAnnotations}</b></div><footer><button onClick={() => setPendingDeleteClassIds([])}>{copy.cancel}</button><button className="danger" onClick={deletePendingClasses}><Trash2 size={14} />{copy.confirmDelete}</button></footer></section></div>}
    {preferencesOpen && <div className="modal-backdrop"><section className="sam-modal preferences-modal" role="dialog" aria-modal="true" aria-labelledby="preferences-title"><header><div><span><Settings2 size={18} /></span><div><h2 id="preferences-title">{copy.preferences}</h2><p>VisionLabel</p></div></div><button onClick={() => setPreferencesOpen(false)} aria-label={copy.close}><X size={19} /></button></header><div className="preferences-tabs"><button className={preferencesTab === "appearance" ? "active" : ""} onClick={() => setPreferencesTab("appearance")}><Sun size={14} />{copy.appearance}</button><button className={preferencesTab === "language" ? "active" : ""} onClick={() => setPreferencesTab("language")}><Languages size={14} />{copy.language}</button></div>{preferencesTab === "appearance" ? <div className="preference-options"><button className={themeMode === "system" ? "active" : ""} onClick={() => setThemeMode("system")}><Monitor size={20} /><b>{copy.system}</b></button><button className={themeMode === "light" ? "active" : ""} onClick={() => setThemeMode("light")}><Sun size={20} /><b>{copy.light}</b></button><button className={themeMode === "dark" ? "active" : ""} onClick={() => setThemeMode("dark")}><Moon size={20} /><b>{copy.dark}</b></button></div> : <div className="language-options"><button className={language === "pt" ? "active" : ""} onClick={() => setLanguage("pt")}><b>Português</b><span>PT-BR</span></button><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}><b>English</b><span>EN</span></button><button className={language === "fr" ? "active" : ""} onClick={() => setLanguage("fr")}><b>Français</b><span>FR</span></button><button className={language === "es" ? "active" : ""} onClick={() => setLanguage("es")}><b>Español</b><span>ES</span></button></div>}<footer><button className="connect" onClick={() => setPreferencesOpen(false)}><Check size={15} /> {copy.close}</button></footer></section></div>}
    {samOpen && <SamSetupModal
      selectedModelId={samModelId}
      loadedModelId={samLoadedModelId}
      connectionState={samConnectionState}
      runtimeLabel={samRuntime}
      endpoint={samEndpointDraft}
      onSelectModel={(modelId) => {
        clearSam(); setSamInteractionMode("points"); setSamModelId(modelId);
      }}
      onEndpointChange={setSamEndpointDraft}
      onConnect={() => void connectSam()}
      onClose={() => setSamOpen(false)}
    />}
    {(leftOpen || rightOpen) && <button className="backdrop" onClick={() => { setLeftOpen(false); setRightOpen(false); }} aria-label="Fechar painel" />}
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
  </main>;
}
