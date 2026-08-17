import JSZip from "jszip";
import { downloadBlob } from "./exporters";
import { fill } from "./i18n";
import type { Copy } from "./i18n";
import type { Annotation, Asset, Label } from "./types";

type PortableAsset = Omit<Asset, "src" | "local"> & {
  bundled_path?: string;
  source?: string;
};

export type ProjectSaveMode = "annotations" | "complete";

type ProjectManifest = {
  format: "epiaka-project";
  version: 2;
  project_name: string;
  saved_at: string;
  assets: PortableAsset[];
  labels: Label[];
  annotations: Annotation[];
};

export type LoadedEpiakaProject = {
  projectName: string;
  assets: Asset[];
  labels: Label[];
  annotations: Annotation[];
  objectUrls: string[];
  missingImages: number;
};

function safeBaseName(name: string) {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "epiaka-project";
}

function safeFileName(name: string, fallback: string) {
  const clean = name.replace(/[\\/:*?"<>|]+/g, "-").replace(/^\.+/, "").trim();
  return clean || fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseManifest(value: unknown, copy: Copy): ProjectManifest {
  if (!isObject(value) || value.format !== "epiaka-project" || value.version !== 2) {
    throw new Error(copy.errProjectFormat);
  }
  if (typeof value.project_name !== "string" || !Array.isArray(value.assets) || !Array.isArray(value.labels) || !Array.isArray(value.annotations)) {
    throw new Error(copy.errProjectIncomplete);
  }

  const assets = value.assets.filter((item): item is PortableAsset =>
    isObject(item) && typeof item.id === "string" && typeof item.name === "string" &&
    (typeof item.bundled_path === "string" || typeof item.source === "string" || item.missing === true),
  );
  const labels = value.labels.filter((item): item is Label =>
    isObject(item) && typeof item.id === "string" && typeof item.name === "string" && typeof item.color === "string" && typeof item.key === "string",
  );
  const annotations = value.annotations.filter((item): item is Annotation =>
    isObject(item) && typeof item.id === "string" && typeof item.asset === "string" && typeof item.label === "string" &&
    (item.type === "box" || item.type === "polygon" || item.type === "line" || item.type === "point"),
  );

  if (!assets.length || !labels.length) throw new Error(copy.errProjectEmpty);
  const assetIds = new Set(assets.map((item) => item.id));
  const labelIds = new Set(labels.map((item) => item.id));
  return {
    format: "epiaka-project",
    version: 2,
    project_name: value.project_name.trim() || copy.defaultProjectName,
    saved_at: typeof value.saved_at === "string" ? value.saved_at : new Date().toISOString(),
    assets,
    labels,
    annotations: annotations.filter((item) => assetIds.has(item.asset) && labelIds.has(item.label)),
  };
}

export async function saveEpiakaProject(projectName: string, assets: Asset[], labels: Label[], annotations: Annotation[], mode: ProjectSaveMode, copy: Copy) {
  const zip = new JSZip();
  const portableAssets = await Promise.all(assets.map(async (asset, index): Promise<PortableAsset> => {
    const { src, local, ...metadata } = asset;
    if (mode === "annotations" || asset.missing) return { ...metadata, missing: true };
    const shouldBundle = Boolean(asset.local || src.startsWith("blob:") || src.startsWith("data:"));
    void local;
    if (!shouldBundle) return { ...metadata, source: src };

    const response = await fetch(src);
    if (!response.ok) throw new Error(fill(copy.errProjectReadImage, { name: asset.name }));
    const imageBlob = await response.blob();
    const imagePath = `images/${String(index + 1).padStart(4, "0")}-${safeFileName(asset.name, `image-${index + 1}`)}`;
    zip.file(imagePath, imageBlob);
    return { ...metadata, bundled_path: imagePath };
  }));

  const manifest: ProjectManifest = {
    format: "epiaka-project",
    version: 2,
    project_name: projectName.trim() || copy.defaultProjectName,
    saved_at: new Date().toISOString(),
    assets: portableAssets,
    labels,
    annotations,
  };
  zip.file("project.json", JSON.stringify(manifest, null, 2));
  const archive = await zip.generateAsync({ type: "blob", compression: "STORE", mimeType: "application/vnd.epiaka.project+zip" });
  const fileName = `${safeBaseName(manifest.project_name)}.epka`;
  downloadBlob(fileName, archive);
  return fileName;
}

export async function openEpiakaProject(file: File, copy: Copy): Promise<LoadedEpiakaProject> {
  const zip = await JSZip.loadAsync(file);
  const manifestEntry = zip.file("project.json");
  if (!manifestEntry) throw new Error(copy.errProjectManifest);
  const manifest = parseManifest(JSON.parse(await manifestEntry.async("string")) as unknown, copy);
  const objectUrls: string[] = [];

  try {
    const assets = await Promise.all(manifest.assets.map(async (asset): Promise<Asset> => {
      const { bundled_path: bundledPath, source, ...metadata } = asset;
      if (bundledPath) {
        const imageEntry = zip.file(bundledPath);
        if (!imageEntry) throw new Error(fill(copy.errProjectImageMissing, { name: asset.name }));
        const imageBlob = await imageEntry.async("blob");
        const src = URL.createObjectURL(imageBlob);
        objectUrls.push(src);
        return { ...metadata, src, local: true, missing: false, byteSize: metadata.byteSize ?? imageBlob.size };
      }
      if (asset.missing) return { ...metadata, src: "", local: true, missing: true };
      if (!source || source === "local") throw new Error(fill(copy.errProjectImageNotBundled, { name: asset.name }));
      return { ...metadata, src: source, local: false };
    }));
    return { projectName: manifest.project_name, assets, labels: manifest.labels, annotations: manifest.annotations, objectUrls, missingImages: assets.filter((asset) => asset.missing).length };
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
