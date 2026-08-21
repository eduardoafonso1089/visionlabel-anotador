import JSZip from "jszip";
import { downloadBlob } from "./exporters";

export type DatasetRow = { internalId: string; original: Record<string, unknown> };
export type AnnotationMode = "classification" | "rating" | "preference" | "correction";
export type RecordStatus = "unannotated" | "annotated" | "review" | "skipped";
export type LlmAnnotation = {
  status: RecordStatus;
  labels?: string[];
  ratings?: Record<string, number>;
  winner?: string | null;
  displayedAs?: "A" | "B";
  strength?: string;
  reasons?: string[];
  correctedResponse?: string;
  changed?: boolean;
  comment?: string;
};
export type LlmSchema = {
  mode: AnnotationMode;
  taskName: string;
  instruction: string;
  promptField: string;
  responseField: string;
  contextFields: string[];
  labels: string[];
  multiLabel: boolean;
  criteria: Array<{ id: string; name: string; description: string; min: number; max: number; required: boolean }>;
  responseAField: string;
  responseBField: string;
  randomize: boolean;
  strongPreference: boolean;
  requireComment: boolean;
};
export type LlmProject = { format: "poligome-llm-project"; version: 1; name: string; rows: DatasetRow[]; schema: LlmSchema; annotations: Record<string, LlmAnnotation>; orders: Record<string, boolean>; currentIndex: number };

const promptNames = ["prompt", "question", "instruction", "input", "query", "user_message"];
const responseNames = ["response", "answer", "output", "completion", "assistant_response", "text"];

function csvRows(text: string) {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') { if (quote && text[index + 1] === '"') { value += '"'; index += 1; } else quote = !quote; }
    else if (!quote && (char === "," || char === ";")) { row.push(value); value = ""; }
    else if (!quote && (char === "\n" || char === "\r")) { if (char === "\r" && text[index + 1] === "\n") index += 1; row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = ""; }
    else value += char;
  }
  row.push(value); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function parseDataset(file: File): Promise<DatasetRow[]> {
  const text = await file.text(); const lower = file.name.toLowerCase(); let originals: Record<string, unknown>[] = [];
  if (lower.endsWith(".csv")) {
    const [header = [], ...data] = csvRows(text); originals = data.map((values) => Object.fromEntries(header.map((name, index) => [name.trim() || `field_${index + 1}`, values[index] ?? ""])));
  } else if (lower.endsWith(".jsonl")) {
    originals = text.split(/\r?\n/).filter(Boolean).map((line, index) => { try { const record = asRecord(JSON.parse(line)); if (!record) throw new Error(); return record; } catch { throw new Error(`Linha ${index + 1} não contém um objeto JSON válido.`); } });
  } else {
    const parsed: unknown = JSON.parse(text); const list = Array.isArray(parsed) ? parsed : asRecord(parsed)?.data ?? asRecord(parsed)?.records;
    if (!Array.isArray(list)) throw new Error("O JSON deve conter uma lista de registros, ou uma propriedade data/records.");
    originals = list.map((item, index) => { const record = asRecord(item); if (!record) throw new Error(`Registro ${index + 1} não é um objeto.`); return record; });
  }
  return originals.map((original, index) => {
    const external = original.id ?? original.uuid ?? original.sample_id ?? index + 1;
    return { internalId: `row-${index + 1}-${String(external)}`, original };
  });
}

export function fieldsOf(rows: DatasetRow[]) { return Array.from(new Set(rows.slice(0, 200).flatMap((row) => Object.keys(row.original)))); }
export function suggestedField(fields: string[], names: string[]) { return fields.find((field) => names.includes(field.toLowerCase())) ?? fields.find((field) => names.some((name) => field.toLowerCase().includes(name))) ?? fields[0] ?? ""; }
export function textValue(value: unknown) { return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value); }

function escaped(value: unknown) { const text = typeof value === "string" ? value : JSON.stringify(value); return `"${text.replaceAll('"', '""')}"`; }
function outputRow(row: DatasetRow, annotation: LlmAnnotation | undefined, schema: LlmSchema) {
  return { ...row.original, annotation: annotation ? { type: schema.mode, ...annotation } : undefined, metadata: { status: annotation?.status ?? "unannotated" } };
}

export function exportLlm(rows: DatasetRow[], schema: LlmSchema, annotations: Record<string, LlmAnnotation>, format: "json" | "jsonl" | "csv", annotatedOnly: boolean) {
  const output = rows.filter((row) => !annotatedOnly || annotations[row.internalId]?.status === "annotated").map((row) => outputRow(row, annotations[row.internalId], schema));
  if (format === "json") return downloadBlob("poligome-llm.json", new Blob([JSON.stringify(output, null, 2)], { type: "application/json" }));
  if (format === "jsonl") return downloadBlob("poligome-llm.jsonl", new Blob([output.map((row) => JSON.stringify(row)).join("\n")], { type: "application/x-ndjson" }));
  const columns = Array.from(new Set(output.flatMap((item) => Object.keys(item.original))));
  const lines = [columns.concat(["annotation_type", "annotation_labels", "annotation_ratings", "preference_winner", "preference_strength", "annotation_comment", "corrected_response", "response_changed", "status"]).map(escaped).join(",")];
  output.forEach((item) => { const note = item.annotation; lines.push(columns.map((field) => escaped(item.original[field])).concat([schema.mode, JSON.stringify(note?.labels ?? []), JSON.stringify(note?.ratings ?? {}), note?.winner ?? "", note?.strength ?? "", note?.comment ?? "", note?.correctedResponse ?? "", String(note?.changed ?? ""), item.metadata.status]).map(escaped).join(",")); });
  downloadBlob("poligome-llm.csv", new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
}

export async function saveLlmProject(project: LlmProject) {
  const zip = new JSZip(); zip.file("project.json", JSON.stringify(project));
  downloadBlob("poligome-llm.pllm", await zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.poligome.llm-project+zip" }));
}
export async function openLlmProject(file: File): Promise<LlmProject> {
  const zip = await JSZip.loadAsync(file); const entry = zip.file("project.json"); if (!entry) throw new Error("Arquivo de projeto inválido.");
  const project = JSON.parse(await entry.async("string")) as LlmProject;
  if (project.format !== "poligome-llm-project" || project.version !== 1 || !Array.isArray(project.rows)) throw new Error("Formato de projeto LLM não suportado.");
  return project;
}
