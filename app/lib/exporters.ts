import JSZip from "jszip";
import { annotationBounds, polygonArea, scalePoints } from "./geometry";
import type { Annotation, Asset, Label } from "./types";

function baseName(name: string, fallback: string) {
  const clean = name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  return clean || fallback;
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

export function exportCoco(assets: Asset[], labels: Label[], annotations: Annotation[]) {
  const images = assets.map((asset, index) => ({
    id: index + 1,
    file_name: asset.name,
    width: asset.width ?? 1000,
    height: asset.height ?? 650,
  }));
  const categories = labels.map((label, index) => ({
    id: index + 1,
    name: label.name,
    supercategory: "object",
  }));
  const cocoAnnotations = annotations.map((annotation, index) => {
    const imageIndex = assets.findIndex((asset) => asset.id === annotation.asset);
    const categoryIndex = labels.findIndex((label) => label.id === annotation.label);
    const image = assets[imageIndex];
    const width = image?.width ?? 1000;
    const height = image?.height ?? 650;
    const bounds = annotationBounds(annotation);
    const scaledBounds = scalePoints(
      [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height],
      width,
      height,
    );
    const segmentation =
      annotation.type === "polygon" ? [scalePoints(annotation.pts ?? [], width, height)] : [];
    // Uma polilinha não delimita região: sai em `line` (extensão), com area 0 e segmentation
    // vazia, para nenhum consumidor a interpretar como máscara.
    const line = annotation.type === "line" ? scalePoints(annotation.pts ?? [], width, height) : [];
    const area = annotation.type === "polygon"
      ? polygonArea(scalePoints(annotation.pts ?? [], width, height))
      : annotation.type === "line"
        ? 0
        : (scaledBounds[2] - scaledBounds[0]) * (scaledBounds[3] - scaledBounds[1]);
    return {
      id: index + 1,
      image_id: imageIndex + 1,
      category_id: categoryIndex + 1,
      bbox: [
        scaledBounds[0],
        scaledBounds[1],
        scaledBounds[2] - scaledBounds[0],
        scaledBounds[3] - scaledBounds[1],
      ],
      segmentation,
      line,
      keypoints:
        annotation.type === "point"
          ? scalePoints([annotation.x ?? 0, annotation.y ?? 0], width, height).concat(2)
          : [],
      num_keypoints: annotation.type === "point" ? 1 : 0,
      area,
      iscrowd: 0,
    };
  });
  downloadBlob(
    "epiaka-coco.json",
    new Blob(
      [JSON.stringify({ info: { description: "poligome.com dataset", version: "1.0" }, images, categories, annotations: cocoAnnotations }, null, 2)],
      { type: "application/json;charset=utf-8" },
    ),
  );
}

export async function exportYoloZip(assets: Asset[], labels: Label[], annotations: Annotation[], readme: string) {
  const zip = new JSZip();
  const labelFolder = zip.folder("labels");
  assets.forEach((asset, imageIndex) => {
    const lines = annotations
      .filter((annotation) => annotation.asset === asset.id)
      .flatMap((annotation) => {
        const classIndex = labels.findIndex((label) => label.id === annotation.label);
        if (annotation.type === "box") {
          const centerX = ((annotation.x ?? 0) + (annotation.w ?? 0) / 2) / 1000;
          const centerY = ((annotation.y ?? 0) + (annotation.h ?? 0) / 2) / 650;
          return [`${classIndex} ${centerX.toFixed(6)} ${centerY.toFixed(6)} ${((annotation.w ?? 0) / 1000).toFixed(6)} ${((annotation.h ?? 0) / 650).toFixed(6)}`];
        }
        if (annotation.type === "polygon") {
          const normalized = (annotation.pts ?? []).map((coordinate, index) =>
            (coordinate / (index % 2 ? 650 : 1000)).toFixed(6),
          );
          return [`${classIndex} ${normalized.join(" ")}`];
        }
        return [];
      });
    labelFolder?.file(`${baseName(asset.name, `image_${imageIndex + 1}`)}.txt`, lines.join("\n"));
  });
  zip.file("classes.txt", labels.map((label) => label.name).join("\n"));
  zip.file(
    "data.yaml",
    `path: .\ntrain: images/train\nval: images/val\nnc: ${labels.length}\nnames:\n${labels.map((label, index) => `  ${index}: ${JSON.stringify(label.name)}`).join("\n")}\n`,
  );
  zip.file(
    "README.txt",
    `${readme}\n`,
  );
  downloadBlob("epiaka-yolo.zip", await zip.generateAsync({ type: "blob" }));
}
